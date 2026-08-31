import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { academicsService } from "@/modules/services/academics";
import {
  clearTimetableSession,
  getDateSheetState,
  getEffectiveTimetable,
  getTimetablePortalProjection,
  listTimetableOverrides,
  listTimetableOverridesAsync,
  revokeTimetableOverride,
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
      if (request.op === "results.listBatches") return json({ ok: true, value: [sheet] });
      if (request.op === "results.getBatch") return json({ ok: true, value: sheet });
      if (request.op === "results.saveDraft") {
        submitted = request.payload?.marks ?? [];
        return json({ ok: true, value: { sheetId: BATCH_ID, version: 3, state: "draft" } });
      }
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));
    const [mapped] = await academicsService.listBatches();
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

  it("never exposes cached demo overrides when the protected Supabase read is denied", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: SERVER_CONFIG });
      return json({ ok: false, errors: [{ code: "forbidden", message: "revoked guardian link", field: null }] }, 403);
    }));

    await expect(listTimetableOverridesAsync("10-B")).resolves.toEqual([]);
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
});
