/**
 * Focused tests for the result-batch creation path:
 * - the `results.examDefinitions` read (scoped, read-only) through the
 *   academics service in Supabase mode, with fail-closed behavior;
 * - the `results.createBatch` command payload and mapped batch;
 * - the deterministic demo branch (honest list, draft creation, idempotent
 *   reopen for the same exam/section/subject).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { academicsService } from "@/modules/services/academics";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const SESSION_KEY = sessionKey("academics");
const PINNED = "2026-08-10T05:00:00.000Z";

const EXAM_ID = "00000000-0000-4000-8000-00000000e101";
const SECTION_ID = "00000000-0000-4000-8000-00000000e102";
const SUBJECT_ID = "00000000-0000-4000-8000-00000000e103";
const SHEET_ID = "00000000-0000-4000-8000-00000000e104";
const COMPONENT_ID = "00000000-0000-4000-8000-00000000e105";
const ROSTER_ID = "00000000-0000-4000-8000-00000000e106";
const YEAR_ID = "00000000-0000-4000-8000-000000000602";

const EXAM_ROW = {
  id: EXAM_ID,
  reference: "EXM-2026-0001",
  term: "midterm",
  status: "open",
  academicYearId: YEAR_ID,
  academicYearLabel: "2026-27",
  academicYearStatus: "current",
  gradeSectionId: SECTION_ID,
  gradeLabel: "Class 8",
  sectionLabel: "A",
  subjects: [{ id: SUBJECT_ID, code: "MAT", name: "Mathematics" }],
};

const SHEET_ROW = {
  id: SHEET_ID,
  reference: "RES-2026-0001",
  state: "draft",
  version: 1,
  examTerm: "midterm",
  gradeLabel: "Class 8",
  sectionLabel: "A",
  subjectName: "Mathematics",
  examDefinitionId: EXAM_ID,
  academicYearId: YEAR_ID,
  gradeSectionId: SECTION_ID,
  subjectId: SUBJECT_ID,
  components: [{ id: COMPONENT_ID, name: "Written", maxMarks: 100, order: 0 }],
  roster: [
    {
      id: ROSTER_ID,
      studentId: "00000000-0000-4000-8000-00000000e201",
      enrollmentId: "00000000-0000-4000-8000-00000000e301",
      studentName: "Aarif Wani",
      order: 0,
      marks: [],
    },
  ],
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  sessionRemove(SESSION_KEY);
  setDemoNow(new Date(PINNED));
});

afterEach(() => {
  sessionRemove(SESSION_KEY);
  setDemoNow(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("results.examDefinitions (Supabase contract)", () => {
  it("sends the read op and maps the scoped exam, section, and subject rows", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      calls.push(request.op);
      if (request.op === "results.examDefinitions") return json({ ok: true, value: [EXAM_ROW] });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const result = await academicsService.listExamDefinitions();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toContain("results.examDefinitions");
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      id: EXAM_ID,
      ref: "EXM-2026-0001",
      term: "midterm",
      status: "open",
      academicYearId: YEAR_ID,
      gradeSectionId: SECTION_ID,
      gradeLabel: "Class 8",
      sectionLabel: "A",
    });
    expect(result.value[0]?.subjects).toEqual([{ id: SUBJECT_ID, code: "MAT", name: "Mathematics" }]);
  });

  it("fails closed when the read is denied instead of showing demo exam rows", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ ok: false, errors: [{ code: "forbidden", message: "exam scope denied", field: null }] }, 403),
    ));

    const result = await academicsService.listExamDefinitions();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toBe("exam scope denied");
  });
});

describe("results.createBatch (Supabase contract)", () => {
  it("sends the exact selection and maps the created draft batch", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    let payload: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload: Record<string, unknown> };
      if (request.op !== "results.createBatch") return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
      payload = request.payload;
      return json({ ok: true, value: SHEET_ROW });
    }));

    const result = await academicsService.createBatch({
      examDefinitionId: EXAM_ID,
      gradeSectionId: SECTION_ID,
      subjectId: SUBJECT_ID,
      idempotencyKey: "batch:test",
    });

    expect(payload).toMatchObject({
      examDefinitionId: EXAM_ID,
      gradeSectionId: SECTION_ID,
      subjectId: SUBJECT_ID,
      idempotencyKey: "batch:test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      ref: "RES-2026-0001",
      exam: "midterm",
      className: "Class 8 · A",
      subject: "Mathematics",
      status: "draft",
      version: 1,
    });
    expect(result.value.entrySheet?.id).toBe(SHEET_ID);
  });

  it("surfaces a server refusal without fabricating a batch", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      calls.push(request.op);
      if (request.op === "results.createBatch") {
        return json({ ok: false, errors: [{ code: "forbidden", message: "exact class/subject scope required", field: null }] }, 403);
      }
      if (request.op === "results.listBatches") return json({ ok: true, value: [] });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const result = await academicsService.createBatch({ examDefinitionId: EXAM_ID, gradeSectionId: SECTION_ID, subjectId: SUBJECT_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toBe("exact class/subject scope required");
    expect(calls).toEqual(["results.createBatch"]);
  });
});

describe("demo batch creation", () => {
  it("lists configured exam definitions with subjects and no unconfigured term", async () => {
    const result = await academicsService.listExamDefinitions();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.every((definition) => definition.subjects.length > 0)).toBe(true);
    /* Term 3 has no marks fixture, so it is never offered by the demo. */
    expect(result.value.some((definition) => definition.term === "Term 3")).toBe(false);
    expect(result.value.every((definition) => definition.academicYearLabel === "2026–27")).toBe(true);
  });

  it("creates a draft batch and reopens the same selection instead of duplicating", async () => {
    const definitions = await academicsService.listExamDefinitions();
    expect(definitions.ok).toBe(true);
    if (!definitions.ok) return;
    const definition = definitions.value[0];
    const subject = definition?.subjects[0];
    expect(definition).toBeDefined();
    expect(subject).toBeDefined();
    if (!definition || !subject) return;

    const created = await academicsService.createBatch({
      examDefinitionId: definition.id,
      gradeSectionId: definition.gradeSectionId,
      subjectId: subject.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe("draft");
    expect(created.value.subject).toBe(subject.name);
    expect(created.value.rows).toEqual([{ subject: subject.name, max: expect.any(Number), obtained: null }]);
    expect(created.value.rows[0]?.max).toBeGreaterThan(0);

    const listed = await academicsService.listBatches();
    expect(listed.some((batch) => batch.ref === created.value.ref)).toBe(true);

    const repeated = await academicsService.createBatch({
      examDefinitionId: definition.id,
      gradeSectionId: definition.gradeSectionId,
      subjectId: subject.id,
    });
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    expect(repeated.value.ref).toBe(created.value.ref);
    expect((await academicsService.listBatches()).filter((batch) => batch.ref === created.value.ref)).toHaveLength(1);
  });

  it("rejects an unknown selection", async () => {
    const result = await academicsService.createBatch({
      examDefinitionId: "demo-exam:unknown:00000000-0000-4000-8000-00000000e999",
      gradeSectionId: "00000000-0000-4000-8000-00000000e999",
      subjectId: "demo-subject:unknown",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toMatch(/not available/i);
  });
});
