import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { academicsService } from "@/modules/services/academics";
import {
  clearTimetableSession,
  getDateSheetState,
  getEffectiveTimetable,
  getTimetablePortalProjection,
  getTimetableStatusOverview,
  listTimetableOverrides,
  listTimetableOverridesAsync,
  revokeTimetableOverride,
  saveTimetableOverride,
} from "@/modules/services/timetable";

const BATCH_ID = "00000000-0000-4000-8000-00000000a101";
const BATCH_REF = "RB-2026-0101";
const SECTION_ID = "00000000-0000-4000-8000-00000000b101";
const COMPONENT_ID = "00000000-0000-4000-8000-00000000c101";
const ROSTER_ID = "00000000-0000-4000-8000-00000000d101";

const batch = {
  id: BATCH_ID,
  reference: BATCH_REF,
  status: "draft",
  version: 1,
  exam_definitions: { term: "Mid-term", assessment_components: [{ id: COMPONENT_ID, name: "Mathematics", max_marks: 100 }] },
  result_rosters: [{ id: ROSTER_ID, mark_entries: [{ component_id: COMPONENT_ID, obtained: null, absent: false, remark: null }] }],
};

const SUBJECT_ID = "00000000-0000-4000-8000-00000000c201";
const ROOM_ID = "00000000-0000-4000-8000-00000000c202";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-00000000c203";
const OVERRIDE_ID = "00000000-0000-4000-8000-00000000c204";
const SERVER_CONFIG = {
  gradeSections: [{ id: SECTION_ID, ref: "GS-10-B", gradeLabel: "Class 10", sectionLabel: "B" }],
  subjects: [{ id: SUBJECT_ID, code: "BIO", name: "Biology" }],
  assignments: [{ id: ASSIGNMENT_ID, ref: "SA-BIO-10B", gradeSectionId: SECTION_ID, subjectId: SUBJECT_ID, teacherName: "Z. Qadri" }],
  rooms: [{ id: ROOM_ID, code: "LAB-B", label: "Biology lab" }],
  periods: [{ dayOfWeek: 2, periodNumber: 4, startsAt: "10:30:00", endsAt: "11:15:00" }],
};
const SERVER_TIMETABLE = {
  id: "00000000-0000-4000-8000-00000000c205",
  reference: "TTV-10B-2",
  grade_section_id: SECTION_ID,
  status: "published",
  version: 2,
  revision: 1,
  effective_from: "2026-09-14",
  effective_to: null,
  created_at: "2026-09-10T08:00:00Z",
  timetable_periods: [{
    day_of_week: 2,
    period_number: 4,
    starts_at: "10:30:00",
    ends_at: "11:15:00",
    subject_id: SUBJECT_ID,
    teacher_assignment_id: ASSIGNMENT_ID,
    room_id: ROOM_ID,
    kind: "class",
    subjects: { name: "Biology" },
    staff_assignments: { staff_members: { people: { display_name: "Z. Qadri" } } },
    rooms: { label: "Biology lab" },
  }],
  timetable_publications: [{ reference: "TTP-10B-2", published_at: "2026-09-10T08:00:00Z", note: "Server Class 10-B timetable" }],
};
const SERVER_OVERRIDE = {
  id: OVERRIDE_ID,
  reference: "TTO-10B-1",
  grade_section_id: SECTION_ID,
  override_date: "2026-09-15",
  day_of_week: 2,
  period_number: 4,
  kind: "substitute",
  subject_id: SUBJECT_ID,
  room_id: null,
  substitute_teacher_assignment_id: ASSIGNMENT_ID,
  note: "Z. Qadri covers the Biology practical period.",
  created_at: "2026-09-12T06:00:00Z",
  version: 1,
  revoked_at: null,
  revocation_reason: null,
  subjects: { name: "Biology" },
  staff_assignments: { reference: "SA-BIO-10B", staff_members: { people: { display_name: "Z. Qadri" } } },
  rooms: null,
};
const CANONICAL_OVERRIDE_ID = "00000000-0000-4000-8000-00000000c209";
/* 000113 shape: the canonical teaching-assignment id is carried in
   substitute_teaching_assignment_id, the legacy column is null, and the RLS
   embeds are hidden; the name arrives through the definer projection. */
