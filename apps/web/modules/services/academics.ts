/**
 * Typed academics service boundary — results (marks entry, moderation,
 * publication, correction) and the per-student published snapshot the
 * family portal renders.
 *
 * Pages and components import `academicsService` ONLY, never the demo
 * fixtures directly (frontend-service boundary, P1). The current
 * implementation is a deterministic demo adapter: fixtures from
 * `modules/academics/demo.ts`, mutated state persisted in the demo session
 * store (browser sessionStorage where available, in-memory elsewhere),
 * ~200 ms simulated latency, and demo-clock timestamps. A real backend
 * replaces this module wholesale behind the same signatures.
 *
 * Timetable ownership moved out of this service: `modules/services/timetable.ts`
 * is the single timetable facade (metadata + periods + history + conflicts),
 * so staff editing and portal reads share one store. This file keeps the
 * results domain only.
 */

import {
  batchVersions,
  marksByTerm,
  publications as demoPublications,
  resultBatches,
  studentResultSnapshots,
  terms,
  type BatchVersion,
  type ResultBatchStatus,
  type Term,
} from "@/modules/academics/demo";
import { demoNowIso } from "@/modules/demo/clock";
import { demoStudents } from "@/modules/relationships/demo";
import { auditService } from "@/modules/services/audit";
import { enqueueOutboxEvent } from "@/modules/services/outbox";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

/** Version-history entries returned by `listVersions`, newest first. */
export type { BatchVersion } from "@/modules/academics/demo";

/* ------------------------------------------------------------------ */
/* Results domain types                                                */
/* ------------------------------------------------------------------ */

export type Grade = "A" | "B" | "C" | "D";

export type MarksRow = {
  subject: string;
  max: number;
  obtained: number | null;
  grade?: Grade;
  remark?: string;
  /** Present for Supabase ResultEntrySheet rows; demo rows intentionally omit them. */
  rosterId?: string;
  componentId?: string;
  studentId?: string;
  studentName?: string;
  markStatus?: "pending" | "present" | "absent" | "exempt" | "not_applicable";
};

export type ResultEntryComponent = {
  id: string;
  ref?: string;
  name: string;
  maxMarks: number;
  weight?: number | null;
  order: number;
};

export type ResultEntryMark = {
  id?: string;
  rosterId: string;
  componentId: string;
  obtained: number | null;
  markStatus: "pending" | "present" | "absent" | "exempt" | "not_applicable";
  remark?: string | null;
};

export type ResultEntryRoster = {
  id: string;
  ref?: string;
  studentId: string;
  enrollmentId: string;
  studentName: string;
  order: number;
  marks: ResultEntryMark[];
};

/** Authoritative one-subject sheet. Every roster × component cell is explicit. */
export type ResultEntrySheet = {
  id: string;
  ref: string;
  examDefinitionId?: string;
  academicYearId?: string;
  gradeSectionId?: string;
  subjectId?: string;
  state: EntryBatchStatus | "superseded";
  version: number;
  components: ResultEntryComponent[];
  roster: ResultEntryRoster[];
};

export type EntryBatchStatus = "draft" | "submitted" | "moderation" | "returned" | "approved" | "published" | "withdrawn";

export type EntryBatch = {
  ref: string;
  exam: string;
  className: string;
  /** Subject the batch covers — teacher entry scope matches on class AND subject. */
  subject: string;
  status: EntryBatchStatus;
  rows: MarksRow[];
  totalsIncomplete: boolean;
  returnedReason?: string;
  version: number;
  /** Publication timestamp once published (shown in the queue). */
  publishedAtIso?: string;
  /** Version note shown under the queue row, e.g. a queued correction. */
  note?: string;
  /** Full matrix used by Supabase; rows remain a presentation-compatible view. */
  entrySheet?: ResultEntrySheet;
};

export type Publication = {
  ref: string;
  term: string;
  status: "final" | "provisional";
  publishedAtIso: string;
  version: number;
  /** Why a later version exists — shown on the published report. */
  correctionNote?: string;
  /** Set when the live publication is withdrawn — the record stays on file. */
  withdrawnAtIso?: string;
  withdrawalReason?: string;
  releaseId?: string;
  releaseVersion?: number;
  items?: Array<{ publicationId: string; subjectId: string; snapshot: unknown }>;
};

/** A field-level problem; `subject` is null for batch-level errors. */
export type AcademicError = {
  subject: string | null;
  message: string;
};

/** Every write returns a typed outcome so the UI can surface errors. */
export type AcademicResult<T> = { ok: true; value: T } | { ok: false; errors: AcademicError[] };

/** One row of a published per-student result snapshot (obtained is null for absent/exempt). */
export type SnapshotMarkRow = {
  subject: string;
  max: number;
  obtained: number | null;
  grade?: Grade;
  remark?: string;
  /** Explicit result status from the published snapshot: present, absent, exempt, not_applicable. */
  markStatus?: string;
};

