/**
 * Deterministic tests for the single timetable facade (I2 item 4):
 * portal reads and staff edit/publish go through one service over one
 * session store, published version metadata and periods come from that
 * same store (the academics results session is never consulted), unknown
 * classes get the honest not-published state instead of the 8-A fixture,
 * publishing requires a note, and the version history is append-only.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { timetableByDay } from "@/modules/academics/demo";
import { setDemoNow } from "@/modules/demo/clock";
import { sessionGet, sessionKey, sessionRemove } from "@/modules/services/session";
import {
  classKeyForGradeSection,
  clearTimetableDraft,
  clearTimetableSession,
  detectConflicts,
  deriveEditedKeys,
  effectiveTimetable,
  fixtureVersion,
  getTimetableDraft,
  getTimetableVersion,
  getTimetableVersionList,
  isKnownTimetableClass,
  listKnownClasses,
  publishTimetable,
  saveTimetableDraft,
  TIMETABLE_CLASS,
  TIMETABLE_KNOWN_CLASSES,
  timetableService,
  type DraftNote,
} from "@/modules/services/timetable";

const PINNED_NOW = new Date("2026-08-04T06:30:00Z");
/* The academics results session must stay untouched: the timetable facade
 * no longer consults the academics service for metadata or counters. */
const ACADEMICS_SESSION_KEY = sessionKey("academics");

beforeEach(() => {
  setDemoNow(PINNED_NOW);
  clearTimetableSession();
  sessionRemove(ACADEMICS_SESSION_KEY);
});

afterEach(() => {
  setDemoNow(null);
  clearTimetableSession();
  sessionRemove(ACADEMICS_SESSION_KEY);
});

const SUBSTITUTE_EDIT = {
  day: "Monday",
  time: "14:15",
  subject: "Computer Science",
  teacher: "N. Lone",
  room: "Computer lab",
} as const;

describe("one facade for portal and staff", () => {
  it("exposes one service whose reads and writes are the shared implementations", () => {
    expect(timetableService.getTimetableVersion).toBe(getTimetableVersion);
    expect(timetableService.getTimetableVersionList).toBe(getTimetableVersionList);
    expect(timetableService.effectiveTimetable).toBe(effectiveTimetable);
    expect(timetableService.publishTimetable).toBe(publishTimetable);
    expect(timetableService.listKnownClasses).toBe(listKnownClasses);
  });

  it("a staff publish is exactly what the portal read returns, from one store", async () => {
    const published = await timetableService.publishTimetable([SUBSTITUTE_EDIT], "Substitute: N. Lone covers Mon 14:15");

    const portalVersion = await timetableService.getTimetableVersion(TIMETABLE_CLASS);
    expect(portalVersion).not.toBeNull();
    expect(portalVersion?.version).toBe(published.version);
    expect(portalVersion?.note).toBe(published.note);
    expect(portalVersion?.publishedAtIso).toBe(published.publishedAtIso);
    expect(portalVersion?.weekOf).toBe("2026-08-03");
    expect(portalVersion?.periods.Monday?.find((period) => period.time === "14:15")?.teacher).toBe("N. Lone");
    expect(portalVersion?.periods.Monday?.find((period) => period.time === "14:15")?.change).toBe(true);

    /* The portal's effective view is the same published snapshot. */
    expect(timetableService.effectiveTimetable(TIMETABLE_CLASS)?.Monday?.find((period) => period.time === "14:15")?.teacher).toBe(
      "N. Lone",
    );

    /* The academics results session was never seeded by the timetable facade. */
    expect(sessionGet(ACADEMICS_SESSION_KEY)).toBeNull();
  });
});

describe("fresh session and unknown classes", () => {
  it("shows the fixture timetable and version 1 for a fresh 8-A session", async () => {
    expect(await getTimetableVersion(TIMETABLE_CLASS)).toBeNull();
    expect(effectiveTimetable(TIMETABLE_CLASS)).toBe(timetableByDay);
    expect(await getTimetableVersionList(TIMETABLE_CLASS)).toEqual([fixtureVersion]);
  });

  it("returns the honest not-published state for a class without timetable data", async () => {
    expect(effectiveTimetable("9-C")).toBeNull();
    expect(await getTimetableVersion("9-C")).toBeNull();
    expect(await getTimetableVersionList("9-C")).toEqual([]);
    /* The 8-A fixture never leaks to another class. */
    expect(effectiveTimetable("9-C")?.Monday).toBeUndefined();
  });

  it("rejects publishing for a class without timetable data", async () => {
    await expect(timetableService.publishTimetable([], "Some note", "9-C")).rejects.toThrow(/No timetable exists/);
  });

  it("derives the facade class key from a grade section", () => {
    expect(classKeyForGradeSection({ gradeLabel: "Class 8", sectionLabel: "A" })).toBe("8-A");
    expect(classKeyForGradeSection({ gradeLabel: "Class 9", sectionLabel: "C" })).toBe("9-C");
  });
});

