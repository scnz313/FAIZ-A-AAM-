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
import { demoAcademicYears, demoGradeSections, demoStudents } from "@/modules/relationships/demo";
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
  /** Assessment component label for student matrix rows (e.g. "Midterm"). */
  componentName?: string;
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
  /** A correction request awaiting independent reviewer approval (server rows). */
  pendingCorrectionReason?: string;
  /**
   * Queue-only counts from the server list projection (000109). The list
   * carries no roster or mark arrays; surfaces that need the full matrix
   * read it through `getBatch`. Never present these as authored values —
   * they are derived server-side from the same marks the detail read shows.
   */
  enteredCount?: number;
  totalCount?: number;
};

export type Publication = {
  ref: string;
  term: string;
  status: "final" | "provisional";
  /** Null when the release row carries no publication timestamp — never fabricated. */
  publishedAtIso: string | null;
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

/** One roster student's readiness for a per-student report release. */
export type ReportReleaseCandidate = {
  studentId: string;
  enrollmentId: string;
  studentName: string;
  /** Published subject snapshots for this academic year and term. */
  publicationIds: string[];
  /** The current release for the term, if one exists. */
  release: { releaseId: string; reference: string; version: number; status: string } | null;
};

export type ReportReleaseBatchSummary = {
  released: number;
  skipped: number;
  failed: Array<{ studentId: string; message: string }>;
};

/**
 * A correction request awaiting independent reviewer approval. The request
 * itself creates no editable record; approval opens a new draft entry sheet
 * linked to the published source (`sourceSheetRef`) and repeats the
 * maker/checker chain.
 */
export type PendingCorrection = {
  requestId: string;
  version: number;
  reason: string;
  status: string;
  requestedAtIso: string;
  releaseRef: string | null;
  publicationRef: string | null;
  sheetRef: string | null;
  subject: string | null;
  term: string | null;
  className: string | null;
};

/** The new editable sheet an approved correction opened. */
export type CorrectionApproval = {
  requestId: string;
  sheetRef: string;
  sheetVersion: number;
};

/**
 * One configured exam definition (term + class section) the signed-in result
 * officer may open a batch for. `subjects` contains only subjects with
 * configured assessment components inside the caller's role-grant scope, so
 * a create selection never fails for a missing component.
 */
export type ExamDefinitionOption = {
  id: string;
  ref: string;
  term: string;
  status: "planned" | "open" | "closed";
  academicYearId: string;
  academicYearLabel?: string;
  academicYearStatus?: string;
  gradeSectionId: string;
  gradeLabel: string;
  sectionLabel: string;
  subjects: Array<{ id: string; code: string; name: string }>;
};

/** Selection the create-batch panel resolves before calling the service. */
export type CreateBatchInput = {
  examDefinitionId: string;
  gradeSectionId: string;
  subjectId: string;
  idempotencyKey?: string;
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
  /**
   * Exam definitions (term + class section + scoped subjects) the signed-in
   * result officer may open a batch for. Read-only; an adapter/RLS failure is
   * returned as an error so the panel can offer a retry instead of an
   * honest-looking empty list.
   */
  listExamDefinitions(): Promise<AcademicResult<ExamDefinitionOption[]>>;
  /**
   * Create the entry sheet (batch) for one exam definition and subject. The
   * server freezes the active roster and assessment components; an existing
   * open sheet for the same selection is returned instead of duplicated.
   */
  createBatch(input: CreateBatchInput): Promise<AcademicResult<EntryBatch>>;
  getBatch(ref: string): Promise<EntryBatch | null>;
  saveEntryDraft(ref: string, rows: MarksRow[]): Promise<AcademicResult<EntryBatch>>;
  submitForModeration(ref: string, rows: MarksRow[], by?: string): Promise<AcademicResult<EntryBatch>>;
  returnWithReason(ref: string, reason: string, by?: string): Promise<AcademicResult<EntryBatch>>;
  approve(ref: string, by?: string): Promise<AcademicResult<EntryBatch>>;
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
  /**
   * Per-student release readiness for a published batch: the published
   * subject publications for the batch's term/year and the current release.
   * Live mode only; demo mode publishes straight to the portal.
   */
  listReleaseCandidates(ref: string): Promise<AcademicResult<ReportReleaseCandidate[]>>;
  /**
   * Assemble report releases for the batch's roster (all students unless
   * `studentIds` is given). One release per student; a failure for one
   * student never aborts the rest. Live mode only.
   */
  publishReportReleases(ref: string, options?: { studentIds?: string[] }): Promise<AcademicResult<ReportReleaseBatchSummary>>;
  /**
   * Correction requests awaiting independent reviewer approval. The request
   * is raised by the entry officer (or a publisher) against a published
   * release item; approval opens a new editable sheet. Live mode only.
   */
  listCorrections(): Promise<AcademicResult<PendingCorrection[]>>;
  /** Approve a pending correction request and return the new draft sheet. */
  approveCorrection(requestId: string, expectedVersion: number): Promise<AcademicResult<CorrectionApproval>>;
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
  /* Queue counts from `app.results_entry_sheet_list` (000109): the list
     projection intentionally carries no roster/mark arrays. */
  rosterCount?: number;
  componentCount?: number;
  enteredCount?: number;
  incompleteCount?: number;
  exam_definitions?: { term?: string; grade_sections?: { section_label?: string; grades?: { label?: string } | null } | null; assessment_components?: Array<{ id: string; name: string; max_marks: number }> } | null;
  result_rosters?: Array<{ id: string; mark_entries?: Array<{ component_id: string; obtained: number | null; absent: boolean; remark: string | null }> }>;
  /* Enrichment attached by the results.getBatch adapter operation. */
  versions?: Array<{ version?: number; state?: string; note?: string | null; createdAt?: string; created_at?: string; actorAccountId?: string; actor_account_id?: string }>;
  corrections?: Array<{ id?: string; reason?: string; version?: number; status?: string }>;
};

function supabaseBatchStatus(status: string): EntryBatchStatus {
  return status as EntryBatchStatus;
}

export function mapServerResultBatch(row: SupabaseResultRow): EntryBatch {
  const workflowNote = serverWorkflowNote(row);
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
      /* A person record may carry an empty display name (imported or pending
         correction); never render a label-less row in the marks matrix. */
      studentName: candidate.studentName?.trim() ? candidate.studentName.trim() : "Student",
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
        componentName: component.name,
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
      returnedReason: workflowNote.returnedReason,
      note: workflowNote.note,
      pendingCorrectionReason: workflowNote.pendingCorrectionReason,
      entrySheet: { id: row.id, ref: row.reference, examDefinitionId: row.examDefinitionId, academicYearId: row.academicYearId, gradeSectionId: row.gradeSectionId, subjectId: row.subjectId, state: supabaseBatchStatus(row.state ?? row.status), version: row.version, components, roster },
    };
  }
  /* Queue shape (000109): the list projection carries counts only, so the
     queue computes "entered / total" from them instead of a full matrix.
     `entrySheet` is intentionally absent; the entry workspace and detail
     page read the full sheet through `getBatch`. */
  if (typeof row.rosterCount === "number" && typeof row.componentCount === "number") {
    return {
      ref: row.reference,
      exam: row.examTerm ?? "Results",
      className: `${row.gradeLabel ?? "Class"} · ${row.sectionLabel ?? ""}`.trim(),
      subject: row.subjectName ?? "",
      status: supabaseBatchStatus(row.state ?? row.status),
      rows: [],
      totalsIncomplete: (row.incompleteCount ?? 0) > 0,
      version: row.version,
      enteredCount: row.enteredCount ?? 0,
      totalCount: row.rosterCount * row.componentCount,
      returnedReason: workflowNote.returnedReason,
      note: workflowNote.note,
      pendingCorrectionReason: workflowNote.pendingCorrectionReason,
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
    returnedReason: workflowNote.returnedReason,
    note: workflowNote.note,
    pendingCorrectionReason: workflowNote.pendingCorrectionReason,
  };
}