/**
 * The immutable published marks the portal shows for one student and
 * academic year, keyed by term label ("Term 1", …). The staff
 * entry/moderation/publish flow does not mutate snapshots in this demo;
 * the results backend publishes them per student.
 */
export type StudentResultSnapshot = {
  studentId: string;
  academicYearId: string;
  terms: Record<string, SnapshotMarkRow[]>;
};

/** Shared status labels and tones for entry batches (single source of truth). */
export const ENTRY_BATCH_STATUS_META: Record<EntryBatchStatus, { label: string; tone: "good" | "watch" | "alert" | "neutral" }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "watch" },
  moderation: { label: "Moderation", tone: "watch" },
  returned: { label: "Returned", tone: "alert" },
  approved: { label: "Approved", tone: "good" },
  published: { label: "Published", tone: "good" },
  withdrawn: { label: "Withdrawn", tone: "alert" },
};

/* ------------------------------------------------------------------ */
/* Grade scheme (demo)                                                 */
/* ------------------------------------------------------------------ */

/** Percentage bands derived from the demo report fixtures. */
export const GRADE_BANDS: ReadonlyArray<{ min: number; grade: Grade }> = [
  { min: 80, grade: "A" },
  { min: 65, grade: "B" },
  { min: 50, grade: "C" },
  { min: 0, grade: "D" },
];

/** Grade for a percentage score (demo scheme): A ≥ 80, B ≥ 65, C ≥ 50, D below. */
export function gradeForPercentage(percentage: number): Grade {
  return GRADE_BANDS.find((band) => percentage >= band.min)?.grade ?? "D";
}

/* ------------------------------------------------------------------ */
/* Service interfaces                                                  */
/* ------------------------------------------------------------------ */

export interface ResultsService {
  listBatches(): Promise<EntryBatch[]>;
  getBatch(ref: string): Promise<EntryBatch | null>;
  saveEntryDraft(ref: string, rows: MarksRow[]): Promise<AcademicResult<EntryBatch>>;
  submitForModeration(ref: string, rows: MarksRow[]): Promise<AcademicResult<EntryBatch>>;
  returnWithReason(ref: string, reason: string): Promise<AcademicResult<EntryBatch>>;
  approve(ref: string): Promise<AcademicResult<EntryBatch>>;
  publish(ref: string, by?: string): Promise<AcademicResult<Publication>>;
  /** Open a new editable version of a published batch. */
  startCorrection(ref: string, reason: string, by?: string): Promise<AcademicResult<EntryBatch>>;
  /**
   * Withdraw the live publication of a published batch. The batch becomes
   * "withdrawn" (version bumped, history entry appended) and its live
   * publication is tombstoned with `withdrawnAtIso`/`withdrawalReason`;
   * published history is never deleted.
   */
  withdrawPublication(ref: string, reason: string, by?: string): Promise<AcademicResult<EntryBatch>>;
  getPublications(): Promise<Publication[]>;
  getPublication(ref: string): Promise<Publication | null>;
  listVersions(batchRef: string): Promise<BatchVersion[]>;
  /** Terms with session-aware publication state (the portal reads this). */
  getTerms(): Promise<Term[]>;
  /**
   * The published per-student snapshot for a student and academic year,
   * or null when no publication exists for that student/year. The portal
   * renders marks from this snapshot only, never from a term fixture.
   */
  getStudentResultSnapshot(studentId: string, academicYearId: string): Promise<StudentResultSnapshot | null>;
}

export type AcademicsService = ResultsService;

/* ------------------------------------------------------------------ */
/* Deterministic demo adapter                                          */
/* ------------------------------------------------------------------ */

const SESSION_KEY = sessionKey("academics");
const DEFAULT_ACTOR = "M. Wani (exam office)";

/** Simulated network latency — fixed so demo behavior stays deterministic. */
const LATENCY_MS = 200;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function respond<T>(compute: () => T): Promise<T> {
  await sleep(LATENCY_MS);
  return compute();
}

export type SupabaseResultRow = {
  id: string;
  reference: string;
  status: string;
  version: number;
  state?: string;
  examDefinitionId?: string;
  academicYearId?: string;
  gradeSectionId?: string;
  subjectId?: string;
  examTerm?: string;
  gradeLabel?: string;
  sectionLabel?: string;
  subjectName?: string;
  components?: Array<{ id: string; reference?: string; name: string; maxMarks: number; weight?: number | null; order?: number }>;
  roster?: Array<{ id: string; reference?: string; studentId: string; enrollmentId: string; studentName?: string; order?: number; marks?: Array<{ id?: string; componentId: string; obtained: number | null; markStatus?: string; remark?: string | null }> }>;
  exam_definitions?: { term?: string; grade_sections?: { section_label?: string; grades?: { label?: string } | null } | null; assessment_components?: Array<{ id: string; name: string; max_marks: number }> } | null;
  result_rosters?: Array<{ id: string; mark_entries?: Array<{ component_id: string; obtained: number | null; absent: boolean; remark: string | null }> }>;
};