describe("publish rules", () => {
  it("requires a change note to publish", async () => {
    await expect(timetableService.publishTimetable([], "   ")).rejects.toThrow(/note for the published timetable is required/);
    /* Nothing was written. */
    expect(await getTimetableVersion(TIMETABLE_CLASS)).toBeNull();
    expect(await getTimetableVersionList(TIMETABLE_CLASS)).toEqual([fixtureVersion]);
  });

  it("keeps the version history append-only across publishes", async () => {
    await timetableService.publishTimetable([], "Correction v2 — room moved to Lab 2");
    const second = await timetableService.publishTimetable([], "Correction v3 — teacher changed");

    expect(second.version).toBe(3);
    const list = await timetableService.getTimetableVersionList(TIMETABLE_CLASS);
    expect(list.map((entry) => entry.version)).toEqual([3, 2, 1]);
    expect(list[0]).toMatchObject({ version: 3, session: true, note: "Correction v3 — teacher changed" });
    expect(list[1]).toMatchObject({ version: 2, session: true, note: "Correction v2 — room moved to Lab 2" });
    expect(list[2]).toMatchObject({ version: 1, session: false, note: fixtureVersion.note });

    /* The latest published version is still the full snapshot for the portal. */
    const latest = await getTimetableVersion(TIMETABLE_CLASS);
    expect(latest?.version).toBe(3);
    expect(latest?.periods.Monday?.find((period) => period.time === "14:15")?.teacher).toBe("A. Gani");
  });
});

describe("known classes and per-class keying", () => {
  beforeEach(() => {
    /* 9-C is a known-but-empty class: keep its session keys clean too. */
    clearTimetableSession("9-C");
  });

  it("lists both known classes and keeps data-availability semantics", () => {
    expect(listKnownClasses()).toEqual(["8-A", "9-C"]);
    expect(listKnownClasses()).toEqual([...TIMETABLE_KNOWN_CLASSES]);
    /* Callers get a fresh copy, never the exported array itself. */
    expect(listKnownClasses()).not.toBe(TIMETABLE_KNOWN_CLASSES);
    const copy = listKnownClasses();
    copy.push("10-A");
    expect(listKnownClasses()).toEqual(["8-A", "9-C"]);
    expect(isKnownTimetableClass("8-A")).toBe(true);
    expect(isKnownTimetableClass("9-C")).toBe(false);
  });

  it("gives known-but-empty Class 9-C the honest empty state with no fixture v1", async () => {
    expect(effectiveTimetable("9-C")).toBeNull();
    expect(await getTimetableVersion("9-C")).toBeNull();
    const list = await getTimetableVersionList("9-C");
    expect(list).toEqual([]);
    expect(list.some((entry) => entry.version === fixtureVersion.version)).toBe(false);
  });

  it("keeps an 8-A publish under the 8-A key so 9-C stays empty", async () => {
    await publishTimetable([SUBSTITUTE_EDIT], "Substitute: N. Lone covers Mon 14:15");

    /* Nothing leaks into the 9-C key. */
    expect(await getTimetableVersion("9-C")).toBeNull();
    expect(await getTimetableVersionList("9-C")).toEqual([]);
    expect(effectiveTimetable("9-C")).toBeNull();

    /* The publish is fully visible under its own 8-A key. */
    const eightAList = await getTimetableVersionList(TIMETABLE_CLASS);
    expect(eightAList[0]).toMatchObject({ version: 2, session: true, note: "Substitute: N. Lone covers Mon 14:15" });
    expect(eightAList[1]).toMatchObject({ version: 1, session: false });
  });
});

