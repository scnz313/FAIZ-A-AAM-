/**
 * Deterministic timetable service/editor contract tests (pinned clock,
 * cleared session keys): the fixture claims stay intact, a conflicting
 * edit is blocked with the other assignment named, a free teacher clears
 * the conflict, publishing creates a version the portal data source
 * reflects, and a resolve without a change is rejected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoleGrant, StaffRole } from "@fass/contracts";
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
  getDateSheetState,
  getTimetableVersion,
  getTimetableVersionList,
  initialOpenConflicts,
  publishTimetable,
  suggestedResolve,
  timetableService,
  validateDraft,
  validateResolve,
} from "@/modules/services/timetable";
import { FamilyContextProvider } from "@/components/portal/FamilyContextProvider";
import { TimetablePageClient } from "@/components/portal/TimetablePageClient";
import { StaffContextProvider, type StaffContextInitialState } from "@/components/staff/StaffContextProvider";
import { TimetableEditor } from "@/components/staff/TimetableEditor";
import { TimetableManager } from "@/components/staff/TimetableManager";
import { DEMO_GUARDIAN_ACCOUNT_ID, familyContextService } from "@/modules/services/family-context";
import { roleLabel } from "@/modules/services/staff-context";

const PINNED_NOW = new Date("2026-08-04T06:30:00Z");

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  setDemoNow(PINNED_NOW);
  clearTimetableSession();
});

afterEach(() => {
  setDemoNow(null);
  clearTimetableSession();
  clearTimetableSession("10-B");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

describe("Supabase portal timetable projection", () => {
  it("renders the published server date sheet and omits the demo badge", async () => {
    const [context, students, summary] = await Promise.all([
      familyContextService.getContext(DEMO_GUARDIAN_ACCOUNT_ID),
      familyContextService.listAccessibleStudentContexts(DEMO_GUARDIAN_ACCOUNT_ID),
      familyContextService.getAccountSummary(DEMO_GUARDIAN_ACCOUNT_ID),
    ]);
    const first = students[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const sectionId = "00000000-0000-4000-8000-00000000b101";
    const subjectId = "00000000-0000-4000-8000-00000000c201";
    const roomId = "00000000-0000-4000-8000-00000000c202";
    const assignmentId = "00000000-0000-4000-8000-00000000c203";
    const tenB = {
      ...first,
      gradeSection: {
        ...first.gradeSection,
        id: sectionId,
        ref: "GS-10-B",
        gradeLabel: "Class 10",
        sectionLabel: "B",
      },
      enrollment: { ...first.enrollment, gradeSectionId: sectionId },
    };

    vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") {
        return jsonResponse({ ok: true, value: {
          gradeSections: [{ id: sectionId, ref: "GS-10-B", gradeLabel: "Class 10", sectionLabel: "B" }],
          subjects: [{ id: subjectId, code: "BIO", name: "Biology" }],
          assignments: [{ id: assignmentId, ref: "SA-10B-BIO", gradeSectionId: sectionId, subjectId, teacherName: "Z. Qadri" }],
          rooms: [{ id: roomId, code: "LAB-B", label: "Biology lab" }],
          periods: [{ dayOfWeek: 2, periodNumber: 4, startsAt: "10:30:00", endsAt: "11:15:00" }],
        } });
      }
      if (request.op === "timetable.effective") {
        return jsonResponse({ ok: true, value: {
          id: "00000000-0000-4000-8000-00000000c204",
          reference: "TTV-10B-2",
          grade_section_id: sectionId,
          status: "published",
          version: 2,
          effective_from: "2026-09-14",
          effective_to: null,
          created_at: "2026-09-10T08:00:00Z",
          timetable_periods: [{
            day_of_week: 2,
            period_number: 4,
            starts_at: "10:30:00",
            ends_at: "11:15:00",
            subject_id: subjectId,
            teacher_assignment_id: assignmentId,
            room_id: roomId,
            kind: "class",
            subjects: { name: "Biology" },
            staff_assignments: { staff_members: { people: { display_name: "Z. Qadri" } } },
            rooms: { label: "Biology lab" },
          }],
          timetable_publications: [{ reference: "TTP-10B-2", published_at: "2026-09-10T08:00:00Z", note: "Published Class 10-B timetable" }],
        } });
      }
      if (request.op === "timetable.listOverrides") return jsonResponse({ ok: true, value: [] });
      if (request.op === "timetable.listDateSheets") {
        return jsonResponse({ ok: true, value: [{
          id: "00000000-0000-4000-8000-00000000c205",
          reference: "ESV-10B-3",
          grade_section_id: sectionId,
          version: 3,
          status: "published",
          created_at: "2026-09-11T05:00:00Z",
          published_at: "2026-09-12T05:30:00Z",
          exam_schedule_entries: [{
            exam_date: "2026-10-06",
            subject_id: subjectId,
            room_id: roomId,
            starts_at: "09:45:00",
            ends_at: "11:15:00",
            subjects: { name: "Biology" },
            rooms: { label: "Biology lab" },
          }],
        }] });
      }
      return jsonResponse({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const user = userEvent.setup();
    render(
      <FamilyContextProvider initialState={{ context, students: [tenB], guardianName: summary.displayName }}>
        <TimetablePageClient />
      </FamilyContextProvider>,
    );

    const examTab = await screen.findByRole("tab", { name: "Exam date sheet" });
    await user.click(examTab);
    await waitFor(() => expect(screen.getByText("06 Oct")).toBeInTheDocument());
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("Biology")).toBeInTheDocument();
    expect(screen.getByText("v3 · published")).toBeInTheDocument();
    expect(document.querySelector(".demo-badge")).toBeNull();
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

describe("TimetableManager exam date authoring", () => {
  const MANAGER_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";

  function managerInitialState(): StaffContextInitialState {
    const role: StaffRole = "timetable_manager";
    const grant: RoleGrant = {
      id: "00000000-0000-4000-8000-000000000901",
      ref: "RGR-2026-0901",
      accountId: MANAGER_ACCOUNT_ID,
      role,
      status: "active",
      grantedByPersonId: null,
      reason: "Fictional timetable workspace test grant",
      scope: { academicYearIds: [], gradeSectionIds: [], subjectIds: [] },
      effectiveFromIso: "2026-04-01T00:00:00.000Z",
      effectiveToIso: null,
    };
    return {
      identityId: MANAGER_ACCOUNT_ID,
      workspaces: [grant],
      summary: {
        accountId: MANAGER_ACCOUNT_ID,
        staffMemberId: "00000000-0000-4000-8000-000000000104",
        personId: "00000000-0000-4000-8000-000000000004",
        displayName: "Danish Mir",
        title: "Timetable manager",
        profileCode: null,
        profileLabel: null,
        activeRoleGrantId: grant.id,
        role,
        roleLabel: roleLabel(role),
        roles: [role],
        academicYearLabel: "2026–27",
        assignmentLabel: null,
        grantedWorkspaceCount: 1,
      },
    };
  }

  function renderTimetableManager() {
    return render(
      <StaffContextProvider initialState={managerInitialState()}>
        <TimetableManager dateSheet={[]} />
      </StaffContextProvider>,
    );
  }

  async function fillExamDateForm(
    overrides: Partial<{ date: string; subject: string; room: string; start: string; end: string; reason: string }> = {},
  ) {
    const values = {
      date: "2026-09-16",
      subject: "Mathematics",
      room: "Lab 1",
      start: "09:00",
      end: "10:30",
      reason: "Mid-term Mathematics paper scheduled by the examination office.",
      ...overrides,
    };
    fireEvent.change(screen.getByLabelText("Exam date"), { target: { value: values.date } });
    if (values.subject !== "") {
      const subjectSelect = screen.getByLabelText("Exam subject");
      await within(subjectSelect).findByRole("option", { name: values.subject });
      fireEvent.change(subjectSelect, { target: { value: values.subject } });
    }
    if (values.room !== "") {
      const roomSelect = screen.getByLabelText("Exam room");
      await within(roomSelect).findByRole("option", { name: values.room });
      fireEvent.change(roomSelect, { target: { value: values.room } });
    }
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: values.start } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: values.end } });
    fireEvent.change(screen.getByLabelText(/Exam reason/), { target: { value: values.reason } });
  }

  it("stages an added exam date and removes it again", async () => {
    const user = userEvent.setup();
    renderTimetableManager();

    await fillExamDateForm();
    await user.click(screen.getByRole("button", { name: "Add exam date" }));

    const staged = screen.getByRole("list", { name: "Staged exam dates" });
    expect(within(staged).getByText("Mathematics")).toBeInTheDocument();
    expect(within(staged).getByText(/09:00 – 10:30/)).toBeInTheDocument();
    expect(within(staged).getByText(/Mid-term Mathematics paper scheduled/)).toBeInTheDocument();

    await user.click(within(staged).getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("list", { name: "Staged exam dates" })).not.toBeInTheDocument();
  });

  it("clears staged rows when the class changes", async () => {
    const user = userEvent.setup();
    renderTimetableManager();

    await fillExamDateForm();
    await user.click(screen.getByRole("button", { name: "Add exam date" }));
    expect(screen.getByRole("list", { name: "Staged exam dates" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Class"), { target: { value: "10-A" } });
    await waitFor(() => expect(screen.queryByRole("list", { name: "Staged exam dates" })).not.toBeInTheDocument());
  });

  it("reports missing fields, end-before-start, and duplicate staged papers inline with focus", async () => {
    const user = userEvent.setup();
    renderTimetableManager();

    await user.click(screen.getByRole("button", { name: "Add exam date" }));
    expect(screen.getByText("Choose the exam date.")).toBeInTheDocument();
    expect(screen.getByText("Choose the exam subject.")).toBeInTheDocument();
    expect(screen.getByText("Choose the exam room.")).toBeInTheDocument();
    expect(screen.getByText("Enter the start time.")).toBeInTheDocument();
    expect(screen.getByText("Enter the end time.")).toBeInTheDocument();
    expect(screen.getByText("Record a reason of at least 10 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("Exam date")).toHaveFocus();
    expect(screen.queryByRole("list", { name: "Staged exam dates" })).not.toBeInTheDocument();

    await fillExamDateForm({ start: "10:00", end: "09:30" });
    await user.click(screen.getByRole("button", { name: "Add exam date" }));
    expect(screen.getByText("The end time must be after the start time.")).toBeInTheDocument();
    expect(screen.getByLabelText("End time")).toHaveFocus();
    expect(screen.queryByRole("list", { name: "Staged exam dates" })).not.toBeInTheDocument();

    await fillExamDateForm({ start: "10:00", end: "11:30" });
    await user.click(screen.getByRole("button", { name: "Add exam date" }));
    expect(screen.getByRole("list", { name: "Staged exam dates" })).toBeInTheDocument();

    /* The same date and subject may only be staged once; a correction has to
       replace its own staged row rather than duplicate it. */
    await fillExamDateForm({ start: "12:00", end: "13:30" });
    await user.click(screen.getByRole("button", { name: "Add exam date" }));
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByLabelText("Exam subject")).toHaveFocus();
    expect(within(screen.getByRole("list", { name: "Staged exam dates" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("publishes the staged paper with the ExamSlot time range and re-enables publish for a correction", async () => {
    const user = userEvent.setup();
    const publishSpy = vi.spyOn(timetableService, "publishDateSheet");
    renderTimetableManager();

    await fillExamDateForm();
    await user.click(screen.getByRole("button", { name: "Add exam date" }));
    await user.click(screen.getByRole("button", { name: "Publish date sheet" }));

    await waitFor(() => expect(publishSpy).toHaveBeenCalledTimes(1));
    expect(publishSpy.mock.calls[0]?.[0]).toBe(TIMETABLE_CLASS);
    expect(publishSpy.mock.calls[0]?.[1]).toEqual([
      {
        dateIso: "2026-09-16",
        dayLabel: "Wed",
        dateLabel: "16 Sept",
        subject: "Mathematics",
        time: "09:00 – 10:30",
        room: "Lab 1",
      },
    ]);
    expect(publishSpy.mock.calls[0]?.[2]).toBe("Mid-term Mathematics paper scheduled by the examination office.");
    await waitFor(() => expect(screen.getByText(/Date sheet v1 published/)).toBeInTheDocument());
    expect(screen.queryByRole("list", { name: "Staged exam dates" })).not.toBeInTheDocument();
    expect(screen.getByText("16 Sept")).toBeInTheDocument();

    const published = await getDateSheetState();
    expect(published?.entries[0]?.time).toBe("09:00 – 10:30");

    /* Correction: the same date and subject with a changed time. */
    await fillExamDateForm({
      start: "09:30",
      end: "11:00",
      reason: "Correction after the assembly moved the paper to 09:30.",
    });
    await user.click(screen.getByRole("button", { name: "Add exam date" }));
    const correction = screen.getByRole("button", { name: "Publish correction" });
    expect(correction).toBeEnabled();
    expect(screen.getByText(/replaces the published 09:00 – 10:30 paper/)).toBeInTheDocument();
    await user.click(correction);

    await waitFor(() => expect(publishSpy).toHaveBeenCalledTimes(2));
    expect(publishSpy.mock.calls[1]?.[1]).toEqual([
      {
        dateIso: "2026-09-16",
        dayLabel: "Wed",
        dateLabel: "16 Sept",
        subject: "Mathematics",
        time: "09:30 – 11:00",
        room: "Lab 1",
      },
    ]);
    const corrected = await getDateSheetState();
    expect(corrected?.version).toBe(2);
    expect(corrected?.entries[0]?.time).toBe("09:30 – 11:00");
  });

  it("keeps staged rows and shows the service error when publish fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(timetableService, "publishDateSheet").mockRejectedValueOnce(
      new Error("The examination service is unavailable."),
    );
    renderTimetableManager();

    await fillExamDateForm();
    await user.click(screen.getByRole("button", { name: "Add exam date" }));
    await user.click(screen.getByRole("button", { name: "Publish date sheet" }));

    await waitFor(() =>
      expect(screen.getByText(/Date sheet not published: The examination service is unavailable\./)).toBeInTheDocument(),
    );
    expect(screen.getByText(/your staged rows are kept so you can retry/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Staged exam dates" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish date sheet" })).toBeEnabled();
  });
});
