/**
 * Deterministic tests for the academics demo adapter (modules/services/academics.ts).
 *
 * Every test pins the demo clock and clears the demo session keys so the
 * adapter reseeds from its fixtures. The adapter is async with ~200 ms
 * simulated latency, so tests are async and wait on the promises.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { academicsService } from "@/modules/services/academics";
import { auditService, AUDIT_SESSION_KEY_EXPORT } from "@/modules/services/audit";
import { clearOutboxSession, listOutboxEvents } from "@/modules/services/outbox";
import { sessionKey, sessionRemove } from "@/modules/services/session";
import { RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import { assignmentsCoverBatch } from "@/components/staff/MarksEntry";
import type { AssignmentScope } from "@/components/staff/MarksEntry";
import { staffContextService } from "@/modules/services/staff-context";
import type { EntryBatch, MarksRow } from "@/modules/services/academics";

const SESSION_KEY = sessionKey("academics");
const PINNED = "2026-08-10T05:00:00.000Z";
const ACTOR = "M. Wani (exam office)";
/** Rania Mir — Principal profile with result_entry_officer (marks entry). */
const RESULT_ENTRY_ACCOUNT_ID = "00000000-0000-4000-8000-000000000205";

beforeEach(() => {
  sessionRemove(SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  clearOutboxSession();
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
  setDemoNow(new Date(PINNED));
});

afterEach(() => {
  sessionRemove(SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  clearOutboxSession();
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
  setDemoNow(null);
});

/** The demo draft batch (Term 2 · 6-A) starts with no marks entered. */
const DRAFT_REF = "RB-2026-0141";
/** The demo published batch (Term 1 · 8-A) is the correction source. */
const PUBLISHED_REF = "RB-2026-0138";
/** The demo moderation batch (Term 1 · 9-A) is the return source. */
const MODERATION_REF = "RB-2026-0139";

function fillRows(batch: EntryBatch, marks: number = 70): MarksRow[] {
  return batch.rows.map((row) => ({ ...row, obtained: Math.min(marks, row.max) }));
}

describe("listBatches / getBatch", () => {
  it("seeds the demo batch queue with the draft batch incomplete", async () => {
    const batches = await academicsService.listBatches();
    expect(batches.map((batch) => batch.ref)).toEqual([
      "RB-2026-0138",
      "RB-2026-0139",
      "RB-2026-0140",
      "RB-2026-0141",
      "RB-2026-0142",
      "RB-2026-0143",
      "RB-2026-0144",
    ]);

    const draft = await academicsService.getBatch(DRAFT_REF);
    expect(draft).not.toBeNull();
    expect(draft?.status).toBe("draft");
    expect(draft?.version).toBe(1);
    expect(draft?.rows).toHaveLength(7);
    expect(draft?.rows.every((row) => row.obtained === null)).toBe(true);
    expect(draft?.totalsIncomplete).toBe(true);

    const published = await academicsService.getBatch(PUBLISHED_REF);
    expect(published?.status).toBe("published");
    expect(published?.rows.every((row) => row.obtained !== null)).toBe(true);
    expect(published?.totalsIncomplete).toBe(false);
  });

  it("seeds each fixture batch with its subject", async () => {
    const batches = await academicsService.listBatches();
    const byRef = new Map(batches.map((batch) => [batch.ref, batch.subject]));
    expect(byRef.get("RB-2026-0138")).toBe("Mathematics");
    expect(byRef.get("RB-2026-0139")).toBe("General Science");
    expect(byRef.get("RB-2026-0140")).toBe("English");
    expect(byRef.get("RB-2026-0141")).toBe("Mathematics");
    expect(byRef.get("RB-2026-0142")).toBe("General Science");
    expect(byRef.get("RB-2026-0143")).toBe("General Science");
    expect(byRef.get("RB-2026-0144")).toBe("Mathematics");
  });

  it("returns null for an unknown batch ref", async () => {
    expect(await academicsService.getBatch("RB-9999")).toBeNull();
  });
});

describe("validation", () => {
  it("blocks submit for moderation while rows are incomplete", async () => {
    const draft = await academicsService.getBatch(DRAFT_REF);
    const result = await academicsService.submitForModeration(DRAFT_REF, draft!.rows);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.subject === "English" && error.message === "Marks not entered.")).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(7);

    /* The batch stays a draft and nothing was persisted. */
    const after = await academicsService.getBatch(DRAFT_REF);
    expect(after?.status).toBe("draft");
    expect(after?.totalsIncomplete).toBe(true);
  });

  it("rejects negative marks and marks above the maximum", async () => {
    const draft = await academicsService.getBatch(DRAFT_REF);
    const rows = fillRows(draft!, 60);

    const negative = await academicsService.saveEntryDraft(
      DRAFT_REF,
      rows.map((row) => (row.subject === "English" ? { ...row, obtained: -4 } : row)),
    );
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.errors[0]?.message).toBe("Marks cannot be negative.");

    const overMax = await academicsService.saveEntryDraft(
      DRAFT_REF,
      rows.map((row) => (row.subject === "Mathematics" ? { ...row, obtained: row.max + 1 } : row)),
    );
    expect(overMax.ok).toBe(false);
    if (!overMax.ok) expect(overMax.errors[0]?.message).toBe(`Marks exceed the maximum of 100.`);

    /* Invalid rows never persist. */
    const after = await academicsService.getBatch(DRAFT_REF);
    expect(after?.rows.every((row) => row.obtained === null)).toBe(true);
  });

  it("blocks approve from the wrong state", async () => {
    const result = await academicsService.approve(DRAFT_REF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/awaiting moderation/);
  });
});