describe("draft persistence", () => {
  const DRAFT_NOTES: ReadonlyArray<DraftNote> = [
    { conflictMessage: "Teacher M. Wani double-booked Mon 14:15", reason: "Substitute assigned", atIso: "2026-08-04T06:30:00Z" },
  ];

  it("saveTimetableDraft + getTimetableDraft saves and retrieves a draft", () => {
    expect(getTimetableDraft(TIMETABLE_CLASS)).toBeNull();

    const saved = saveTimetableDraft(timetableByDay, DRAFT_NOTES, TIMETABLE_CLASS);

    expect(saved.savedAtIso).toBe("2026-08-04T06:30:00.000Z");
    expect(saved.periods).toBe(timetableByDay);
    expect(saved.notes).toEqual([...DRAFT_NOTES]);

    const retrieved = getTimetableDraft(TIMETABLE_CLASS);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.savedAtIso).toBe(saved.savedAtIso);
    expect(retrieved?.periods).toEqual(timetableByDay);
    expect(retrieved?.notes).toEqual([...DRAFT_NOTES]);
  });

  it("clearTimetableDraft clears a draft so getTimetableDraft returns null", () => {
    saveTimetableDraft(timetableByDay, DRAFT_NOTES, TIMETABLE_CLASS);
    expect(getTimetableDraft(TIMETABLE_CLASS)).not.toBeNull();

    clearTimetableDraft(TIMETABLE_CLASS);

    expect(getTimetableDraft(TIMETABLE_CLASS)).toBeNull();
  });
});

describe("edited-key derivation", () => {
  it("deriveEditedKeys returns an empty set when working equals baseline", () => {
    const keys = deriveEditedKeys(timetableByDay, timetableByDay);
    expect(keys.size).toBe(0);
  });

  it("deriveEditedKeys returns keys for changed cells", () => {
    const working: typeof timetableByDay = {
      ...timetableByDay,
      Monday: (timetableByDay.Monday ?? []).map((period) =>
        period.time === "14:15"
          ? { ...period, teacher: "N. Lone", room: "Computer lab", change: true }
          : period,
      ),
    };

    const keys = deriveEditedKeys(working, timetableByDay);

    expect(keys.size).toBe(1);
    expect(keys.has("Monday|14:15")).toBe(true);
  });
});

describe("conflict detection", () => {
  it("detectConflicts returns an empty array when there are no conflicts", () => {
    /* A single editable period whose teacher and room do not match any
     * peer-class row at the same slot. */
    const conflictFree = {
      Monday: [{ time: "08:45", subject: "Mathematics", teacher: "Z. Unique", room: "Room 99" }],
    };

    expect(detectConflicts(conflictFree, TIMETABLE_CLASS)).toEqual([]);
  });

  it("detectConflicts detects a teacher conflict (same teacher, same time, different rooms)", () => {
    /* 9-B teaches M. Wani at Mon 14:15 in Room 11 · 9-B. Giving 8-A the
     * same teacher at Mon 14:15 in a different room is a pure teacher
     * double-booking — the rooms differ so no room conflict is reported. */
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
    expect(conflicts.some((conflict) => conflict.kind === "room")).toBe(false);
  });
});

