/**
 * S4 domain-logic hardening — demo + adapter-facade guarantees for the
 * results, snapshot, timetable, and teaching-staff services.
 *
 * Every test below locks a blueprint rule in the demo adapter (the Supabase
 * adapter delegates the same rules to the server):
 * - published results are immutable; corrections version with reason/audit
 * - entry → submit → moderate → publish with role separation, no self-publish
 * - guardian snapshots expose only published snapshots (negatives → null)
 * - timetable conflicts derive from teaching assignments (no logins) and a
 *   fresh hard clash blocks publish with a named conflict
 * - overrides preserve the base timetable with a supersession chain
 * - no path creates teacher accounts or grants
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { timetableByDay } from "@/modules/academics/demo";
import { academicsService, type MarksRow } from "@/modules/services/academics";
import { AUDIT_SESSION_KEY_EXPORT } from "@/modules/services/audit";
import { loadRelationshipStore } from "@/modules/services/family-context";
import { clearOutboxSession } from "@/modules/services/outbox";
import { sessionKey, sessionRemove } from "@/modules/services/session";
import { teachingStaffService } from "@/modules/services/teaching-staff";
import {
  clearTimetableSession,
  detectConflicts,
  detectEditConflict,
  effectiveTimetable,
  TIMETABLE_CLASS,
  TimetableConflictError,
  publishTimetable,
  getTimetableVersionList,
  getTimetableVersion,
} from "@/modules/services/timetable";

const PINNED = "2026-08-10T05:00:00.000Z";
const ACADEMICS_KEY = sessionKey("academics");
const REL_KEY = sessionKey("relationships");

const DRAFT_REF = "RB-2026-0141";
const PUBLISHED_REF = "RB-2026-0138";

const AARIF_REF = "STU-2026-0901";
const ZOYA_ID = "00000000-0000-4000-8000-000000000903";
const UNKNOWN_STUDENT = "STU-2026-9999";
const CURRENT_YEAR = "00000000-0000-4000-8000-000000000602";
const WRONG_YEAR = "00000000-0000-4000-8000-000000000601";

const ENTRY = "Entry Officer";
const MODERATOR = "Moderator Reviewer";
const PUBLISHER = "Publisher Office";

function fillRows(rows: readonly MarksRow[], marks = 70): MarksRow[] {
  return rows.map((row) => ({ ...row, obtained: Math.min(marks, row.max) }));
}

beforeEach(() => {
  sessionRemove(ACADEMICS_KEY);
  sessionRemove(REL_KEY);
  clearOutboxSession();
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
  clearTimetableSession();
  clearTimetableSession("9-C");
  setDemoNow(new Date(PINNED));
});

afterEach(() => {
  sessionRemove(ACADEMICS_KEY);
  sessionRemove(REL_KEY);
  clearOutboxSession();
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
  clearTimetableSession();
  clearTimetableSession("9-C");
  setDemoNow(null);
});

describe("role separation + versioning (academics demo)", () => {
  it("denies approve when the approver equals the submitter", async () => {
    const draft = await academicsService.getBatch(DRAFT_REF);
    const rows = fillRows(draft!.rows);
    const submitted = await academicsService.submitForModeration(DRAFT_REF, rows, ENTRY);
    expect(submitted.ok).toBe(true);

    const approved = await academicsService.approve(DRAFT_REF, ENTRY);
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.errors[0]?.message).toMatch(/different reviewer|cannot approve their own/i);

    const after = await academicsService.getBatch(DRAFT_REF);
    expect(after?.status).toBe("submitted");
  });

  it("denies publish when the publisher equals the approver (no self-publish)", async () => {
    const draft = await academicsService.getBatch(DRAFT_REF);
    const rows = fillRows(draft!.rows);
    await academicsService.submitForModeration(DRAFT_REF, rows, ENTRY);
    const approved = await academicsService.approve(DRAFT_REF, MODERATOR);
    expect(approved.ok).toBe(true);

    const selfPublish = await academicsService.publish(DRAFT_REF, MODERATOR);
    expect(selfPublish.ok).toBe(false);
    if (!selfPublish.ok) expect(selfPublish.errors[0]?.message).toMatch(/different publisher|no self-publish/i);

    const after = await academicsService.getBatch(DRAFT_REF);
    expect(after?.status).toBe("approved");
  });

  it("allows the full journey with distinct entry, moderator, and publisher actors", async () => {
    const draft = await academicsService.getBatch(DRAFT_REF);
    const rows = fillRows(draft!.rows);
    expect((await academicsService.submitForModeration(DRAFT_REF, rows, ENTRY)).ok).toBe(true);
    expect((await academicsService.approve(DRAFT_REF, MODERATOR)).ok).toBe(true);
    const published = await academicsService.publish(DRAFT_REF, PUBLISHER);
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.version).toBe(1);
    expect((await academicsService.getBatch(DRAFT_REF))?.status).toBe("published");
  });

  it("locks the state machine: publish needs approval, approve needs submission, correction needs reason", async () => {
    expect((await academicsService.publish(DRAFT_REF, PUBLISHER)).ok).toBe(false);
    expect((await academicsService.approve(DRAFT_REF, MODERATOR)).ok).toBe(false);
    expect((await academicsService.startCorrection(PUBLISHED_REF, "   ", MODERATOR)).ok).toBe(false);
    expect((await academicsService.startCorrection(DRAFT_REF, "Nope", MODERATOR)).ok).toBe(false);
  });

  it("records a versioned correction with reason, actor, and timestamp", async () => {
    const corrected = await academicsService.startCorrection(PUBLISHED_REF, "Urdu grade rechecked", MODERATOR);
    expect(corrected.ok).toBe(true);
    const versions = await academicsService.listVersions(PUBLISHED_REF);
    expect(versions[0]).toMatchObject({ version: 2, note: "Urdu grade rechecked", by: MODERATOR, atIso: PINNED });
  });
});

describe("correction-creates-version immutability", () => {
  it("leaves the prior publication bytes unchanged after a correction republishes", async () => {
    const beforePub = await academicsService.getPublication("PUB-2026-001");
    expect(beforePub).not.toBeNull();
    const beforeJson = JSON.stringify(beforePub);

    const corrected = await academicsService.startCorrection(PUBLISHED_REF, "Urdu grade rechecked", MODERATOR);
    expect(corrected.ok).toBe(true);
    const sheet = await academicsService.getBatch(PUBLISHED_REF);
    const edited = sheet!.rows.map((row) => (row.subject === "Urdu" ? { ...row, obtained: Math.min(90, row.max) } : row));
    await academicsService.saveEntryDraft(PUBLISHED_REF, edited);
    await academicsService.submitForModeration(PUBLISHED_REF, edited, ENTRY);
    await academicsService.approve(PUBLISHED_REF, MODERATOR);
    const republished = await academicsService.publish(PUBLISHED_REF, PUBLISHER);
    expect(republished.ok).toBe(true);
    if (!republished.ok) return;
    expect(republished.value.version).toBe(2);
    expect(republished.value.correctionNote).toContain("Urdu grade rechecked");

    const afterPub = await academicsService.getPublication("PUB-2026-001");
    expect(JSON.stringify(afterPub)).toBe(beforeJson);
    expect(afterPub?.version).toBe(beforePub?.version);
  });

  it("freezes prior reader bytes: editing the correction draft never rewrites the captured v1 rows", async () => {
    const before = await academicsService.getBatch(PUBLISHED_REF);
    const beforeRowsJson = JSON.stringify(before?.rows);
    expect(before?.rows.every((row) => row.obtained !== null)).toBe(true);

    await academicsService.startCorrection(PUBLISHED_REF, "Recheck mathematics", MODERATOR);
    const draft = await academicsService.getBatch(PUBLISHED_REF);
    const edited = draft!.rows.map((row) => ({ ...row, obtained: 55 }));
    await academicsService.saveEntryDraft(PUBLISHED_REF, edited);

    /* The reader-held v1 bytes are untouched; the live draft carries the edit. */
    expect(JSON.stringify(before?.rows)).toBe(beforeRowsJson);
    const live = await academicsService.getBatch(PUBLISHED_REF);
    expect(JSON.stringify(live?.rows)).not.toBe(beforeRowsJson);
    expect(live?.version).toBe(2);
  });

  it("returns defensive copies so caller mutation cannot corrupt the store", async () => {
    const probe = await academicsService.getBatch(PUBLISHED_REF);
    probe!.rows[0]!.obtained = 9999;
    const fresh = await academicsService.getBatch(PUBLISHED_REF);
    expect(fresh!.rows[0]!.obtained).not.toBe(9999);

    const versions = await academicsService.listVersions(PUBLISHED_REF);
    if (versions.length > 0) {
      versions[0]!.note = "mutated";
      const reloaded = await academicsService.listVersions(PUBLISHED_REF);
      expect(reloaded[0]?.note).not.toBe("mutated");
    }
  });
});