describe("the marks-entry journey", () => {
  it("runs draft → submitted → approved → published and appears in the portal publications", async () => {
    const draft = await academicsService.getBatch(DRAFT_REF);
    const rows = fillRows(draft!);

    const saved = await academicsService.saveEntryDraft(DRAFT_REF, rows);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.totalsIncomplete).toBe(false);
    expect(saved.value.rows[0]?.grade).toBe("B"); /* 70/100 → B under the demo scheme */

    const submitted = await academicsService.submitForModeration(DRAFT_REF, rows);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.value.status).toBe("submitted");
    expect(submitted.value.returnedReason).toBeUndefined();

    const approved = await academicsService.approve(DRAFT_REF);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.status).toBe("approved");

    const published = await academicsService.publish(DRAFT_REF, ACTOR);
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.ref).toBe("PUB-2026-003"); /* fixtures occupy 001–002 */
    expect(published.value.publishedAtIso).toBe(PINNED);
    expect(published.value.term).toBe("Term 2");
    expect(published.value.version).toBe(1);

    /* The portal reads the same adapter — the fresh publication is listed. */
    const publications = await academicsService.getPublications();
    expect(publications.map((publication) => publication.ref)).toContain("PUB-2026-003");
    const detail = await academicsService.getPublication("PUB-2026-003");
    expect(detail?.term).toBe("Term 2");
    expect(detail?.publishedAtIso).toBe(PINNED);

    const batch = await academicsService.getBatch(DRAFT_REF);
    expect(batch?.status).toBe("published");
    expect(batch?.publishedAtIso).toBe(PINNED);
  });

  it("blocks a duplicate publish — the batch is already published", async () => {
    const draft = await academicsService.getBatch(DRAFT_REF);
    const rows = fillRows(draft!);
    await academicsService.saveEntryDraft(DRAFT_REF, rows);
    await academicsService.submitForModeration(DRAFT_REF, rows);
    await academicsService.approve(DRAFT_REF);
    const first = await academicsService.publish(DRAFT_REF, ACTOR);
    expect(first.ok).toBe(true);

    const second = await academicsService.publish(DRAFT_REF, ACTOR);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors[0]?.message).toMatch(/already published/);

    /* No duplicate publication and no counter skip. */
    const publications = await academicsService.getPublications();
    expect(publications.map((publication) => publication.ref)).toEqual(["PUB-2026-001", "PUB-2026-002", "PUB-2026-003"]);
    expect(await academicsService.getPublication("PUB-2026-004")).toBeNull();
  });

  it("returns a moderation sheet with a reason and allows re-submission", async () => {
    const returned = await academicsService.returnWithReason(MODERATION_REF, "Recheck the Urdu grade.");
    expect(returned.ok).toBe(true);
    if (!returned.ok) return;
    expect(returned.value.status).toBe("returned");
    expect(returned.value.returnedReason).toBe("Recheck the Urdu grade.");

    /* An empty reason is rejected. */
    const blank = await academicsService.returnWithReason(MODERATION_REF, "   ");
    expect(blank.ok).toBe(false);

    /* Re-submitting returns the sheet to moderation. */
    const sheet = await academicsService.getBatch(MODERATION_REF);
    const resubmitted = await academicsService.submitForModeration(MODERATION_REF, sheet!.rows);
    expect(resubmitted.ok).toBe(true);
    if (!resubmitted.ok) return;
    expect(resubmitted.value.status).toBe("submitted");
    expect(resubmitted.value.returnedReason).toBeUndefined();
  });

  it("correction bumps the version and publishes as v2 with a correction note", async () => {
    const corrected = await academicsService.startCorrection(PUBLISHED_REF, "Urdu grade rechecked", ACTOR);
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.value.version).toBe(2);
    expect(corrected.value.status).toBe("draft");

    const versions = await academicsService.listVersions(PUBLISHED_REF);
    expect(versions[0]?.version).toBe(2);
    expect(versions[0]?.note).toBe("Urdu grade rechecked");
    expect(versions[0]?.atIso).toBe(PINNED);

    /* The correction sheet is editable (marks preserved) and can be published. */
    const sheet = await academicsService.getBatch(PUBLISHED_REF);
    expect(sheet?.rows.every((row) => row.obtained !== null)).toBe(true);
    const submitted = await academicsService.submitForModeration(PUBLISHED_REF, sheet!.rows);
    expect(submitted.ok).toBe(true);
    await academicsService.approve(PUBLISHED_REF);
    const published = await academicsService.publish(PUBLISHED_REF, ACTOR);
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.version).toBe(2);
    expect(published.value.correctionNote).toContain("Urdu grade rechecked");

    /* The portal term view reflects the corrected publication. */
    const terms = await academicsService.getTerms();
    const term1 = terms.find((term) => term.id === "term-1");
    expect(term1?.publicationStatus).toBe("final");
    expect(term1?.publishedAtIso).toBe(PINNED);
    expect(term1?.version).toBe(2);
  });
});

