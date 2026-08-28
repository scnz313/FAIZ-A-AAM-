import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { academicsService } from "@/modules/services/academics";
import { getEffectiveTimetable } from "@/modules/services/timetable";

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

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
});

afterEach(() => {
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
});