function supabaseBatchStatus(status: string): EntryBatchStatus {
  return status as EntryBatchStatus;
}

export function mapServerResultBatch(row: SupabaseResultRow): EntryBatch {
  if (Array.isArray(row.components) && Array.isArray(row.roster)) {
    const components: ResultEntryComponent[] = row.components.map((component, index) => ({
      id: component.id,
      ref: component.reference,
      name: component.name,
      maxMarks: Number(component.maxMarks),
      weight: component.weight ?? null,
      order: component.order ?? index,
    }));
    const roster: ResultEntryRoster[] = row.roster.map((candidate, rosterIndex) => ({
      id: candidate.id,
      ref: candidate.reference,
      studentId: candidate.studentId,
      enrollmentId: candidate.enrollmentId,
      studentName: candidate.studentName ?? candidate.studentId,
      order: candidate.order ?? rosterIndex,
      marks: (candidate.marks ?? []).map((mark) => ({
        id: mark.id,
        rosterId: candidate.id,
        componentId: mark.componentId,
        obtained: mark.obtained,
        markStatus: (mark.markStatus ?? (mark.obtained === null ? "pending" : "present")) as ResultEntryMark["markStatus"],
        remark: mark.remark,
      })),
    }));
    const rows = roster.flatMap((candidate) => components.map((component) => {
      const mark = candidate.marks.find((item) => item.componentId === component.id);
      return {
        subject: `${candidate.studentName} · ${component.name}`,
        max: component.maxMarks,
        obtained: mark?.obtained ?? null,
        remark: mark?.remark ?? undefined,
        rosterId: candidate.id,
        componentId: component.id,
        studentId: candidate.studentId,
        studentName: candidate.studentName,
        markStatus: mark?.markStatus ?? "pending",
      } satisfies MarksRow;
    }));
    return {
      ref: row.reference,
      exam: row.examTerm ?? "Results",
      className: `${row.gradeLabel ?? "Class"} · ${row.sectionLabel ?? ""}`.trim(),
      subject: row.subjectName ?? components[0]?.name ?? "",
      status: supabaseBatchStatus(row.state ?? row.status),
      rows,
      totalsIncomplete: rows.some((item) => item.obtained === null && item.markStatus === "pending"),
      version: row.version,
      entrySheet: { id: row.id, ref: row.reference, examDefinitionId: row.examDefinitionId, academicYearId: row.academicYearId, gradeSectionId: row.gradeSectionId, subjectId: row.subjectId, state: supabaseBatchStatus(row.state ?? row.status), version: row.version, components, roster },
    };
  }
  const components = row.exam_definitions?.assessment_components ?? [];
  const marks = row.result_rosters?.flatMap((roster) => roster.mark_entries ?? []) ?? [];
  const rows = components.map((component) => {
    const entries = marks.filter((mark) => mark.component_id === component.id);
    const first = entries[0];
    return { subject: component.name, max: Number(component.max_marks), obtained: first?.obtained ?? null, remark: first?.remark ?? undefined };
  });
  return {
    ref: row.reference,
    exam: row.exam_definitions?.term ?? "Results",
    className: `${row.exam_definitions?.grade_sections?.grades?.label ?? "Class"} · ${row.exam_definitions?.grade_sections?.section_label ?? ""}`.trim(),
    subject: rows[0]?.subject ?? "",
    status: supabaseBatchStatus(row.status),
    rows,
    totalsIncomplete: rows.some((item) => item.obtained === null),
    version: row.version,
  };
}

async function supabaseBatch(ref: string): Promise<{ id: string; raw: SupabaseResultRow } | null> {
  const listed = await adapterCall<SupabaseResultRow[]>("results.listBatches", {});
  if (!listed.ok) return null;
  const raw = listed.value.find((candidate) => candidate.reference === ref || candidate.id === ref);
  return raw ? { id: raw.id, raw } : null;
}

function markPayload(rows: MarksRow[], raw: SupabaseResultRow): Array<{ rosterId: string; componentId: string; obtained: number | null; absent: boolean; remark: string | null }> {
  if (rows.some((row) => row.rosterId && row.componentId)) {
    return rows.filter((row): row is MarksRow & { rosterId: string; componentId: string } => Boolean(row.rosterId && row.componentId)).map((row) => ({
      rosterId: row.rosterId,
      componentId: row.componentId,
      obtained: row.obtained,
      absent: row.markStatus === "absent",
      remark: row.remark ?? null,
    }));
  }
  const rosterId = raw.result_rosters?.[0]?.id;
  const componentId = raw.exam_definitions?.assessment_components?.[0]?.id;
  if (!rosterId || !componentId) return [];
  const row = rows[0];
  return row ? [{ rosterId, componentId, obtained: row.obtained, absent: false, remark: row.remark ?? null }] : [];
}

/* --- Session snapshot ---------------------------------------------- */

/** Internal batch record: public fields plus correction/publisher audit. */
type SessionBatch = EntryBatch & { correctionReason?: string; publishedBy?: string };

