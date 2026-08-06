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
  clearTimetableSession,
  effectiveTimetable,
  fixtureVersion,
  getTimetableVersion,
  getTimetableVersionList,
  isKnownTimetableClass,
  listKnownClasses,
  publishTimetable,
  TIMETABLE_CLASS,
  TIMETABLE_KNOWN_CLASSES,
  timetableService,
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