describe("publication events (outbox + audit)", () => {
  it("publish enqueues exactly one results.published event and one audit row with the published version", async () => {
    const draft = await academicsService.getBatch(DRAFT_REF);
    const rows = fillRows(draft!);
    await academicsService.saveEntryDraft(DRAFT_REF, rows);
    await academicsService.submitForModeration(DRAFT_REF, rows);
    await academicsService.approve(DRAFT_REF);

    const published = await academicsService.publish(DRAFT_REF, ACTOR);
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.version).toBe(1);

    const events = listOutboxEvents().filter((event) => event.kind === "results.published");
    expect(events).toHaveLength(1);
    expect(events[0]?.eventId).toBe(`results.published:${DRAFT_REF}:v1`);
    expect(events[0]?.targetRef).toBe(DRAFT_REF);
    expect(events[0]?.actor).toBe(ACTOR);
    /* The seeded demo trail carries other "Result published" rows, so scope
       the audit assertion to this batch's publication. */
    const audit = await auditService.listEvents();
    expect(audit.filter((event) => event.action === "Result published" && event.target === DRAFT_REF)).toHaveLength(1);
  });
});

describe("withdraw publication", () => {
  it("withdraws a published batch: status, version bump, history entry, and a publication tombstone", async () => {
    const result = await academicsService.withdrawPublication(PUBLISHED_REF, "Exam papers under review", ACTOR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("withdrawn");
    expect(result.value.version).toBe(2);
    expect(result.value.note).toBe("Withdrawn — Exam papers under review");

    /* Version history gains the withdrawal entry, newest first. */
    const versions = await academicsService.listVersions(PUBLISHED_REF);
    expect(versions[0]?.version).toBe(2);
    expect(versions[0]?.note).toBe("Exam papers under review");
    expect(versions[0]?.atIso).toBe(PINNED);
    expect(versions[0]?.by).toBe(ACTOR);

    /* The live publication is tombstoned but never deleted. */
    const detail = await academicsService.getPublication("PUB-2026-001");
    expect(detail).not.toBeNull();
    expect(detail?.withdrawnAtIso).toBe(PINNED);
    expect(detail?.withdrawalReason).toBe("Exam papers under review");
    expect(detail?.term).toBe("Term 1");

    /* The live lists drop the withdrawn publication while the detail still returns it. */
    const live = await academicsService.getPublications();
    expect(live.map((publication) => publication.ref)).toEqual(["PUB-2026-002"]);
    const terms = await academicsService.getTerms();
    const term1 = terms.find((term) => term.id === "term-1");
    expect(term1?.publicationStatus).toBe("not-published");
    expect(term1?.publishedAtIso).toBeUndefined();
  });

  it("fails a second withdrawal for the same version and creates no second event or audit row", async () => {
    const first = await academicsService.withdrawPublication(PUBLISHED_REF, "Reason one", ACTOR);
    expect(first.ok).toBe(true);

    const second = await academicsService.withdrawPublication(PUBLISHED_REF, "Reason two", ACTOR);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors[0]?.message).toMatch(/already withdrawn/);

    /* The versioned event id pins the withdrawal to the withdrawn version. */
    const events = listOutboxEvents().filter((event) => event.kind === "results.withdrawn");
    expect(events).toHaveLength(1);
    expect(events[0]?.eventId).toBe(`results.withdrawn:${PUBLISHED_REF}:v2`);
    expect(events[0]?.targetRef).toBe(PUBLISHED_REF);
    expect(events[0]?.actor).toBe(ACTOR);
    const audit = await auditService.listEvents();
    expect(audit.filter((event) => event.action === "Result withdrawn" && event.target === PUBLISHED_REF)).toHaveLength(1);
    expect(
      audit.filter((event) => event.action === "Result withdrawn" && event.target === PUBLISHED_REF)[0]?.reason,
    ).toBe("Reason one");
  });

  it("requires a reason and only accepts published batches", async () => {
    const blank = await academicsService.withdrawPublication(PUBLISHED_REF, "   ", ACTOR);
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.errors[0]?.message).toMatch(/reason/);

    const draft = await academicsService.withdrawPublication(DRAFT_REF, "Early withdrawal", ACTOR);
    expect(draft.ok).toBe(false);
    if (!draft.ok) expect(draft.errors[0]?.message).toMatch(/Only published batches can be withdrawn/);
    expect(listOutboxEvents()).toHaveLength(0);
  });

  it("allows a withdrawn publication to be corrected into a new draft version", async () => {
    const withdrawn = await academicsService.withdrawPublication(PUBLISHED_REF, "Pending review", ACTOR);
    expect(withdrawn.ok).toBe(true);

    const corrected = await academicsService.startCorrection(PUBLISHED_REF, "Re-issue after review", ACTOR);
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.value.status).toBe("draft");
    expect(corrected.value.version).toBe(3);
    expect(corrected.value.note).toBe("Correction v3 — Re-issue after review");
  });
});