type AcademicsSession = {
  batches: Record<string, SessionBatch>;
  publications: Publication[];
  versions: Record<string, BatchVersion[]>;
  /** Deterministic publication counter — demo fixtures occupy 001–002. */
  pubCounter: number;
};

const STATUS_FROM_DEMO: Record<ResultBatchStatus, EntryBatchStatus> = {
  entry: "draft",
  moderation: "moderation",
  approved: "approved",
  published: "published",
  correction: "moderation",
};

function seedRowsFor(exam: string, entered: boolean): MarksRow[] {
  const marks = marksByTerm[exam] ?? [];
  return marks.map((mark) => ({
    subject: mark.subject,
    max: mark.max,
    obtained: entered ? mark.obtained : null,
    grade: mark.grade,
    remark: mark.remark,
  }));
}

function seedVersions(): Record<string, BatchVersion[]> {
  return {
    ...batchVersions,
    /* The demo correction fixture carries its own history. */
    "RB-2026-0140": [
      { version: 2, note: "Correction v2 under moderation", atIso: "2026-06-16T07:15:00Z", by: "S. Bhat" },
      { version: 1, note: "Initial entry", atIso: "2026-06-10T10:00:00Z", by: "M. Wani" },
    ],
  };
}

function seedSession(): AcademicsSession {
  const batches: Record<string, SessionBatch> = {};
  for (const fixture of resultBatches) {
    const status = STATUS_FROM_DEMO[fixture.status];
    const rows = seedRowsFor(fixture.exam, status !== "draft");
    batches[fixture.ref] = {
      ref: fixture.ref,
      exam: fixture.exam,
      className: fixture.className,
      subject: fixture.subject,
      status,
      rows,
      totalsIncomplete: rows.some((row) => row.obtained === null),
      version: fixture.version ?? 1,
      publishedAtIso: fixture.publishedAtIso,
      note: fixture.note,
    };
  }
  return {
    batches,
    publications: demoPublications.map((publication) => ({ ...publication })),
    versions: seedVersions(),
    pubCounter: 3,
  };
}

function loadSession(): AcademicsSession {
  const stored = sessionGet<AcademicsSession>(SESSION_KEY);
  if (stored) return stored;
  const seeded = seedSession();
  sessionSet(SESSION_KEY, seeded);
  return seeded;
}

function saveSession(state: AcademicsSession): void {
  sessionSet(SESSION_KEY, state);
}

function publicBatch(batch: SessionBatch): EntryBatch {
  return {
    ref: batch.ref,
    exam: batch.exam,
    className: batch.className,
    subject: batch.subject,
    status: batch.status,
    rows: batch.rows,
    totalsIncomplete: batch.totalsIncomplete,
    returnedReason: batch.returnedReason,
    version: batch.version,
    publishedAtIso: batch.publishedAtIso,
    note: batch.note,
    entrySheet: batch.entrySheet,
  };
}

/* --- Validation ---------------------------------------------------- */

function fail(message: string): AcademicResult<never> {
  return { ok: false, errors: [{ subject: null, message }] };
}

function normalizeRows(rows: readonly MarksRow[]): MarksRow[] {
  return rows.map((row) => ({
    subject: row.subject,
    max: row.max,
    obtained: row.obtained,
    grade: row.obtained === null ? undefined : gradeForPercentage((row.obtained / row.max) * 100),
    remark: row.remark === undefined || row.remark.trim() === "" ? undefined : row.remark.trim(),
  }));
}

function rowValueErrors(rows: readonly MarksRow[]): AcademicError[] {
  const errors: AcademicError[] = [];
  for (const row of rows) {
    if (row.obtained === null) continue;
    if (!Number.isFinite(row.obtained)) {
      errors.push({ subject: row.subject, message: "Marks must be a number." });
    } else if (row.obtained < 0) {
      errors.push({ subject: row.subject, message: "Marks cannot be negative." });
    } else if (row.obtained > row.max) {
      errors.push({ subject: row.subject, message: `Marks exceed the maximum of ${row.max}.` });
    }
  }
  return errors;
}

function incompleteRowErrors(rows: readonly MarksRow[]): AcademicError[] {
  return rows
    .filter((row) => row.obtained === null && (row.markStatus ?? "pending") === "pending")
    .map((row) => ({ subject: row.subject, message: "Marks not entered." }));
}

function statusLabel(status: EntryBatchStatus): string {
  return ENTRY_BATCH_STATUS_META[status].label;
}

/* --- Results implementation ---------------------------------------- */

async function listBatches(): Promise<EntryBatch[]> {
  if (clientAdapterMode() === "supabase") {
    const response = await adapterCall<SupabaseResultRow[]>("results.listBatches", {});
    if (!response.ok) return [];
    return response.value.map(mapServerResultBatch);
  }
  return respond(() => Object.values(loadSession().batches).map(publicBatch));
}

