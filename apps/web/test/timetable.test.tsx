/**
 * Deterministic timetable service/editor contract tests (pinned clock,
 * cleared session keys): the fixture claims stay intact, a conflicting
 * edit is blocked with the other assignment named, a free teacher clears
 * the conflict, publishing creates a version the portal data source
 * reflects, and a resolve without a change is rejected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setDemoNow } from "@/modules/demo/clock";
import { timetableByDay, weekDays } from "@/modules/academics/demo";
import { sessionRemove } from "@/modules/services/session";
import {
  TIMETABLE_CLASS,
  clearTimetableSession,
  demoConflictClaims,
  detectConflicts,
  detectEditConflict,
  deriveEditedKeys,
  effectiveTimetable,
  fixtureVersion,
  getTimetableVersion,
  getTimetableVersionList,
  initialOpenConflicts,
  publishTimetable,
  suggestedResolve,
  validateDraft,
  validateResolve,
} from "@/modules/services/timetable";
import { TimetableEditor } from "@/components/staff/TimetableEditor";

const PINNED_NOW = new Date("2026-08-04T06:30:00Z");

beforeEach(() => {
  setDemoNow(PINNED_NOW);
  clearTimetableSession();
});

afterEach(() => {
  setDemoNow(null);
  clearTimetableSession();
});

describe("fixture conflicts", () => {
  it("keeps the documented demo conflict claims verbatim", () => {
    const messages = demoConflictClaims.map((claim) => claim.message);
    expect(messages).toContain("Teacher M. Wani double-booked Mon 14:15 (8-A vs 9-B)");
    expect(messages).toContain("Room Computer lab conflict Thu 13:30");
  });

  it("detects the Computer lab room clash live from the fixtures", () => {
    const detected = detectConflicts(timetableByDay, TIMETABLE_CLASS);
    expect(detected.map((conflict) => conflict.message)).toContain("Room Computer lab conflict Thu 13:30");
    expect(detected[0]).toMatchObject({ kind: "room", day: "Thursday", time: "13:30" });
  });

  it("seeds the open list with the live room conflict plus the M. Wani claim", () => {
    const open = initialOpenConflicts();
    expect(open.some((conflict) => conflict.message === "Room Computer lab conflict Thu 13:30")).toBe(true);
    expect(open.some((conflict) => conflict.message === "Teacher M. Wani double-booked Mon 14:15 (8-A vs 9-B)")).toBe(
      true,
    );
  });
});

describe("conflicting edits", () => {
  it("(a) returns a conflict error naming the other assignment for a double-booked teacher", () => {
    const conflict = detectEditConflict(
      timetableByDay,
      { day: "Monday", time: "14:15", field: "teacher", value: "M. Wani" },
      TIMETABLE_CLASS,
    );
    expect(conflict).not.toBeNull();
    expect(conflict?.message).toContain("M. Wani");
    expect(conflict?.message).toContain("Class 9-B");
    expect(conflict?.message).toContain("Mon 14:15");
    expect(conflict?.message).toContain("choose another teacher or period");
  });

  it("(b) clears the conflict when the teacher changes to a free one", () => {
    expect(
      detectEditConflict(
        timetableByDay,
        { day: "Monday", time: "14:15", field: "teacher", value: "N. Lone" },
        TIMETABLE_CLASS,
      ),
    ).toBeNull();
  });

  it("allows a teacher at a different time on the same day", () => {
    /* K. Dar teaches Tuesday 10:15 — a different time is not a clash. */
    expect(
      detectEditConflict(
        timetableByDay,
        { day: "Tuesday", time: "09:30", field: "teacher", value: "K. Dar" },
        TIMETABLE_CLASS,
      ),
    ).toBeNull();
  });

  it("blocks a same-class clash at the same day+time when a slot is duplicated", () => {
    const duplicateSlot = {
      ...timetableByDay,
      Tuesday: [
        ...(timetableByDay.Tuesday ?? []),
        { time: "09:30", subject: "Extra period", teacher: "R. Mir", room: "Room 21 · 8-A" },
      ],
    };
    const conflict = detectEditConflict(
      duplicateSlot,
      { day: "Tuesday", time: "09:30", field: "teacher", value: "R. Mir" },
      TIMETABLE_CLASS,
    );
    expect(conflict?.message).toContain("R. Mir");
    expect(conflict?.message).toContain("Class 8-A");
    expect(conflict?.message).toContain("Tue 09:30");
  });

  it("blocks a room clash and names the other class", () => {
    const conflict = detectEditConflict(
      timetableByDay,
      { day: "Thursday", time: "13:30", field: "room", value: "Computer lab" },
      TIMETABLE_CLASS,
    );
    expect(conflict?.message).toContain("Computer lab");
    expect(conflict?.message).toContain("Class 9-B");
  });

  it("rejects empty required cells via validateDraft", () => {
    const withEmptyTeacher = {
      ...timetableByDay,
      Monday: timetableByDay.Monday?.map((period) =>
        period.time === "14:15" ? { ...period, teacher: "" } : period,
      ) ?? [],
    };
    expect(deriveEditedKeys(withEmptyTeacher, timetableByDay)).toEqual(new Set(["Monday|14:15"]));
    expect(validateDraft(withEmptyTeacher, new Set(["Monday|14:15"]))).toEqual([
      { key: "Monday|14:15", day: "Monday", time: "14:15", field: "teacher" },
    ]);
  });
});