/** The entry sheet carries no workflow note column; the latest returned
 * version (or a pending correction request) is the authoritative reason. */
function serverWorkflowNote(row: SupabaseResultRow): {
  returnedReason?: string;
  note?: string;
  pendingCorrectionReason?: string;
} {
  const status = supabaseBatchStatus(row.state ?? row.status);
  const returned = (row.versions ?? []).find((version) => version.state === "returned" && typeof version.note === "string" && version.note.trim() !== "");
  const returnedReason = returned?.note?.trim();
  const pendingCorrectionReason = (row.corrections ?? []).find((correction) => typeof correction.reason === "string" && correction.reason.trim() !== "")?.reason?.trim();
  if (status === "returned" && returnedReason !== undefined) {
    return { returnedReason, note: `Returned for correction — ${returnedReason}` };
  }
  if (pendingCorrectionReason !== undefined) {
    return { pendingCorrectionReason, note: `Correction pending reviewer approval — ${pendingCorrectionReason}` };
  }
  return {};
}

export function mapServerResultVersion(row: { version?: number; state?: string; note?: string | null; createdAt?: string; created_at?: string }): BatchVersion {
  /* The actor is only exposed as an internal account id; never render a raw
     UUID as a person's name. The timestamp may be absent — never fabricate. */
  return {
    version: row.version ?? 0,
    note: row.note ?? "",
    atIso: row.createdAt ?? row.created_at ?? "",
    state: row.state,
  };
}