async function getBatch(ref: string): Promise<EntryBatch | null> {
  if (clientAdapterMode() === "supabase") {
    const listed = await adapterCall<SupabaseResultRow[]>("results.listBatches", {});
    if (!listed.ok) return null;
    const found = listed.value.find((candidate) => candidate.reference === ref || candidate.id === ref);
    if (!found) return null;
    const detail = await adapterCall<SupabaseResultRow>("results.getBatch", { batchRef: found.reference });
    return detail.ok ? mapServerResultBatch(detail.value) : mapServerResultBatch(found);
  }
  return respond(() => {
    const batch = loadSession().batches[ref];
    return batch ? publicBatch(batch) : null;
  });
}

async function saveEntryDraft(ref: string, rows: MarksRow[]): Promise<AcademicResult<EntryBatch>> {
  if (clientAdapterMode() === "supabase") {
    const resolved = await supabaseBatch(ref);
    if (!resolved) return fail("Batch not found.");
    const response = await adapterCall<unknown>("results.saveDraft", { batchRef: resolved.raw.reference, marks: markPayload(rows, resolved.raw), expectedVersion: resolved.raw.version, idempotencyKey: `draft:${resolved.raw.reference}:${resolved.raw.version}` });
    if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
    const next = await getBatch(ref);
    return next ? { ok: true, value: next } : fail("The saved batch could not be reloaded.");
  }
  return respond(() => {
    const state = loadSession();
    const batch = state.batches[ref];
    if (!batch) return fail("Batch not found.");
    if (batch.status !== "draft" && batch.status !== "returned" && batch.status !== "moderation") {
      return fail(`Marks cannot be edited while the batch is ${statusLabel(batch.status)} — return it from moderation first.`);
    }
    const errors = rowValueErrors(rows);
    if (errors.length > 0) return { ok: false, errors };
    batch.rows = normalizeRows(rows);
    batch.totalsIncomplete = batch.rows.some((row) => row.obtained === null);
    saveSession(state);
    return { ok: true, value: publicBatch(batch) };
  });
}

async function submitForModeration(ref: string, rows: MarksRow[]): Promise<AcademicResult<EntryBatch>> {
  if (clientAdapterMode() === "supabase") {
    const resolved = await supabaseBatch(ref);
    if (!resolved) return fail("Batch not found.");
    const response = await adapterCall<unknown>("results.submitMarks", { batchRef: resolved.raw.reference, marks: markPayload(rows, resolved.raw), expectedVersion: resolved.raw.version, idempotencyKey: `submit:${resolved.raw.reference}:${resolved.raw.version}` });
    if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
    const next = await getBatch(ref);
    return next ? { ok: true, value: next } : fail("The submitted batch could not be reloaded.");
  }
  return respond(() => {
    const state = loadSession();
    const batch = state.batches[ref];
    if (!batch) return fail("Batch not found.");
    if (batch.status !== "draft" && batch.status !== "returned" && batch.status !== "moderation") {
      return fail(`Only draft or returned sheets can be submitted — the batch is ${statusLabel(batch.status)}.`);
    }
    const errors = [...rowValueErrors(rows), ...incompleteRowErrors(rows)];
    if (errors.length > 0) return { ok: false, errors };
    batch.rows = normalizeRows(rows);
    batch.totalsIncomplete = false;
    batch.returnedReason = undefined;
    batch.status = "submitted";
    saveSession(state);
    return { ok: true, value: publicBatch(batch) };
  });
}

async function returnWithReason(ref: string, reason: string): Promise<AcademicResult<EntryBatch>> {
  if (clientAdapterMode() === "supabase") {
    const resolved = await supabaseBatch(ref);
    if (!resolved) return fail("Batch not found.");
    const response = await adapterCall<unknown>("results.moderate", { batchRef: resolved.raw.reference, outcome: "returned", note: reason, expectedVersion: resolved.raw.version, idempotencyKey: `return:${resolved.raw.reference}:${resolved.raw.version}` });
    if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
    const next = await getBatch(ref);
    return next ? { ok: true, value: next } : fail("The returned batch could not be reloaded.");
  }
  return respond(() => {
    const state = loadSession();
    const batch = state.batches[ref];
    if (!batch) return fail("Batch not found.");
    if (batch.status !== "submitted" && batch.status !== "moderation") {
      return fail(`Only sheets awaiting moderation can be returned — the batch is ${statusLabel(batch.status)}.`);
    }
    if (reason.trim() === "") return fail("A reason for the return is required.");
    batch.status = "returned";
    batch.returnedReason = reason.trim();
    saveSession(state);
    return { ok: true, value: publicBatch(batch) };
  });
}