describe("publish and versions", () => {
  it("(c) publish creates the next version and the portal data source reflects the edited period", async () => {
    const edit = {
      day: "Monday",
      time: "14:15",
      subject: "Computer Science",
      teacher: "N. Lone",
      room: "Computer lab",
    };
    const version = await publishTimetable([edit], "Substitute: N. Lone covers Mon 14:15");

    expect(version.version).toBe(fixtureVersion.version + 1);
    expect(version.note).toBe("Substitute: N. Lone covers Mon 14:15");
    expect(version.weekOf).toBe("2026-08-03");

    const published = await getTimetableVersion();
    expect(published).not.toBeNull();
    expect(published?.version).toBe(2);
    expect(published?.periods.Monday?.find((period) => period.time === "14:15")?.teacher).toBe("N. Lone");
    expect(published?.periods.Monday?.find((period) => period.time === "14:15")?.change).toBe(true);

    /* The portal data source (effectiveTimetable) reflects the edited period. */
    expect(effectiveTimetable()?.Monday?.find((period) => period.time === "14:15")?.teacher).toBe("N. Lone");

    const list = await getTimetableVersionList();
    expect(list[0]).toMatchObject({ version: 2, session: true, note: "Substitute: N. Lone covers Mon 14:15" });
    expect(list[1]).toMatchObject({ version: 1, session: false });
  });

  it("publishes corrections as further append-only versions", async () => {
    await publishTimetable(
      [{ day: "Monday", time: "14:15", subject: "Computer Science", teacher: "N. Lone", room: "Computer lab" }],
      "Substitute: N. Lone covers Mon 14:15",
    );
    const correction = await publishTimetable([], "Correction v3 — room moved to Lab 2");

    expect(correction.version).toBe(3);
    const list = await getTimetableVersionList();
    expect(list.map((entry) => entry.version)).toEqual([3, 2, 1]);
    expect(list[0]).toMatchObject({ version: 3, session: true, note: "Correction v3 — room moved to Lab 2" });
    expect(list[1]).toMatchObject({ version: 2, session: true });
  });

  it("returns the fixture view when no session version exists", async () => {
    expect(await getTimetableVersion()).toBeNull();
    const monday = effectiveTimetable()?.Monday;
    const mondayFixture = timetableByDay.Monday;
    expect(monday).toBeDefined();
    expect(monday).toBe(mondayFixture);
    const list = await getTimetableVersionList();
    expect(list).toEqual([fixtureVersion]);
  });
});

describe("resolve rules", () => {
  it("(d) rejects a resolve without a change and requires a reason", () => {
    const claim = demoConflictClaims[0];
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const unchanged = validateResolve(claim, timetableByDay, timetableByDay, "It was a mistake", TIMETABLE_CLASS);
    expect(unchanged.ok).toBe(false);
    if (!unchanged.ok) expect(unchanged.error).toContain("No change was made");

    const changed = {
      ...timetableByDay,
      Monday: timetableByDay.Monday?.map((period) =>
        period.time === "14:15" ? { ...period, teacher: "N. Lone" } : period,
      ) ?? [],
    };
    const noReason = validateResolve(claim, changed, timetableByDay, "   ", TIMETABLE_CLASS);
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error).toContain("reason is required");
  });

  it("accepts a reasoned resolve once the assignment changed and the clash is gone", () => {
    const claim = demoConflictClaims[0];
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const changed = {
      ...timetableByDay,
      Monday: timetableByDay.Monday?.map((period) =>
        period.time === "14:15" ? { ...period, teacher: "N. Lone" } : period,
      ) ?? [],
    };
    const result = validateResolve(
      claim,
      changed,
      timetableByDay,
      "Substitute: N. Lone covers Mon 14:15 — M. Wani moved to 9-B",
      TIMETABLE_CLASS,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a resolve while the clash is still present", () => {
    const roomClaim = initialOpenConflicts().find((conflict) => conflict.kind === "room");
    expect(roomClaim).toBeDefined();
    if (roomClaim === undefined) return;
    /* The assignment changed (teacher) but the Computer lab clash remains. */
    const changedButClashing = {
      ...timetableByDay,
      Thursday: timetableByDay.Thursday?.map((period) =>
        period.time === "13:30" ? { ...period, teacher: "S. Naseer" } : period,
      ) ?? [],
    };
    const result = validateResolve(
      roomClaim,
      changedButClashing,
      timetableByDay,
      "Changed the teacher",
      TIMETABLE_CLASS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("still present");
  });

  it("suggests the documented substitute for the M. Wani claim", () => {
    const claim = demoConflictClaims[0];
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const suggestion = suggestedResolve(claim, timetableByDay, TIMETABLE_CLASS);
    expect(suggestion).toMatchObject({ field: "teacher", value: "N. Lone" });
    expect(suggestion?.reason).toContain("N. Lone covers Mon 14:15");
  });
});

describe("TimetableEditor", () => {
  it("blocks a conflicting teacher edit inline and never applies it", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <TimetableEditor
        timetable={timetableByDay}
        baseline={timetableByDay}
        weekDays={weekDays}
        editedKeys={new Set()}
        preview={false}
        onEdit={onEdit}
      />,
    );

    const teacherSelect = screen.getByLabelText("Monday 14:15 teacher");
    await user.selectOptions(teacherSelect, "M. Wani");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "M. Wani already teaches Class 9-B at Mon 14:15",
    );
    expect(onEdit).not.toHaveBeenCalled();
    expect(teacherSelect).toHaveValue("A. Gani");
  });

  it("counts edited periods as the draft changes", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <TimetableEditor
        timetable={timetableByDay}
        baseline={timetableByDay}
        weekDays={weekDays}
        editedKeys={new Set(["Monday|14:15"])}
        preview={false}
        onEdit={onEdit}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("1 period edited this draft");
    const subjectSelect = screen.getByLabelText("Monday 09:30 subject");
    await user.selectOptions(subjectSelect, "Urdu");
    expect(onEdit).toHaveBeenCalledWith("Monday", "09:30", "subject", "Urdu");
  });
});