async function supabaseBatch(ref: string): Promise<{ id: string; raw: SupabaseResultRow } | null> {
  const listed = await adapterCall<SupabaseResultRow[]>("results.listBatches", {});
  if (!listed.ok) return null;
  const raw = listed.value.find((candidate) => candidate.reference === ref || candidate.id === ref);
  return raw ? { id: raw.id, raw } : null;
}

/** Server projection row from `results.examDefinitions` (migration 000094). */
export type SupabaseExamDefinitionRow = {
  id: string;
  reference?: string;
  term: string;
  status?: string;
  academicYearId?: string;
  academicYearLabel?: string;
  academicYearStatus?: string;
  gradeSectionId: string;
  gradeLabel?: string;
  sectionLabel?: string;
  subjects?: Array<{ id: string; code?: string; name: string }>;
};

export function mapServerExamDefinition(row: SupabaseExamDefinitionRow): ExamDefinitionOption {
  const status = row.status === "planned" || row.status === "closed" ? row.status : "open";
  return {
    id: row.id,
    ref: row.reference ?? row.id,
    term: row.term,
    status,
    academicYearId: row.academicYearId ?? "",
    academicYearLabel: row.academicYearLabel,
    academicYearStatus: row.academicYearStatus,
    gradeSectionId: row.gradeSectionId,
    gradeLabel: row.gradeLabel ?? "Class",
    sectionLabel: row.sectionLabel ?? "",
    subjects: (row.subjects ?? []).map((subject) => ({ id: subject.id, code: subject.code ?? "", name: subject.name })),
  };
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

/** Internal batch record: public fields plus correction/publisher audit.
 * submittedBy/approvedBy exist only to enforce demo role separation
 * (entry officer vs moderator vs publisher, no self-publish) when callers
 * supply an explicit actor. The definition/scope ids exist only so a demo
 * create is idempotent for the same exam, section, and subject. Supabase mode
 * delegates all of this to the server. */
type SessionBatch = EntryBatch & {
  correctionReason?: string;
  publishedBy?: string;
  submittedBy?: string;
  approvedBy?: string;
  examDefinitionId?: string;
  gradeSectionId?: string;
  subjectId?: string;
};

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

/* --- Demo exam definitions (batch creation) ------------------------- */

function demoSubjectSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function demoSubjectCode(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

/**
 * Deterministic demo exam definitions for the batch-creation panel. Only
 * terms with marks fixtures are offered, so a demo-created batch always has
 * a configured maximum for its subject; active class sections only. These
 * are fictional fixtures, not a server contract.
 */
export function demoExamDefinitions(): ExamDefinitionOption[] {
  const yearById = new Map(demoAcademicYears.map((year) => [year.id, year]));
  const activeSections = demoGradeSections.filter((section) => section.status === "active");
  const options: ExamDefinitionOption[] = [];
  for (const term of Object.keys(marksByTerm)) {
    const marks = marksByTerm[term] ?? [];
    for (const section of activeSections) {
      const year = yearById.get(section.academicYearId);
      options.push({
        id: `demo-exam:${demoSubjectSlug(term)}:${section.id}`,
        ref: `EXM-DEMO-${demoSubjectSlug(term)}-${section.sectionLabel}`,
        term,
        status: "open",
        academicYearId: section.academicYearId,
        academicYearLabel: year?.label,
        academicYearStatus: year?.status,
        gradeSectionId: section.id,
        gradeLabel: section.gradeLabel,
        sectionLabel: section.sectionLabel,
        subjects: marks.map((mark) => ({
          id: `demo-subject:${demoSubjectSlug(mark.subject)}`,
          code: demoSubjectCode(mark.subject),
          name: mark.subject,
        })),
      });
    }
  }
  return options;
}

/** Next free demo batch reference (fixtures occupy RB-2026-0138..0144). */
function nextDemoBatchRef(state: AcademicsSession): string {
  const numbers = Object.keys(state.batches)
    .map((ref) => Number(ref.replace(/^RB-2026-/, "")))
    .filter((value) => Number.isFinite(value));
  const next = (numbers.length === 0 ? 137 : Math.max(...numbers)) + 1;
  return `RB-2026-${String(next).padStart(4, "0")}`;
}

function publicBatch(batch: SessionBatch): EntryBatch {
  return {
    ref: batch.ref,
    exam: batch.exam,
    className: batch.className,
    subject: batch.subject,
    status: batch.status,
    rows: batch.rows.map((row) => ({ ...row })),
    totalsIncomplete: batch.totalsIncomplete,
    returnedReason: batch.returnedReason,
    version: batch.version,
    publishedAtIso: batch.publishedAtIso,
    note: batch.note,
    entrySheet: batch.entrySheet === undefined ? undefined : (JSON.parse(JSON.stringify(batch.entrySheet)) as ResultEntrySheet),
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
    const batches = response.value.map(mapServerResultBatch);
    /* One extra read annotates every published row whose correction request is
       still awaiting reviewer approval; a failed read never fails the queue. */
    const corrections = await adapterCall<Array<{ sheet_reference?: string | null; reason?: string }>>("results.listCorrections", {});
    if (corrections.ok) {
      const reasons = new Map<string, string>();
      for (const correction of corrections.value) {
        if (typeof correction.sheet_reference === "string" && correction.sheet_reference !== "" && typeof correction.reason === "string" && correction.reason.trim() !== "") {
          reasons.set(correction.sheet_reference, correction.reason.trim());
        }
      }
      return batches.map((batch) => {
        const reason = reasons.get(batch.ref);
        return reason === undefined ? batch : { ...batch, pendingCorrectionReason: reason, note: `Correction pending reviewer approval — ${reason}` };
      });
    }
    return batches;
  }
  return respond(() => Object.values(loadSession().batches).map(publicBatch));
}

async function getBatch(ref: string): Promise<EntryBatch | null> {
  if (clientAdapterMode() === "supabase") {
    /* A single bounded detail read: the reference resolves server-side, so the
       whole queue is never listed just to find one batch. */
    const detail = await adapterCall<SupabaseResultRow | null>("results.getBatch", { batchRef: ref });
    if (!detail.ok) throw new Error(detail.errors[0]?.message ?? "The result batch could not be read.");
    return detail.value === null ? null : mapServerResultBatch(detail.value);
  }
  return respond(() => {
    const batch = loadSession().batches[ref];
    return batch ? publicBatch(batch) : null;
  });
}

async function listExamDefinitions(): Promise<AcademicResult<ExamDefinitionOption[]>> {
  if (clientAdapterMode() === "supabase") {
    const response = await adapterCall<SupabaseExamDefinitionRow[]>("results.examDefinitions", {});
    if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
    return { ok: true, value: response.value.map(mapServerExamDefinition) };
  }
  return respond(() => ({ ok: true as const, value: demoExamDefinitions() }));
}

async function createBatch(input: CreateBatchInput): Promise<AcademicResult<EntryBatch>> {
  if (clientAdapterMode() === "supabase") {
    const response = await adapterCall<SupabaseResultRow>("results.createBatch", {
      examDefinitionId: input.examDefinitionId,
      gradeSectionId: input.gradeSectionId,
      subjectId: input.subjectId,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    });
    if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
    return { ok: true, value: mapServerResultBatch(response.value) };
  }
  return respond(() => {
    const state = loadSession();
    const definition = demoExamDefinitions().find((candidate) => candidate.id === input.examDefinitionId);
    if (!definition) return fail("The selected exam is not available.");
    const subject = definition.subjects.find((candidate) => candidate.id === input.subjectId);
    if (!subject) return fail("The selected subject is not configured for this exam.");
    /* The same selection reopens the open demo batch instead of duplicating:
       mirrors the server's active-sheet lookup. */
    const existing = Object.values(state.batches).find(
      (batch) =>
        batch.examDefinitionId === input.examDefinitionId &&
        batch.gradeSectionId === input.gradeSectionId &&
        batch.subjectId === input.subjectId &&
        batch.status !== "withdrawn",
    );
    if (existing) return { ok: true, value: publicBatch(existing) };
    const marks = (marksByTerm[definition.term] ?? []).find((mark) => mark.subject === subject.name);
    if (!marks) return fail("The chosen term has no configured marks maximum for this subject.");
    const className = `${definition.gradeLabel.replace(/^Class\s+/i, "")}-${definition.sectionLabel}`;
    const batch: SessionBatch = {
      ref: nextDemoBatchRef(state),
      exam: definition.term,
      className,
      subject: subject.name,
      status: "draft",
      rows: [{ subject: subject.name, max: marks.max, obtained: null }],
      totalsIncomplete: true,
      version: 1,
      examDefinitionId: definition.id,
      gradeSectionId: definition.gradeSectionId,
      subjectId: subject.id,
    };
    state.batches[batch.ref] = batch;
    saveSession(state);
    return { ok: true, value: publicBatch(batch) };
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

async function submitForModeration(ref: string, rows: MarksRow[], by?: string): Promise<AcademicResult<EntryBatch>> {
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
    if (by !== undefined && by.trim() !== "") batch.submittedBy = by.trim();
    batch.approvedBy = undefined;
    saveSession(state);
    return { ok: true, value: publicBatch(batch) };
  });
}

async function returnWithReason(ref: string, reason: string, _by?: string): Promise<AcademicResult<EntryBatch>> {
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

async function approve(ref: string, by?: string): Promise<AcademicResult<EntryBatch>> {
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
    const approver = by?.trim() ? by.trim() : undefined;
    if (approver !== undefined && batch.submittedBy !== undefined && approver === batch.submittedBy) {
      return fail("Moderation requires a different reviewer — the entry officer cannot approve their own sheet.");
    }
    batch.status = "approved";
    if (approver !== undefined) batch.approvedBy = approver;
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
    return { ok: true, value: { ref: publicationRef, term: resolved.raw.exam_definitions?.term ?? resolved.raw.examTerm ?? "Results", status: "final", publishedAtIso: item?.published_at ?? null, version: item?.version ?? resolved.raw.version } };
  }
  return respond(() => {
    const state = loadSession();
    const batch = state.batches[ref];
    if (!batch) return fail("Batch not found.");
    if (batch.status === "published") return fail("This batch is already published — corrections release as a new version.");
    if (batch.status !== "approved") {
      return fail(`Only approved sheets can be published — the batch is ${statusLabel(batch.status)}.`);
    }
    const publisher = by?.trim() ? by.trim() : undefined;
    if (publisher !== undefined && batch.approvedBy !== undefined && publisher === batch.approvedBy) {
      return fail("Publishing requires a different publisher — the moderator cannot publish their own approval (no self-publish).");
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
    batch.publishedAtIso = publication.publishedAtIso ?? demoNowIso();
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
    const resolved = await supabaseBatch(ref);
    if (!resolved) return fail("Batch not found.");
    /* A correction is requested against the published report release item that
       carries this sheet — never against the batch reference. Approval by an
       independent reviewer opens a new editable sheet linked to the source. */
    const releases = await adapterCall<Array<{
      id?: string;
      reference?: string;
      status?: string;
      publishedAt?: string;
      items?: Array<{ publicationId?: string; entrySheetId?: string | null; subjectId?: string }>;
    }>>("results.listReleases", {});
    if (!releases.ok) return { ok: false, errors: releases.errors.map((error) => ({ subject: null, message: error.message })) };
    const candidates = releases.value
      .filter((release) => release.status === "published")
      .filter((release) => (release.items ?? []).some((item) => item.entrySheetId === resolved.id))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    const release = candidates[0];
    const target = release?.items?.find((item) => item.entrySheetId === resolved.id);
    if (release === undefined || target === undefined || typeof target.publicationId !== "string") {
      return fail("This batch has no published report release to correct yet. Assemble its report release first.");
    }
    const request = await adapterCall<{ requestId: string }>("results.requestCorrection", { releaseId: release.id, publicationId: target.publicationId, reason });
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
    /* Deep-clone rows so later edits to the correction draft cannot mutate
       the published version's bytes held by earlier readers. */
    batch.rows = batch.rows.map((row) => ({ ...row }));
    batch.totalsIncomplete = batch.rows.some((row) => row.obtained === null);
    batch.note = `Correction v${version} — ${reason.trim()}`;
    batch.submittedBy = undefined;
    batch.approvedBy = undefined;
    state.versions[batch.ref] = [{ version, note: reason.trim(), atIso: demoNowIso(), by }, ...(state.versions[batch.ref] ?? [])];
    saveSession(state);
    return { ok: true, value: publicBatch(batch) };
  });
}

async function withdrawPublication(ref: string, reason: string, by: string = DEFAULT_ACTOR): Promise<AcademicResult<EntryBatch>> {
  if (clientAdapterMode() === "supabase") {
    /* The caller passes a batch reference (RES-...); resolve it to the batch's
       active publication (PUB-...). Sheet-native publications carry no
       batch_id, so both the sheet link and the legacy batch link are matched. */
    const publications = await adapterCall<Array<{ id: string; reference: string; batch_id?: string | null; source_entry_sheet_id?: string | null; version?: number; status?: string }>>("results.listPublications", {});
    if (!publications.ok) return { ok: false, errors: publications.errors.map((error) => ({ subject: null, message: error.message })) };
    const active = publications.value.filter((candidate) => candidate.status !== "withdrawn");
    let publication = active.find((candidate) => candidate.reference === ref);
    if (!publication) {
      const resolved = await supabaseBatch(ref);
      if (resolved) {
        publication = [...active]
          .filter((candidate) => candidate.source_entry_sheet_id === resolved.id || candidate.batch_id === resolved.id)
          .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
      }
    }
    if (!publication) return fail("No live publication was found for this batch.");
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
    /* A failed read must reject so the portal shows an error with retry
       instead of an honest-looking empty list. */
    if (!response.ok) throw new Error(response.errors[0]?.message ?? "Published results could not be loaded.");
    return response.value.map((publication) => ({ ref: publication.reference, term: publication.term ?? "Results", status: publication.status === "provisional" ? "provisional" : "final", publishedAtIso: publication.publishedAt ?? publication.published_at ?? null, version: publication.version, releaseId: publication.id, releaseVersion: publication.version, items: publication.items }));
  }
  return respond(() =>
    loadSession()
      .publications.filter((publication) => publication.withdrawnAtIso === undefined)
      .map((publication) => ({ ...publication, items: publication.items?.map((item) => ({ ...item })) })),
  );
}

async function getPublication(ref: string): Promise<Publication | null> {
  if (clientAdapterMode() === "supabase") {
    const publications = await getPublications();
    return publications.find((publication) => publication.ref === ref) ?? null;
  }
  return respond(() => {
    const publication = loadSession().publications.find((item) => item.ref === ref);
    return publication ? { ...publication, items: publication.items?.map((item) => ({ ...item })) } : null;
  });
}

async function listVersions(batchRef: string): Promise<BatchVersion[]> {
  if (clientAdapterMode() === "supabase") {
    const resolved = await supabaseBatch(batchRef);
    if (!resolved) return [];
    const response = await adapterCall<Array<{ version?: number; state?: string; note?: string | null; createdAt?: string; created_at?: string; actorAccountId?: string; created_by_account_id?: string }>>("results.listVersions", { sheetRef: resolved.raw.reference });
    if (!response.ok) return [];
    return response.value.map(mapServerResultVersion);
  }
  return respond(() => (loadSession().versions[batchRef] ?? []).map((entry) => ({ ...entry })));
}

async function getTerms(): Promise<Term[]> {
  if (clientAdapterMode() === "supabase") {
    const publications = await getPublications();
    return publications.map((publication) => ({ id: publication.ref, label: publication.term, publicationStatus: publication.status, publishedAtIso: publication.publishedAtIso ?? undefined, version: publication.version }));
  }
  return respond(() => {
    const state = loadSession();
    /* Withdrawn publications are not live: the term falls back to the honest
       not-published state until a corrected version is published again. */
    const livePublications = state.publications.filter((publication) => publication.withdrawnAtIso === undefined);
    const newestFirst = [...livePublications].sort((a, b) => (b.publishedAtIso ?? "").localeCompare(a.publishedAtIso ?? ""));
    return terms.map((term) => {
      const publication = newestFirst.find((item) => item.term === term.label);
      if (!publication) {
        return { id: term.id, label: term.label, publicationStatus: "not-published" as const };
      }
      return {
        id: term.id,
        label: term.label,
        publicationStatus: publication.status,
        publishedAtIso: publication.publishedAtIso ?? undefined,
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
    /* A transport/authorization failure must reject: callers render an error
       with retry. Only a successful read with no rows is "no snapshot". */
    if (!response.ok) throw new Error(response.errors[0]?.message ?? "The released report could not be loaded.");
    const terms: Record<string, SnapshotMarkRow[]> = {};
    for (const publication of response.value) {
      if (publication.academicYearId !== undefined && publication.academicYearId !== academicYearId) continue;
      for (const item of publication.items ?? []) {
        const snapshot = item.snapshot;
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) continue;
        const value = snapshot as { term?: string; subject?: string; marks?: Array<{ max?: number; obtained?: number | null; component?: string; remark?: string; markStatus?: string; status?: string }> };
        const term = value.term ?? publication.term ?? "Results";
        const subjectName = typeof value.subject === "string" && value.subject.trim() !== "" ? value.subject.trim() : null;
        const marks = value.marks ?? [];
        terms[term] = [...(terms[term] ?? []), ...marks.map((mark) => ({
          /* The subject is the report row; a subject with several components
             names each component after it. Never show only the component. */
          subject: subjectName !== null
            ? (marks.length > 1 ? `${subjectName} · ${mark.component ?? "Mark"}` : subjectName)
            : mark.component ?? "Subject",
          max: Number(mark.max ?? 0),
          obtained: mark.obtained === null || mark.obtained === undefined ? null : Number(mark.obtained),
          remark: mark.remark,
          markStatus: mark.markStatus ?? mark.status,
        }))];
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
/* Report release assembly (live mode)                                 */
/* ------------------------------------------------------------------ */

async function listReleaseCandidates(ref: string): Promise<AcademicResult<ReportReleaseCandidate[]>> {
  if (clientAdapterMode() !== "supabase") {
    /* Demo mode publishes straight to the portal: there is no separate
       release manifest to assemble, so there is nothing to list. */
    return { ok: true, value: [] };
  }
  const resolved = await supabaseBatch(ref);
  if (!resolved) return fail("Batch not found.");
  const response = await adapterCall<Array<{
    studentId: string;
    enrollmentId: string;
    studentName?: string;
    publications?: Array<{ publicationId: string; reference?: string }>;
    release?: { releaseId: string; reference: string; version: number; status: string } | null;
  }>>("results.releaseCandidates", { sheetRef: resolved.raw.reference });
  if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
  return {
    ok: true,
    value: response.value.map((candidate) => ({
      studentId: candidate.studentId,
      enrollmentId: candidate.enrollmentId,
      studentName: candidate.studentName?.trim() ? candidate.studentName.trim() : "Student",
      publicationIds: (candidate.publications ?? []).map((publication) => publication.publicationId),
      release: candidate.release ?? null,
    })),
  };
}

async function publishReportReleases(ref: string, options?: { studentIds?: string[] }): Promise<AcademicResult<ReportReleaseBatchSummary>> {
  if (clientAdapterMode() !== "supabase") {
    return fail("Report releases are assembled by the server; demo mode publishes directly to the portal.");
  }
  const resolved = await supabaseBatch(ref);
  if (!resolved) return fail("Batch not found.");
  const response = await adapterCall<{ released?: number; skipped?: number; failed?: Array<{ studentId: string; message: string }> }>(
    "results.publishReleaseBatch",
    {
      sheetRef: resolved.raw.reference,
      studentIds: options?.studentIds,
      idempotencyKey: `release-batch:${resolved.raw.reference}`,
    },
  );
  if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
  return {
    ok: true,
    value: {
      released: response.value.released ?? 0,
      skipped: response.value.skipped ?? 0,
      failed: response.value.failed ?? [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Correction requests (maker/checker depth)                            */
/* ------------------------------------------------------------------ */

async function listCorrections(): Promise<AcademicResult<PendingCorrection[]>> {
  if (clientAdapterMode() !== "supabase") {
    /* Demo mode corrects in place: there is no separate approval request. */
    return { ok: true, value: [] };
  }
  const response = await adapterCall<Array<{
    id?: string;
    version?: number;
    reason?: string;
    status?: string;
    created_at?: string;
    release_reference?: string | null;
    publication_id?: string | null;
    sheet_reference?: string | null;
    subject_name?: string | null;
    term?: string | null;
    section_label?: string | null;
    grade_label?: string | null;
  }>>("results.listCorrections", {});
  if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
  return {
    ok: true,
    value: response.value.map((row) => ({
      requestId: row.id ?? "",
      version: row.version ?? 1,
      reason: row.reason ?? "",
      status: row.status ?? "requested",
      requestedAtIso: row.created_at ?? "",
      releaseRef: row.release_reference ?? null,
      publicationRef: row.publication_id ?? null,
      sheetRef: row.sheet_reference ?? null,
      subject: row.subject_name ?? null,
      term: row.term ?? null,
      className: row.grade_label === null || row.grade_label === undefined
        ? null
        : `${row.grade_label}${row.section_label ? ` · ${row.section_label}` : ""}`,
    })),
  };
}

async function approveCorrection(requestId: string, expectedVersion: number): Promise<AcademicResult<CorrectionApproval>> {
  if (clientAdapterMode() !== "supabase") {
    return fail("Correction approval is only available against the live results service.");
  }
  const response = await adapterCall<{ requestId?: string; sheetId?: string; sheetRef?: string; sheetVersion?: number }>("results.approveCorrection", {
    requestId,
    expectedVersion,
  });
  if (!response.ok) return { ok: false, errors: response.errors.map((error) => ({ subject: null, message: error.message })) };
  const sheetRef = response.value.sheetRef;
  if (typeof sheetRef !== "string" || sheetRef === "") {
    return fail("The correction was approved but the new entry sheet reference was not returned.");
  }
  return {
    ok: true,
    value: {
      requestId: response.value.requestId ?? requestId,
      sheetRef,
      sheetVersion: response.value.sheetVersion ?? 1,
    },
  };
}

/* ------------------------------------------------------------------ */
/* The one exported facade                                             */
/* ------------------------------------------------------------------ */

export const academicsService: AcademicsService = {
  listBatches,
  listExamDefinitions,
  createBatch,
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
  listReleaseCandidates,
  publishReportReleases,
  listCorrections,
  approveCorrection,
};