async function approve(ref: string): Promise<AcademicResult<EntryBatch>> {
  if (clientAdapterMode() === "supabase") {
    const resolved = await supabaseBatch(ref);
    if (!resolved) return fail("Batch not found.");
    const response = await adapterCall<unknown>("results.moderate", { batchRef: resolved.raw.reference, outcome: "approved", expectedVersion: resolved.raw.version, idempotencyKey: `approve:${resolved.raw.reference}:${resolved.raw.version}` });
    if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
    const next = await getBatch(ref);
    return next ? { ok: true, value: next } : fail("The approved batch could not be reloaded.");
  }
  return respond(() => {
    const state = loadSession();
    const batch = state.batches[ref];
    if (!batch) return fail("Batch not found.");
    if (batch.status !== "submitted" && batch.status !== "moderation") {
      return fail(`Only sheets awaiting moderation can be approved — the batch is ${statusLabel(batch.status)}.`);
    }
    batch.status = "approved";
    saveSession(state);
    return { ok: true, value: publicBatch(batch) };
  });
}

async function publish(ref: string, by: string = DEFAULT_ACTOR): Promise<AcademicResult<Publication>> {
  if (clientAdapterMode() === "supabase") {
    const resolved = await supabaseBatch(ref);
    if (!resolved) return fail("Batch not found.");
    const response = await adapterCall<{ publicationRef?: string; publicationId?: string }>("results.publish", { batchRef: resolved.raw.reference, expectedVersion: resolved.raw.version, idempotencyKey: `publish:${resolved.raw.reference}:${resolved.raw.version}` });
    if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
    const publications = await adapterCall<Array<{ reference: string; version: number; status: string; published_at: string }>>("results.listPublications", {});
    const publicationRef = response.value.publicationRef ?? response.value.publicationId ?? resolved.raw.reference;
    const item = publications.ok ? publications.value.find((candidate) => candidate.reference === publicationRef) : undefined;
    return { ok: true, value: { ref: publicationRef, term: resolved.raw.exam_definitions?.term ?? resolved.raw.examTerm ?? "Results", status: "final", publishedAtIso: item?.published_at ?? new Date().toISOString(), version: item?.version ?? resolved.raw.version } };
  }
  return respond(() => {
    const state = loadSession();
    const batch = state.batches[ref];
    if (!batch) return fail("Batch not found.");
    if (batch.status === "published") return fail("This batch is already published — corrections release as a new version.");
    if (batch.status !== "approved") {
      return fail(`Only approved sheets can be published — the batch is ${statusLabel(batch.status)}.`);
    }
    const counter = state.pubCounter;
    state.pubCounter += 1;
    const publication: Publication = {
      ref: `PUB-2026-${String(counter).padStart(3, "0")}`,
      term: batch.exam,
      status: "final",
      publishedAtIso: demoNowIso(),
      version: batch.version,
      correctionNote:
        batch.version > 1 && batch.correctionReason
          ? `v${batch.version} corrects: ${batch.correctionReason} — earlier versions remain on record.`
          : undefined,
    };
    batch.status = "published";
    batch.publishedAtIso = publication.publishedAtIso;
    batch.publishedBy = by;
    batch.note = undefined;
    state.publications.push(publication);
    /* One delivery event + one audit row per publication, versioned so a
       later correction of the same batch enqueues a distinct event. */
    enqueueOutboxEvent({
      eventId: `results.published:${ref}:v${batch.version}`,
      kind: "results.published",
      targetRef: ref,
      actor: by ?? DEFAULT_ACTOR,
    });
    void auditService.record({ actor: by ?? DEFAULT_ACTOR, action: "Result published", target: ref, outcome: "Success" });
    saveSession(state);
    return { ok: true, value: publication };
  });
}

async function startCorrection(ref: string, reason: string, by: string = DEFAULT_ACTOR): Promise<AcademicResult<EntryBatch>> {
  if (clientAdapterMode() === "supabase") {
    const publications = await adapterCall<Array<{ id: string; reference: string; batch_id?: string; releaseId?: string; items?: Array<{ publicationId: string; subjectId: string; snapshot: unknown }> }>>("results.listReleases", {});
    if (!publications.ok) return { ok: false, errors: publications.errors.map((error) => ({ subject: null, message: error.message })) };
    const publication = publications.value.find((candidate) => candidate.reference === ref || candidate.releaseId === ref);
    if (!publication) return fail("Publication not found.");
    const target = publication.items?.[0];
    if (!target) return fail("The report release has no subject publication to correct.");
    const request = await adapterCall<{ requestId: string }>("results.requestCorrection", { releaseRef: publication.reference, publicationRef: target.publicationId, reason, idempotencyKey: `correction:${publication.reference}:${target.publicationId}` });
    if (!request.ok) return { ok: false, errors: request.errors.map((error) => ({ subject: null, message: error.message })) };
    const next = await getBatch(ref);
    return next
      ? { ok: true, value: next }
      : { ok: true, value: { ref, status: "draft", version: 1, rows: [], totalsIncomplete: false } as unknown as EntryBatch };
  }
  return respond(() => {
    const state = loadSession();
    const batch = state.batches[ref];
    if (!batch) return fail("Batch not found.");
    if (batch.status !== "published" && batch.status !== "withdrawn") {
      return fail(`Only published or withdrawn batches can be corrected — the batch is ${statusLabel(batch.status)}.`);
    }
    if (reason.trim() === "") return fail("A reason for the correction is required.");
    const version = batch.version + 1;
    batch.version = version;
    batch.status = "draft";
    batch.returnedReason = undefined;
    batch.correctionReason = reason.trim();
    batch.note = `Correction v${version} — ${reason.trim()}`;
    state.versions[batch.ref] = [{ version, note: reason.trim(), atIso: demoNowIso(), by }, ...(state.versions[batch.ref] ?? [])];
    saveSession(state);
    return { ok: true, value: publicBatch(batch) };
  });
}