describe("date-specific overrides", () => {
  it("demoDateForWeekday maps the demo week Monday 3 Aug – Saturday 8 Aug", () => {
    expect(timetableService.demoDateForWeekday("Monday")).toBe("2026-08-03");
    expect(timetableService.demoDateForWeekday("Saturday")).toBe("2026-08-08");
    expect(timetableService.demoDateForWeekday("Sunday")).toBeNull();
  });

  it("saveTimetableOverride records a deterministic reference and applies on its date only", async () => {
    const override = await timetableService.saveTimetableOverride({
      dateIso: "2026-08-04",
      time: "14:15",
      kind: "substitute",
      teacher: "N. Lone",
      subject: "Computer Science",
      note: "N. Lone covers Computer Science while M. Wani attends training.",
    });

    expect(override.ref).toBe("OVR-2026-001");
    expect(override.day).toBe("Tuesday");
    expect(override.revokedAtIso).toBeNull();

    /* Tuesday 4 Aug is the override date — the substitute shows there. */
    const tuesday = timetableService.effectivePeriodsForDate("2026-08-04");
    const period = tuesday.find((candidate) => candidate.time === "14:15");
    expect(period?.teacher).toBe("N. Lone");
    expect(period?.change).toBe(true);

    /* Every other date keeps the published base untouched. */
    const monday = timetableService.effectivePeriodsForDate("2026-08-03");
    const mondayPeriod = monday.find((candidate) => candidate.time === "14:15");
    expect(mondayPeriod?.teacher).not.toBe("N. Lone");
    expect(mondayPeriod?.change).toBeUndefined();
  });

  it("listTimetableOverrides returns active overrides first and copies", async () => {
    await timetableService.saveTimetableOverride({
      dateIso: "2026-08-03",
      time: "13:30",
      kind: "room",
      room: "Lab 1",
      note: "Computer Science moves to Lab 1 while the Computer lab is serviced.",
    });
    const first = await timetableService.saveTimetableOverride({
      dateIso: "2026-08-04",
      time: "14:15",
      kind: "substitute",
      teacher: "N. Lone",
      subject: "Computer Science",
      note: "N. Lone covers Computer Science while M. Wani attends training.",
    });
    await timetableService.revokeTimetableOverride(first.ref);

    const list = timetableService.listTimetableOverrides();
    expect(list).toHaveLength(2);
    expect(list[0]?.revokedAtIso).toBeNull();
    expect(list[1]?.revokedAtIso).not.toBeNull();
  });

  it("rejects a missing or short reason, an out-of-week date, an unknown period, and missing kind fields", async () => {
    await expect(timetableService.saveTimetableOverride({
      dateIso: "2026-08-04",
      time: "14:15",
      kind: "cancellation",
      note: "Short.",
    })).rejects.toThrow(/at least 10 characters/);

    await expect(timetableService.saveTimetableOverride({
      dateIso: "2026-09-01",
      time: "14:15",
      kind: "cancellation",
      note: "A reasoned cancellation outside the demo week.",
    })).rejects.toThrow(/demo week/);

    await expect(timetableService.saveTimetableOverride({
      dateIso: "2026-08-04",
      time: "23:59",
      kind: "cancellation",
      note: "A reasoned cancellation for a period that does not exist.",
    })).rejects.toThrow(/No period starts at/);

    await expect(timetableService.saveTimetableOverride({
      dateIso: "2026-08-04",
      time: "14:15",
      kind: "substitute",
      note: "A substitute override without naming a covering teacher.",
    })).rejects.toThrow(/substitute teacher/);

    await expect(timetableService.saveTimetableOverride({
      dateIso: "2026-08-04",
      time: "14:15",
      kind: "room",
      note: "A room override without naming the replacement room.",
    })).rejects.toThrow(/room is required/);
  });

  it("applies cancellation and room overrides without mutating the base", async () => {
    await timetableService.saveTimetableOverride({
      dateIso: "2026-08-05",
      time: "10:15",
      kind: "cancellation",
      note: "Urdu period cancelled for a school-wide assembly on Wednesday.",
    });
    await timetableService.saveTimetableOverride({
      dateIso: "2026-08-06",
      time: "13:30",
      kind: "room",
      room: "Lab 1",
      note: "Computer Science moves to Lab 1 while the Computer lab is serviced.",
    });

    const wednesday = timetableService.effectivePeriodsForDate("2026-08-05");
    const cancelled = wednesday.find((candidate) => candidate.time === "10:15");
    expect(cancelled?.subject).toBe("Cancelled");
    expect(cancelled?.teacher).toBe("—");

    const thursday = timetableService.effectivePeriodsForDate("2026-08-06");
    const moved = thursday.find((candidate) => candidate.time === "13:30");
    expect(moved?.room).toBe("Lab 1");
    expect(moved?.subject).toBe("Computer Science");

    /* The base fixture is never rewritten. */
    const base = timetableByDay.Thursday?.find((candidate) => candidate.time === "13:30");
    expect(base?.room).not.toBe("Lab 1");
  });

  it("revokeTimetableOverride restores the base and rejects unknown or double revokes", async () => {
    const override = await timetableService.saveTimetableOverride({
      dateIso: "2026-08-04",
      time: "14:15",
      kind: "substitute",
      teacher: "N. Lone",
      subject: "Computer Science",
      note: "N. Lone covers Computer Science while M. Wani attends training.",
    });

    await expect(timetableService.revokeTimetableOverride("OVR-2026-999")).rejects.toThrow(/No override/);

    const revoked = await timetableService.revokeTimetableOverride(override.ref);
    expect(revoked.revokedAtIso).not.toBeNull();

    await expect(timetableService.revokeTimetableOverride(override.ref)).rejects.toThrow(/already revoked/);

    const tuesday = timetableService.effectivePeriodsForDate("2026-08-04");
    const period = tuesday.find((candidate) => candidate.time === "14:15");
    expect(period?.teacher).not.toBe("N. Lone");
    expect(period?.change).toBeUndefined();
  });
});

describe("exam date-sheet publish state", () => {
  it("publishDateSheet records a versioned, session-persisted state", async () => {
    const state = await timetableService.publishDateSheet();

    expect(state.published).toBe(true);
    expect(state.version).toBe(1);
    expect(state.publishedAtIso).toBe(PINNED_NOW.toISOString());

    const reloaded = await timetableService.getDateSheetState();
    expect(reloaded?.version).toBe(1);

    const second = await timetableService.publishDateSheet();
    expect(second.version).toBe(2);
  });

  it("getDateSheetState returns null before any publish", async () => {
    expect(await timetableService.getDateSheetState()).toBeNull();
  });
});