const CANONICAL_OVERRIDE = {
  ...SERVER_OVERRIDE,
  id: CANONICAL_OVERRIDE_ID,
  reference: "TTO-10B-2",
  substitute_teacher_assignment_id: null,
  substitute_teaching_assignment_id: ASSIGNMENT_ID,
  staff_assignments: null,
  teaching_assignments: { reference: "TAS-BIO-10B", staff_members: null },
  substitute_teacher_name: "Z. Qadri",
};
const SERVER_DATE_SHEET = {
  id: "00000000-0000-4000-8000-00000000c206",
  reference: "ESV-10B-3",
  grade_section_id: SECTION_ID,
  version: 3,
  status: "published",
  created_at: "2026-09-11T05:00:00Z",
  published_at: "2026-09-12T05:30:00Z",
  publication_note: "Term examination schedule",
  exam_schedule_entries: [{
    id: "00000000-0000-4000-8000-00000000c207",
    exam_date: "2026-10-06",
    subject_id: SUBJECT_ID,
    room_id: ROOM_ID,
    starts_at: "09:45:00",
    ends_at: "11:15:00",
    subjects: { name: "Biology" },
    rooms: { label: "Biology lab" },
  }],
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
  clearTimetableSession("10-B");
});

afterEach(() => {
  clearTimetableSession("10-B");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("results and timetable Supabase facades", () => {
  it("loads one timetable summary for all configured classes without period details", async () => {
    const calls: Array<{ op: string; payload: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}"));
      calls.push(request);
      if (request.op === "config.read") return json({ ok: true, value: { gradeSections: [
        ...SERVER_CONFIG.gradeSections,
        { id: "empty", gradeLabel: "Class 9", sectionLabel: "A" },
        { id: "planned", gradeLabel: "Class 6", sectionLabel: "A", status: "planned" },
      ] } });
      if (request.op === "timetable.listVersions") return json({ ok: true, value: [
        { grade_section_id: SECTION_ID, status: "draft", version: 3 },
        { grade_section_id: SECTION_ID, status: "published", version: 2 },
        { grade_section_id: "planned", status: "draft", version: 1 },
      ] });
      throw new Error("Unexpected operation");
    }));
    await expect(getTimetableStatusOverview()).resolves.toEqual([
      { label: "10-B", statuses: ["draft", "published"] },
      { label: "9-A", statuses: [] },
    ]);
    expect(calls).toEqual([
      { op: "config.read", payload: {} },
      { op: "timetable.listVersions", payload: { summaryOnly: true } },
    ]);
  });

  it.each(["config.read", "timetable.listVersions"])("does not report zero timetables when %s fails", async (failedOp) => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = JSON.parse(String(init?.body ?? "{}"));
      if (op === failedOp) return json({ ok: false, errors: [{ code: "unavailable", message: "read unavailable", field: null }] }, 503);
      return json({ ok: true, value: op === "config.read" ? SERVER_CONFIG : [] });
    }));
    await expect(getTimetableStatusOverview()).rejects.toThrow("read unavailable");
  });

  it("maps batches and sends draft/submit commands without falling back to fixtures", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      calls.push(request.op);
      if (request.op === "results.listBatches") return json({ ok: true, value: [batch] });
      if (request.op === "results.getBatch") return json({ ok: true, value: batch });
      if (request.op === "results.saveDraft" || request.op === "results.submitMarks") return json({ ok: true, value: { batchId: BATCH_ID, version: 2, status: "draft" } });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    await expect(academicsService.listBatches()).resolves.toMatchObject([{ ref: BATCH_REF, status: "draft", rows: [{ subject: "Mathematics" }] }]);
    const saved = await academicsService.saveEntryDraft(BATCH_REF, [{ subject: "Mathematics", max: 100, obtained: 72 }]);
    expect(saved.ok).toBe(true);
    expect(calls).toContain("results.saveDraft");
  });

  it("fails closed when the timetable section is not present in server configuration", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: { gradeSections: [] } });
      return json({ ok: false, errors: [{ code: "forbidden", message: "wrong section", field: null }] }, 403);
    }));
    await expect(getEffectiveTimetable("8-A")).resolves.toBeNull();
  });

  it("does not use a demo timetable when a protected adapter operation is denied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, errors: [{ code: "forbidden", message: "revoked grant", field: null }] }, 403)));
    await expect(getEffectiveTimetable("8-A")).resolves.toBeNull();
  });

  it("maps and submits the complete roster × component result matrix", async () => {
    /* The queue projection (000109) carries counts only; the full matrix is
       read through the detail operation. */
    const queueRow = {
      id: BATCH_ID,
      reference: BATCH_REF,
      status: "draft",
      state: "draft",
      version: 2,
      examTerm: "Mid-term",
      gradeLabel: "Class 8",
      sectionLabel: "A",
      subjectName: "Mathematics",
      rosterCount: 2,
      componentCount: 2,
      enteredCount: 0,
      incompleteCount: 4,
    };
    const sheet = {
      id: BATCH_ID,
      reference: BATCH_REF,
      state: "draft",
      version: 2,
      examTerm: "Mid-term",
      gradeLabel: "Class 8",
      sectionLabel: "A",
      subjectName: "Mathematics",
      components: [
        { id: COMPONENT_ID, reference: "REC-1", name: "Written", maxMarks: 80, order: 0 },
        { id: "00000000-0000-4000-8000-00000000c102", reference: "REC-2", name: "Oral", maxMarks: 20, order: 1 },
      ],
      roster: [
        { id: ROSTER_ID, reference: "RER-1", studentId: "00000000-0000-4000-8000-00000000e101", enrollmentId: "00000000-0000-4000-8000-00000000f101", studentName: "Aarif Wani", order: 0, marks: [] },
        { id: "00000000-0000-4000-8000-00000000d102", reference: "RER-2", studentId: "00000000-0000-4000-8000-00000000e102", enrollmentId: "00000000-0000-4000-8000-00000000f102", studentName: "Mariam Wani", order: 1, marks: [] },
      ],
    };
    let submitted: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload?: { marks?: unknown[] } };
      if (request.op === "results.listBatches") return json({ ok: true, value: [queueRow] });
      if (request.op === "results.getBatch") return json({ ok: true, value: sheet });
      if (request.op === "results.saveDraft") {
        submitted = request.payload?.marks ?? [];
        return json({ ok: true, value: { sheetId: BATCH_ID, version: 3, state: "draft" } });
      }
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));
    const [queued] = await academicsService.listBatches();
    expect(queued?.enteredCount).toBe(0);
    expect(queued?.totalCount).toBe(4);
    expect(queued?.rows).toHaveLength(0);
    expect(queued?.entrySheet).toBeUndefined();
    const mapped = await academicsService.getBatch(BATCH_REF);
    expect(mapped?.entrySheet?.roster).toHaveLength(2);
    expect(mapped?.entrySheet?.components).toHaveLength(2);
    expect(mapped?.rows).toHaveLength(4);
    const saved = await academicsService.saveEntryDraft(BATCH_REF, mapped?.rows.map((row) => ({ ...row, obtained: 10 })) ?? []);
    expect(saved.ok).toBe(true);
    expect(submitted).toHaveLength(4);
  });

  it("uses a public section reference for dynamic timetable reads", async () => {
    const calls: Array<{ op: string; payload: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload: Record<string, unknown> };
      calls.push(request);
      if (request.op === "config.read") return json({ ok: true, value: { gradeSections: [{ id: SECTION_ID, ref: "GS-10-B", gradeLabel: "Class 10", sectionLabel: "B" }] } });
      if (request.op === "timetable.effective") return json({ ok: true, value: null });
      return json({ ok: false, errors: [{ code: "forbidden", message: "not available", field: null }] }, 403);
    }));
    await expect(getEffectiveTimetable("10-B")).resolves.toBeNull();
    expect(calls.find((call) => call.op === "timetable.effective")?.payload).toMatchObject({ gradeSectionRef: "GS-10-B" });
  });

  it("maps the server override to its exact class, calendar date, and configured period", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      calls.push(request.op);
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      if (request.op === "timetable.listOverrides") return json({ ok: true, value: [SERVER_OVERRIDE] });
      if (request.op === "timetable.effective") return json({ ok: true, value: SERVER_TIMETABLE });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const overrides = await listTimetableOverridesAsync("10-B");
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      ref: "TTO-10B-1",
      className: "10-B",
      dateIso: "2026-09-15",
      day: "Tuesday",
      time: "10:30",
      periodNumber: 4,
      teacher: "Z. Qadri",
      subject: "Biology",
      version: 1,
      revokedAtIso: null,
    });
    expect(listTimetableOverrides("10-B")).toEqual(overrides);
    expect(calls).toContain("timetable.listOverrides");
  });

  it("resolves the canonical substitute teacher through the definer projection when the staff embeds are hidden", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      if (request.op === "timetable.listOverrides") return json({ ok: true, value: [CANONICAL_OVERRIDE] });
      if (request.op === "timetable.effective") return json({ ok: true, value: SERVER_TIMETABLE });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const overrides = await listTimetableOverridesAsync("10-B");
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ ref: "TTO-10B-2", kind: "substitute", teacher: "Z. Qadri" });
  });

  it("falls back to the configured teaching assignment when the canonical row carries no resolved name", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      if (request.op === "timetable.listOverrides") {
        const { substitute_teacher_name: _ignored, ...withoutName } = CANONICAL_OVERRIDE;
        return json({ ok: true, value: [withoutName] });
      }
      if (request.op === "timetable.effective") return json({ ok: true, value: SERVER_TIMETABLE });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const overrides = await listTimetableOverridesAsync("10-B");
    expect(overrides[0]).toMatchObject({ ref: "TTO-10B-2", kind: "substitute", teacher: "Z. Qadri" });
  });

  it("never exposes cached demo overrides when the protected Supabase read is denied", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      return json({ ok: false, errors: [{ code: "forbidden", message: "revoked guardian link", field: null }] }, 403);
    }));

    /* A denied read rejects so the page shows an error with retry; the cache
       stays empty and a presenter bridge can never fall back to demo rows. */
    await expect(listTimetableOverridesAsync("10-B")).rejects.toThrow(/revoked guardian link/);
    expect(listTimetableOverrides("10-B")).toEqual([]);
  });

  it("sends a reason and expected version to revoke while retaining the authoritative history row", async () => {
    const requests: Array<{ op: string; payload: Record<string, unknown> }> = [];
    const reason = "The assigned teacher has returned to the scheduled class.";
    const revokedAt = "2026-09-14T07:15:00Z";
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload: Record<string, unknown> };
      requests.push(request);
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      if (request.op === "timetable.revokeOverride") {
        return json({ ok: true, value: { ...SERVER_OVERRIDE, version: 2, revoked_at: revokedAt, revocation_reason: reason } });
      }
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const revoked = await revokeTimetableOverride("TTO-10B-1", reason, 1, "10-B");
    expect(requests.find((request) => request.op === "timetable.revokeOverride")?.payload).toMatchObject({
      overrideRef: "TTO-10B-1",
      expectedVersion: 1,
      reason,
    });
    expect(revoked).toMatchObject({
      ref: "TTO-10B-1",
      className: "10-B",
      version: 2,
      revokedAtIso: revokedAt,
      revocationReason: reason,
    });
  });

  it("maps the latest published date sheet and never substitutes the demo fixture", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      if (request.op === "timetable.listDateSheets") return json({ ok: true, value: [SERVER_DATE_SHEET] });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const state = await getDateSheetState("10-B");
    expect(state).toMatchObject({
      ref: "ESV-10B-3",
      className: "10-B",
      published: true,
      version: 3,
      publishedAtIso: "2026-09-12T05:30:00Z",
    });
    expect(state?.entries).toEqual([{
      dateIso: "2026-10-06",
      dayLabel: "Tue",
      dateLabel: "06 Oct",
      subject: "Biology",
      time: "09:45 – 11:15",
      room: "Biology lab",
    }]);
    expect(state?.entries.some((entry) => entry.subject === "Urdu")).toBe(false);
  });

  it("projects exact-date overrides and the published date sheet through one portal read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      if (request.op === "timetable.effective") return json({ ok: true, value: SERVER_TIMETABLE });
      if (request.op === "timetable.listOverrides") {
        return json({ ok: true, value: [{ ...SERVER_OVERRIDE, kind: "cancellation", subject_id: null, substitute_teacher_assignment_id: null }] });
      }
      if (request.op === "timetable.listDateSheets") return json({ ok: true, value: [SERVER_DATE_SHEET] });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const projection = await getTimetablePortalProjection("10-B");
    expect(projection.weekDays).toEqual(["Tuesday"]);
    expect(projection.timetable?.Tuesday?.[0]).toMatchObject({
      periodNumber: 4,
      time: "10:30",
      subject: "Cancelled",
      teacher: "—",
      change: true,
    });
    expect(projection.dateSheet[0]).toMatchObject({ subject: "Biology", dateIso: "2026-10-06" });
  });

  it("resolves a substitute override to the configured subject and teaching assignment", async () => {
    const requests: Array<{ op: string; payload: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload: Record<string, unknown> };
      requests.push(request);
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      if (request.op === "timetable.effective") return json({ ok: true, value: SERVER_TIMETABLE });
      if (request.op === "timetable.saveOverride") return json({ ok: true, value: { reference: "TTO-10B-2" } });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const saved = await saveTimetableOverride({
      dateIso: "2026-09-15",
      time: "10:30",
      kind: "substitute",
      teacher: "Z. Qadri",
      subject: "Biology",
      note: "Z. Qadri covers the Biology practical period.",
    }, "10-B");

    expect(saved.ref).toBe("TTO-10B-2");
    expect(requests.find((request) => request.op === "timetable.saveOverride")?.payload).toMatchObject({
      gradeSectionRef: "GS-10-B",
      overrideDate: "2026-09-15",
      dayOfWeek: 2,
      periodNumber: 4,
      kind: "substitute",
      subjectId: SUBJECT_ID,
      substituteTeacherAssignmentId: ASSIGNMENT_ID,
      note: "Z. Qadri covers the Biology practical period.",
    });
  });

  it("refuses a mistyped substitute subject instead of silently recording the effective subject", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      if (request.op === "timetable.effective") return json({ ok: true, value: SERVER_TIMETABLE });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    await expect(saveTimetableOverride({
      dateIso: "2026-09-15",
      time: "10:30",
      kind: "substitute",
      teacher: "Z. Qadri",
      subject: "Biologgy",
      note: "Z. Qadri covers the Biology practical period.",
    }, "10-B")).rejects.toThrow(/authorised subject/);
  });

  it("requires a period before recording any override", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    await expect(saveTimetableOverride({
      dateIso: "2026-09-15",
      time: "",
      kind: "cancellation",
      note: "The period is cancelled for the assembly rehearsal.",
    }, "10-B")).rejects.toThrow(/Choose the period/);
  });
});