async function withdrawPublication(ref: string, reason: string, by: string = DEFAULT_ACTOR): Promise<AcademicResult<EntryBatch>> {
  if (clientAdapterMode() === "supabase") {
    /* The caller passes a batch reference (RB-...); resolve it to the batch's
       active publication (PUB-...) before calling results.withdraw. */
    const publications = await adapterCall<Array<{ id: string; reference: string; batch_id: string; status?: string }>>("results.listPublications", {});
    if (!publications.ok) return { ok: false, errors: publications.errors.map((error) => ({ subject: null, message: error.message })) };
    /* Try matching by publication reference first, then fall back to batch_id. */
    let publication = publications.value.find((candidate) => candidate.reference === ref);
    if (!publication) {
      const batches = await adapterCall<SupabaseResultRow[]>("results.listBatches", {});
      if (batches.ok) {
        const batch = batches.value.find((candidate) => candidate.reference === ref || candidate.id === ref);
        if (batch) {
          publication = publications.value.find((candidate) => candidate.batch_id === batch.id && candidate.status !== "withdrawn");
        }
      }
    }
    if (!publication) return fail("Publication not found for this batch.");
    const response = await adapterCall<unknown>("results.withdraw", { publicationId: publication.id, reason });
    if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
    const next = await getBatch(ref);
    return next ? { ok: true, value: next } : fail("The withdrawn batch could not be reloaded.");
  }
  return respond(() => {
    const state = loadSession();
    const batch = state.batches[ref];
    if (!batch) return fail("Batch not found.");
    if (batch.status === "withdrawn") {
      return fail(`This batch is already withdrawn (v${batch.version}). A correction releases a new version.`);
    }
    if (batch.status !== "published") {
      return fail(`Only published batches can be withdrawn — the batch is ${statusLabel(batch.status)}.`);
    }
    if (reason.trim() === "") return fail("A reason for the withdrawal is required.");
    /* The withdrawal is a new version of the batch record: the published
       version is tombstoned, never deleted, and the status transition
       guards the action so a second withdrawal for the same version fails. */
    batch.status = "withdrawn";
    batch.note = `Withdrawn — ${reason.trim()}`;
    batch.version += 1;
    state.versions[batch.ref] = [
      { version: batch.version, note: reason.trim(), atIso: demoNowIso(), by },
      ...(state.versions[batch.ref] ?? []),
    ];
    const live = [...state.publications]
      .reverse()
      .find((publication) => publication.term === batch.exam && publication.withdrawnAtIso === undefined);
    if (live) {
      live.withdrawnAtIso = demoNowIso();
      live.withdrawalReason = reason.trim();
    }
    /* One delivery event + one audit row per withdrawal (versioned id). */
    enqueueOutboxEvent({
      eventId: `results.withdrawn:${ref}:v${batch.version}`,
      kind: "results.withdrawn",
      targetRef: ref,
      actor: by ?? DEFAULT_ACTOR,
    });
    void auditService.record({
      actor: by ?? DEFAULT_ACTOR,
      action: "Result withdrawn",
      target: ref,
      outcome: "Success",
      reason: reason.trim(),
    });
    saveSession(state);
    return { ok: true, value: publicBatch(batch) };
  });
}

async function getPublications(): Promise<Publication[]> {
  if (clientAdapterMode() === "supabase") {
    const response = await adapterCall<Array<{ id: string; reference: string; term: string; version: number; status: string; publishedAt?: string; published_at?: string; items?: Array<{ publicationId: string; subjectId: string; snapshot: unknown }> }>>("results.listReleases", {});
    if (!response.ok) return [];
    return response.value.map((publication) => ({ ref: publication.reference, term: publication.term ?? "Results", status: publication.status === "provisional" ? "provisional" : "final", publishedAtIso: publication.publishedAt ?? publication.published_at ?? new Date().toISOString(), version: publication.version, releaseId: publication.id, releaseVersion: publication.version, items: publication.items }));
  }
  return respond(() =>
    loadSession()
      .publications.filter((publication) => publication.withdrawnAtIso === undefined)
      .map((publication) => ({ ...publication })),
  );
}

async function getPublication(ref: string): Promise<Publication | null> {
  if (clientAdapterMode() === "supabase") {
    const publications = await getPublications();
    return publications.find((publication) => publication.ref === ref) ?? null;
  }
  return respond(() => {
    const publication = loadSession().publications.find((item) => item.ref === ref);
    return publication ? { ...publication } : null;
  });
}

