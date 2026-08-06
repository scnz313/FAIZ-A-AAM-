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
import { auditService } from "@/modules/services/audit";
import { enqueueOutboxEvent } from "@/modules/services/outbox";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

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
};

/** A field-level problem; `subject` is null for batch-level errors. */
export type AcademicError = {
  subject: string | null;
  message: string;
};

/** Every write returns a typed outcome so the UI can surface errors. */
export type AcademicResult<T> = { ok: true; value: T } | { ok: false; errors: AcademicError[] };

/** One row of a published per-student result snapshot (obtained is never null). */
export type SnapshotMarkRow = {
  subject: string;
  max: number;
  obtained: number;
  grade?: Grade;
  remark?: string;
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
    .filter((row) => row.obtained === null)
    .map((row) => ({ subject: row.subject, message: "Marks not entered." }));
}

function statusLabel(status: EntryBatchStatus): string {
  return ENTRY_BATCH_STATUS_META[status].label;
}

/* --- Results implementation ---------------------------------------- */

async function listBatches(): Promise<EntryBatch[]> {
  return respond(() => Object.values(loadSession().batches).map(publicBatch));
}

async function getBatch(ref: string): Promise<EntryBatch | null> {
  return respond(() => {
    const batch = loadSession().batches[ref];
    return batch ? publicBatch(batch) : null;
  });
}

async function saveEntryDraft(ref: string, rows: MarksRow[]): Promise<AcademicResult<EntryBatch>> {
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
  return respond(() =>
    loadSession()
      .publications.filter((publication) => publication.withdrawnAtIso === undefined)
      .map((publication) => ({ ...publication })),
  );
}

async function getPublication(ref: string): Promise<Publication | null> {
  return respond(() => {
    const publication = loadSession().publications.find((item) => item.ref === ref);
    return publication ? { ...publication } : null;
  });
}

async function listVersions(batchRef: string): Promise<BatchVersion[]> {
  return respond(() => [...(loadSession().versions[batchRef] ?? [])]);
}

async function getTerms(): Promise<Term[]> {
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
  return respond(() => {
    const fixture = studentResultSnapshots[studentId];
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