describe("guardian snapshot scoping negatives", () => {
  it("returns nothing for the wrong class (9-C has no published snapshot)", async () => {
    expect(await academicsService.getStudentResultSnapshot(ZOYA_ID, CURRENT_YEAR)).toBeNull();
  });

  it("returns nothing for an unlinked or unknown guardian child", async () => {
    expect(await academicsService.getStudentResultSnapshot(UNKNOWN_STUDENT, CURRENT_YEAR)).toBeNull();
  });

  it("returns nothing for an unpublished batch (wrong academic year)", async () => {
    expect(await academicsService.getStudentResultSnapshot(AARIF_REF, WRONG_YEAR)).toBeNull();
  });
});

describe("timetable conflicts from teaching assignments + publish gate", () => {
  it("detects named teacher and room clashes with counterpart class, day, and time", () => {
    const teacherClash = {
      Monday: [{ time: "14:15", subject: "Computer Science", teacher: "M. Wani", room: "Computer lab" }],
    };
    const conflicts = detectConflicts(teacherClash, TIMETABLE_CLASS);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "teacher",
      day: "Monday",
      time: "14:15",
      counterpart: { className: "9-B", day: "Monday", time: "14:15" },
    });
    expect(conflicts[0]?.message).toContain("M. Wani");

    const live = detectConflicts(timetableByDay, TIMETABLE_CLASS);
    expect(live.map((conflict) => conflict.message)).toContain("Room Computer lab conflict Thu 13:30");
  });

  it("names the other assignment for conflicting teacher and room edits", () => {
    const teacher = detectEditConflict(
      timetableByDay,
      { day: "Monday", time: "14:15", field: "teacher", value: "M. Wani" },
      TIMETABLE_CLASS,
    );
    expect(teacher?.message).toContain("M. Wani");
    expect(teacher?.message).toContain("Class 9-B");
    expect(teacher?.message).toContain("Mon 14:15");

    const room = detectEditConflict(
      timetableByDay,
      { day: "Thursday", time: "13:30", field: "room", value: "Computer lab" },
      TIMETABLE_CLASS,
    );
    expect(room?.message).toContain("Computer lab");
    expect(room?.message).toContain("Class 9-B");
  });

  it("blocks publish on a fresh hard clash with a named conflict and writes nothing", async () => {
    const before = await getTimetableVersionList(TIMETABLE_CLASS);
    await expect(
      publishTimetable(
        [{ day: "Monday", time: "14:15", subject: "Computer Science", teacher: "M. Wani", room: "Room 21 · 8-A" }],
        "Attempt a double-booked publish",
      ),
    ).rejects.toBeInstanceOf(TimetableConflictError);
    try {
      await publishTimetable(
        [{ day: "Monday", time: "14:15", subject: "Computer Science", teacher: "M. Wani", room: "Room 21 · 8-A" }],
        "Attempt a double-booked publish",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(TimetableConflictError);
      const conflicts = (error as TimetableConflictError).conflicts;
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0]?.message).toContain("M. Wani");
      expect(conflicts[0]?.counterpart?.className).toBe("9-B");
    }
    expect(await getTimetableVersionList(TIMETABLE_CLASS)).toEqual(before);
    expect(await getTimetableVersion(TIMETABLE_CLASS)).toBeNull();
  });

  it("publishes a clash-free edit and the baseline without new conflicts", async () => {
    const free = await publishTimetable(
      [{ day: "Monday", time: "14:15", subject: "Computer Science", teacher: "N. Lone", room: "Computer lab" }],
      "Substitute: N. Lone covers Mon 14:15",
    );
    expect(free.version).toBe(2);
    expect(free.periods.Monday?.find((period) => period.time === "14:15")?.teacher).toBe("N. Lone");
  });
});