async function listVersions(batchRef: string): Promise<BatchVersion[]> {
  if (clientAdapterMode() === "supabase") {
    const resolved = await supabaseBatch(batchRef);
    if (!resolved) return [];
    const response = await adapterCall<Array<{ version?: number; note?: string | null; createdAt?: string; created_at?: string; actorAccountId?: string; created_by_account_id?: string }>>("results.listVersions", { sheetRef: resolved.raw.reference });
    if (!response.ok) return [];
    return response.value.map((item) => ({ version: item.version ?? 0, note: item.note ?? "", atIso: item.createdAt ?? item.created_at ?? new Date(0).toISOString(), by: item.actorAccountId ?? item.created_by_account_id ?? "Result office" }));
  }
  return respond(() => [...(loadSession().versions[batchRef] ?? [])]);
}

async function getTerms(): Promise<Term[]> {
  if (clientAdapterMode() === "supabase") {
    const publications = await getPublications();
    return publications.map((publication) => ({ id: publication.ref, label: publication.term, publicationStatus: publication.status, publishedAtIso: publication.publishedAtIso, version: publication.version }));
  }
  return respond(() => {
    const state = loadSession();
    /* Withdrawn publications are not live: the term falls back to the honest
       not-published state until a corrected version is published again. */
    const livePublications = state.publications.filter((publication) => publication.withdrawnAtIso === undefined);
    const newestFirst = [...livePublications].sort((a, b) => b.publishedAtIso.localeCompare(a.publishedAtIso));
    return terms.map((term) => {
      const publication = newestFirst.find((item) => item.term === term.label);
      if (!publication) {
        return { id: term.id, label: term.label, publicationStatus: "not-published" as const };
      }
      return {
        id: term.id,
        label: term.label,
        publicationStatus: publication.status,
        publishedAtIso: publication.publishedAtIso,
        version: publication.version,
      };
    });
  });
}

/* --- Student result snapshots --------------------------------------- */

/**
 * The published per-student snapshot, seeded from the demo fixtures. The
 * rows are converted to the service-owned `SnapshotMarkRow` shape so the
 * portal never reads the term fixture directly. Returns null for a student
 * or academic year without a published snapshot.
 */
async function getStudentResultSnapshot(studentId: string, academicYearId: string): Promise<StudentResultSnapshot | null> {
  if (clientAdapterMode() === "supabase") {
    const response = await adapterCall<Array<{ term?: string; academicYearId?: string; items?: Array<{ snapshot: unknown }> }>>("results.listReleases", { studentRef: studentId });
    if (!response.ok) return null;
    const terms: Record<string, SnapshotMarkRow[]> = {};
    for (const publication of response.value) {
      if (publication.academicYearId !== undefined && publication.academicYearId !== academicYearId) continue;
      for (const item of publication.items ?? []) {
        const snapshot = item.snapshot;
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) continue;
        const value = snapshot as { term?: string; subject?: string; marks?: Array<{ max?: number; obtained?: number | null; component?: string; remark?: string; markStatus?: string; status?: string }> };
        const term = value.term ?? publication.term ?? "Results";
        terms[term] = [...(terms[term] ?? []), ...(value.marks ?? []).map((mark) => ({ subject: mark.component ?? value.subject ?? "Subject", max: Number(mark.max ?? 0), obtained: mark.obtained === null || mark.obtained === undefined ? null : Number(mark.obtained), remark: mark.remark, markStatus: mark.markStatus ?? mark.status }))];
      }
    }
    return Object.keys(terms).length === 0 ? null : { studentId, academicYearId, terms };
  }
  return respond(() => {
    /* The portal passes the student's public reference; the demo snapshot
       fixture is keyed by the internal student id. Resolve the reference so
       the same student always resolves to its published snapshot. */
    const byRef = new Map(demoStudents.map((student) => [student.ref, student.id]));
    const resolvedId = studentResultSnapshots[studentId] !== undefined ? studentId : (byRef.get(studentId) ?? studentId);
    const fixture = studentResultSnapshots[resolvedId];
    if (fixture === undefined || fixture.academicYearId !== academicYearId) return null;
    const terms: Record<string, SnapshotMarkRow[]> = {};
    for (const [label, marks] of Object.entries(fixture.terms)) {
      terms[label] = marks.map((mark) => ({
        subject: mark.subject,
        max: mark.max,
        obtained: mark.obtained,
        grade: mark.grade,
        remark: mark.remark,
      }));
    }
    return { studentId, academicYearId, terms };
  });
}

/* ------------------------------------------------------------------ */
/* The one exported facade                                             */
/* ------------------------------------------------------------------ */

export const academicsService: AcademicsService = {
  listBatches,
  getBatch,
  saveEntryDraft,
  submitForModeration,
  returnWithReason,
  approve,
  publish,
  startCorrection,
  withdrawPublication,
  getPublications,
  getPublication,
  listVersions,
  getTerms,
  getStudentResultSnapshot,
};