describe("teacher scope (class + subject)", () => {
  it("covers a batch only when both the class and the subject match an active assignment", () => {
    const assignments: AssignmentScope[] = [
      { gradeSection: { gradeLabel: "Class 8", sectionLabel: "A" }, subjectName: "Mathematics" },
    ];
    expect(assignmentsCoverBatch(assignments, "8-A", "Mathematics")).toBe(true);
    expect(assignmentsCoverBatch(assignments, "Class 8-A", "Mathematics")).toBe(true);
    /* Matching class, non-matching subject → out of scope. */
    expect(assignmentsCoverBatch(assignments, "8-A", "General Science")).toBe(false);
    /* Matching subject, non-matching class → out of scope. */
    expect(assignmentsCoverBatch(assignments, "9-A", "Mathematics")).toBe(false);
    expect(assignmentsCoverBatch([], "8-A", "Mathematics")).toBe(false);
  });

  it("resolves no active assignment sections for a result_entry_officer (non-login teacher records)", async () => {
    /* Teaching assignments now have roleGrantId: null (non-login teacher
       records), so no staff workspace resolves active assignment sections. */
    await expect(staffContextService.getActiveAssignmentSections(RESULT_ENTRY_ACCOUNT_ID)).resolves.toEqual([]);
    const assignments = await staffContextService.getActiveAssignments(RESULT_ENTRY_ACCOUNT_ID);
    const scope: AssignmentScope[] = assignments.map((assignment) => ({
      gradeSection: null,
      subjectName: assignment.subjectName,
    }));
    expect(assignmentsCoverBatch(scope, "8-A", "Mathematics")).toBe(false);
    expect(assignmentsCoverBatch(scope, "8-A", "General Science")).toBe(false);
    expect(assignmentsCoverBatch(scope, "6-A", "Mathematics")).toBe(false);
  });
});

describe("published student snapshot resolution", () => {
  it("resolves the student public reference to its published snapshot (portal passes refs)", async () => {
    /* The portal passes the student's public reference (STU-2026-0901);
       the demo fixture is keyed by the internal id. Both must resolve. */
    const byRef = await academicsService.getStudentResultSnapshot("STU-2026-0901", "00000000-0000-4000-8000-000000000602");
    expect(byRef).not.toBeNull();
    expect(Object.keys(byRef?.terms ?? {}).sort()).toEqual(["Term 1", "Term 2"]);

    const byId = await academicsService.getStudentResultSnapshot("00000000-0000-4000-8000-000000000901", "00000000-0000-4000-8000-000000000602");
    expect(byId?.terms["Term 2"]?.length).toBeGreaterThan(0);

    /* The two resolutions describe the same student. */
    expect(byRef?.studentId).toBe("STU-2026-0901");
    expect(byId?.studentId).toBe("00000000-0000-4000-8000-000000000901");
    expect(byRef?.terms["Term 1"]?.[0]?.subject).toBe(byId?.terms["Term 1"]?.[0]?.subject);
  });

  it("returns null for unknown students and wrong academic years", async () => {
    const unknown = await academicsService.getStudentResultSnapshot("STU-2026-9999", "00000000-0000-4000-8000-000000000602");
    expect(unknown).toBeNull();

    const wrongYear = await academicsService.getStudentResultSnapshot("STU-2026-0901", "00000000-0000-4000-8000-000000000601");
    expect(wrongYear).toBeNull();
  });
});