describe("override preserves base + supersession chain", () => {
  it("applies an override on its date only and never rewrites the base timetable", async () => {
    const baseBefore = JSON.stringify(effectiveTimetable(TIMETABLE_CLASS));
    const { saveTimetableOverride, effectivePeriodsForDate, listTimetableOverrides } = await import(
      "@/modules/services/timetable"
    );
    const override = await saveTimetableOverride(
      {
        dateIso: "2026-08-04",
        time: "14:15",
        kind: "substitute",
        teacher: "N. Lone",
        subject: "Computer Science",
        note: "N. Lone covers Computer Science while M. Wani attends training.",
      },
      TIMETABLE_CLASS,
    );
    expect(override.version).toBe(1);
    expect(override.revokedAtIso).toBeNull();

    const tuesday = effectivePeriodsForDate("2026-08-04", TIMETABLE_CLASS);
    expect(tuesday.find((period) => period.time === "14:15")?.teacher).toBe("N. Lone");
    const monday = effectivePeriodsForDate("2026-08-03", TIMETABLE_CLASS);
    expect(monday.find((period) => period.time === "14:15")?.teacher).not.toBe("N. Lone");

    expect(JSON.stringify(effectiveTimetable(TIMETABLE_CLASS))).toBe(baseBefore);
    expect(listTimetableOverrides(TIMETABLE_CLASS)).toHaveLength(1);
  });

  it("revocation versions the override, retains history, and restores the base", async () => {
    const { saveTimetableOverride, revokeTimetableOverride, listTimetableOverrides, effectivePeriodsForDate } =
      await import("@/modules/services/timetable");
    const override = await saveTimetableOverride(
      {
        dateIso: "2026-08-04",
        time: "14:15",
        kind: "substitute",
        teacher: "N. Lone",
        subject: "Computer Science",
        note: "N. Lone covers Computer Science while M. Wani attends training.",
      },
      TIMETABLE_CLASS,
    );
    const revoked = await revokeTimetableOverride(
      override.ref,
      "The original teacher has returned to the scheduled class.",
      override.version,
      TIMETABLE_CLASS,
    );
    expect(revoked.version).toBe(2);
    expect(revoked.revokedAtIso).not.toBeNull();

    const history = listTimetableOverrides(TIMETABLE_CLASS);
    expect(history).toHaveLength(1);
    expect(history[0]?.revokedAtIso).not.toBeNull();

    const tuesday = effectivePeriodsForDate("2026-08-04", TIMETABLE_CLASS);
    expect(tuesday.find((period) => period.time === "14:15")?.teacher).not.toBe("N. Lone");

    await expect(
      revokeTimetableOverride(override.ref, "The original teacher has returned to the scheduled class.", revoked.version, TIMETABLE_CLASS),
    ).rejects.toThrow(/already revoked/);
    await expect(
      revokeTimetableOverride(override.ref, "The original teacher has returned to the scheduled class.", 999, TIMETABLE_CLASS),
    ).rejects.toThrow(/mismatch|already revoked/);
  });
});

describe("no teacher accounts or grants", () => {
  it("lists non-login teaching staff with assignment history and no account linkage", async () => {
    const probe = await teachingStaffService.createTeachingStaff({
      displayName: "Hardening List Probe",
      title: "Assistant teacher",
      reason: "Hardening probe — seed a non-login record for listing.",
    });
    const rows = await teachingStaffService.listTeachingStaff();
    expect(rows.some((row) => row.staffMemberId === probe.staffMemberId)).toBe(true);
    for (const row of rows) {
      expect(row.legacyAccountId).toBeNull();
      for (const assignment of row.assignments) {
        expect(assignment.provenance).toBe("manual");
        expect(assignment.sourceRef).toBeNull();
        expect(assignment.updatedByAccountId).toBeNull();
      }
    }
  });

  it("creates a teaching record without touching accounts or grants", async () => {
    const before = loadRelationshipStore();
    const accountsBefore = before.userAccounts.length;
    const membersBefore = before.staffMembers.length;

    const created = await teachingStaffService.createTeachingStaff({
      displayName: "Hardening Probe Teacher",
      title: "Assistant teacher",
      reason: "Hardening probe — non-login record must not create an account.",
    });
    expect(created.staffMemberId).toBeTruthy();

    const after = loadRelationshipStore();
    expect(after.userAccounts.length).toBe(accountsBefore);
    expect(after.staffMembers.length).toBe(membersBefore + 1);
    expect(after.staffMembers[after.staffMembers.length - 1]?.personId ?? null).toBeNull();

    const rows = await teachingStaffService.listTeachingStaff();
    expect(rows.some((row) => row.staffMemberId === created.staffMemberId)).toBe(true);
  });

  it("creates an assignment with roleGrantId null and validates staff + reason", async () => {
    const holder = await teachingStaffService.createTeachingStaff({
      displayName: "Hardening Assign Holder",
      title: "Assistant teacher",
      reason: "Hardening probe — holder for assignment validation.",
    });
    const { schoolConfigService } = await import("@/modules/services/school-config");
    const config = await schoolConfigService.getConfiguration();
    const academicYearId = config.academicYears.find((year) => year.status === "current")?.id ?? config.academicYears[0]?.id ?? "year";
    const gradeSectionId = config.gradeSections[0]?.id ?? "section";
    const subjectId = config.subjects[0]?.id ?? "subject";
    expect(academicYearId).toBeTruthy();
    expect(gradeSectionId).toBeTruthy();
    expect(subjectId).toBeTruthy();

    await expect(
      teachingStaffService.createAssignment({
        staffMemberId: "00000000-0000-4000-8000-000000009999",
        academicYearId,
        gradeSectionId,
        subjectId,
        reason: "Hardening probe assignment.",
      }),
    ).rejects.toThrow(/Teaching staff record not found/);

    await expect(
      teachingStaffService.createAssignment({
        staffMemberId: holder.staffMemberId,
        academicYearId,
        gradeSectionId,
        subjectId,
        reason: "   ",
      }),
    ).rejects.toThrow(/reason/i);

    const before = loadRelationshipStore();
    const accountsBefore = before.userAccounts.length;
    const created = await teachingStaffService.createAssignment({
      staffMemberId: holder.staffMemberId,
      academicYearId,
      gradeSectionId,
      subjectId,
      reason: "Hardening probe — cover Class 8-A mathematics.",
    });
    const after = loadRelationshipStore();
    expect(after.userAccounts.length).toBe(accountsBefore);
    expect(after.staffAssignments[after.staffAssignments.length - 1]?.roleGrantId).toBeNull();
    expect(created.assignmentId).toBeTruthy();
  });

  it("ends an assignment with version check and preserves history", async () => {
    const holder = await teachingStaffService.createTeachingStaff({
      displayName: "Hardening Lifecycle Holder",
      title: "Assistant teacher",
      reason: "Hardening probe — holder for end-to-end lifecycle.",
    });
    const { schoolConfigService } = await import("@/modules/services/school-config");
    const config = await schoolConfigService.getConfiguration();
    const academicYearId = config.academicYears.find((year) => year.status === "current")?.id ?? config.academicYears[0]?.id ?? "year";
    const gradeSectionId = config.gradeSections[0]?.id ?? "section";
    const subjectId = config.subjects[0]?.id ?? "subject";
    const created = await teachingStaffService.createAssignment({
      staffMemberId: holder.staffMemberId,
      academicYearId,
      gradeSectionId,
      subjectId,
      reason: "Hardening probe — end-to-end assignment lifecycle.",
    });

    await expect(
      teachingStaffService.endAssignment({ assignmentId: created.assignmentId, reason: "Probe complete.", expectedVersion: 999 }),
    ).rejects.toThrow(/version mismatch/i);

    const ended = await teachingStaffService.endAssignment({
      assignmentId: created.assignmentId,
      reason: "Probe complete — timetable cover ended.",
      expectedVersion: 1,
    });
    expect(ended.status).toBe("ended");

    const after = loadRelationshipStore();
    const stored = after.staffAssignments.find((assignment) => assignment.id === created.assignmentId);
    expect(stored?.status).toBe("ended");
    expect(stored?.effectiveToIso).not.toBeNull();

    await expect(
      teachingStaffService.endAssignment({ assignmentId: created.assignmentId, reason: "Again.", expectedVersion: 1 }),
    ).rejects.toThrow(/already ended/);
  });
});
