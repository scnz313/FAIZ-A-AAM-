/**
 * Live-mode contract tests for the results depth paths that were broken on
 * staging: a moderator's return reason reaching the entry workspace, a
 * correction request targeting the release item that carries the batch, the
 * sheet-native publication withdrawal lookup, and correction approval.
 *
 * The browser gateway is exercised through a stubbed `fetch` exactly like the
 * page code, so every assertion is about the operation and payload the real
 * session would send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { academicsService, mapServerResultBatch, mapServerResultVersion } from "@/modules/services/academics";

const SHEET_ID = "00000000-0000-4000-8000-000000000a01";
const SHEET_REF = "RES-2026-ABC123";
const RELEASE_ID = "00000000-0000-4000-8000-000000000b01";
const RELEASE_REF = "RPR-2026-ABC123";
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000c01";
const PUBLICATION_REF = "PUB-2026-ABC123";
const SUBJECT_ID = "00000000-0000-4000-8000-000000000d01";
const COMPONENT_ID = "00000000-0000-4000-8000-000000000e01";
const ROSTER_ID = "00000000-0000-4000-8000-000000000f01";

const sheetRow = {
  id: SHEET_ID,
  reference: SHEET_REF,
  status: "published",
  state: "published",
  version: 3,
  examTerm: "midterm",
  subjectName: "English",
  gradeLabel: "Class 8",
  sectionLabel: "A",
  components: [{ id: COMPONENT_ID, reference: "REC-1", name: "Midterm", maxMarks: 100, order: 0 }],
  roster: [{
    id: ROSTER_ID,
    reference: "RER-1",
    studentId: "00000000-0000-4000-8000-000000001001",
    enrollmentId: "00000000-0000-4000-8000-000000001101",
    studentName: "Test Student One",
    order: 0,
    marks: [{ id: "00000000-0000-4000-8000-000000001201", componentId: COMPONENT_ID, obtained: 45, markStatus: "present", remark: null }],
  }],
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function opOf(init?: RequestInit): { op: string; payload: Record<string, unknown> } {
  return JSON.parse(String(init?.body ?? "{}")) as { op: string; payload: Record<string, unknown> };
}

beforeEach(() => {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("moderator return reason reaches the entry sheet", () => {
  it("maps the latest returned version note", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = opOf(init);
      if (op === "results.listBatches") return json({ ok: true, value: [{ ...sheetRow, state: "returned" }] });
      if (op === "results.getBatch") {
        return json({
          ok: true,
          value: {
            ...sheetRow,
            state: "returned",
            versions: [
              { version: 3, state: "returned", note: "Total does not match the answer sheet", createdAt: "2026-09-10T09:00:00Z" },
              { version: 2, state: "draft", note: "Draft saved", createdAt: "2026-09-10T08:00:00Z" },
            ],
            corrections: [],
          },
        });
      }
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));

    const batch = await academicsService.getBatch(SHEET_REF);
    expect(batch?.returnedReason).toBe("Total does not match the answer sheet");
    expect(batch?.note).toContain("Returned for correction");
  });

  it("maps a pending correction reason onto a published batch", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = opOf(init);
      if (op === "results.listBatches") return json({ ok: true, value: [sheetRow] });
      if (op === "results.getBatch") {
        return json({
          ok: true,
          value: {
            ...sheetRow,
            versions: [{ version: 3, state: "published", note: "Subject publication released", createdAt: "2026-09-11T12:37:03Z" }],
            corrections: [{ id: "00000000-0000-4000-8000-000000009001", reason: "Recheck question 4", version: 1, status: "requested" }],
          },
        });
      }
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));

    const batch = await academicsService.getBatch(SHEET_REF);
    expect(batch?.pendingCorrectionReason).toBe("Recheck question 4");
    expect(batch?.note).toContain("Correction pending reviewer approval");
  });

  it("rejects a failed batch read instead of reporting 'not found'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, errors: [{ code: "unavailable", message: "database unavailable", field: null }] }, 503)));
    await expect(academicsService.getBatch(SHEET_REF)).rejects.toThrow("database unavailable");
  });

  it("never fabricates a version timestamp or actor identity", () => {
    const version = mapServerResultVersion({ version: 2, state: "returned", note: "Fix the total", createdAt: "2026-09-10T09:00:00Z" });
    expect(version).toEqual({ version: 2, state: "returned", note: "Fix the total", atIso: "2026-09-10T09:00:00Z" });
    const undated = mapServerResultVersion({ version: 1, state: "draft", note: null });
    expect(undated.atIso).toBe("");
    expect(undated.by).toBeUndefined();
  });

  it("maps the server row id/actor-free batch projection without inventing values", () => {
    const mapped = mapServerResultBatch({ ...sheetRow, status: "returned", state: "returned" });
    expect(mapped.status).toBe("returned");
    expect(mapped.rows).toHaveLength(1);
    expect(mapped.entrySheet?.id).toBe(SHEET_ID);
  });

  it("renders a readable row label when a person record has a blank display name", () => {
    const mapped = mapServerResultBatch({
      ...sheetRow,
      roster: [{ ...sheetRow.roster[0]!, studentName: "   " }],
    });
    expect(mapped.rows[0]?.subject).toBe("Student · Midterm");
  });

  it("annotates a published queue row with its pending correction reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = opOf(init);
      if (op === "results.listBatches") return json({ ok: true, value: [sheetRow] });
      if (op === "results.listCorrections") {
        return json({ ok: true, value: [{ sheet_reference: SHEET_REF, reason: "Recheck question 4" }] });
      }
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));

    const batches = await academicsService.listBatches();
    expect(batches[0]?.pendingCorrectionReason).toBe("Recheck question 4");
    expect(batches[0]?.note).toContain("Correction pending reviewer approval");
  });
});

describe("queue read-model scale (000109)", () => {
  const queueRow = {
    id: SHEET_ID,
    reference: SHEET_REF,
    status: "draft",
    state: "draft",
    version: 3,
    examDefinitionId: "00000000-0000-4000-8000-000000007001",
    academicYearId: "00000000-0000-4000-8000-000000007002",
    gradeSectionId: "00000000-0000-4000-8000-000000007003",
    subjectId: SUBJECT_ID,
    examTerm: "midterm",
    subjectName: "English",
    gradeLabel: "Class 8",
    sectionLabel: "A",
    updatedAt: "2026-09-15T04:00:00Z",
    rosterCount: 2,
    componentCount: 3,
    enteredCount: 4,
    incompleteCount: 2,
  };

  it("maps queue counts without inventing a roster matrix", () => {
    const mapped = mapServerResultBatch(queueRow);
    expect(mapped.rows).toEqual([]);
    expect(mapped.entrySheet).toBeUndefined();
    expect(mapped.enteredCount).toBe(4);
    expect(mapped.totalCount).toBe(6);
    expect(mapped.totalsIncomplete).toBe(true);
    expect(mapped.status).toBe("draft");
    expect(mapped.exam).toBe("midterm");
    expect(mapped.className).toBe("Class 8 · A");
    expect(mapped.subject).toBe("English");
  });

  it("treats a complete queue sheet as non-incomplete", () => {
    const mapped = mapServerResultBatch({ ...queueRow, enteredCount: 6, incompleteCount: 0 });
    expect(mapped.totalsIncomplete).toBe(false);
    expect(mapped.enteredCount).toBe(6);
    expect(mapped.totalCount).toBe(6);
  });

  it("keeps the full matrix on the detail read", () => {
    const mapped = mapServerResultBatch(sheetRow);
    expect(mapped.rows).toHaveLength(1);
    expect(mapped.entrySheet?.roster).toHaveLength(1);
    expect(mapped.entrySheet?.roster[0]?.marks[0]?.obtained).toBe(45);
    expect(mapped.entrySheet?.components).toHaveLength(1);
  });

  it("serves the queue from the counts projection without a detail read", async () => {
    const operations: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = opOf(init);
      operations.push(op);
      if (op === "results.listBatches") return json({ ok: true, value: [queueRow] });
      if (op === "results.listCorrections") return json({ ok: true, value: [] });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));

    const batches = await academicsService.listBatches();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ ref: SHEET_REF, enteredCount: 4, totalCount: 6, rows: [] });
    expect(batches[0]?.entrySheet).toBeUndefined();
    expect(operations).toEqual(["results.listBatches", "results.listCorrections"]);
  });
});

describe("correction request targets the release item carrying the sheet", () => {
  it("resolves the published release by entrySheetId and sends releaseId + publicationId", async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op, payload } = opOf(init);
      if (op === "results.listBatches") return json({ ok: true, value: [sheetRow] });
      if (op === "results.listReleases") {
        return json({
          ok: true,
          value: [{
            id: RELEASE_ID,
            reference: RELEASE_REF,
            status: "published",
            publishedAt: "2026-09-11T12:37:50Z",
            items: [{ publicationId: PUBLICATION_ID, entrySheetId: SHEET_ID, subjectId: SUBJECT_ID }],
          }],
        });
      }
      if (op === "results.requestCorrection") {
        requests.push(payload);
        return json({ ok: true, value: { requestId: "00000000-0000-4000-8000-000000009001" } });
      }
      if (op === "results.getBatch") return json({ ok: true, value: sheetRow });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));

    const result = await academicsService.startCorrection(SHEET_REF, "Total does not match the answer sheet");
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ releaseId: RELEASE_ID, publicationId: PUBLICATION_ID, reason: "Total does not match the answer sheet" });
  });

  it("fails with a recoverable message when no published release carries the sheet", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = opOf(init);
      if (op === "results.listBatches") return json({ ok: true, value: [sheetRow] });
      if (op === "results.listReleases") return json({ ok: true, value: [] });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));
    const result = await academicsService.startCorrection(SHEET_REF, "Reason text");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain("no published report release");
  });
});

describe("sheet-native publication withdrawal", () => {
  it("matches the publication by source_entry_sheet_id when batch_id is null", async () => {
    let withdrawn: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op, payload } = opOf(init);
      if (op === "results.listPublications") {
        return json({
          ok: true,
          value: [{ id: PUBLICATION_ID, reference: PUBLICATION_REF, batch_id: null, source_entry_sheet_id: SHEET_ID, version: 1, status: "final" }],
        });
      }
      if (op === "results.withdraw") {
        withdrawn = payload;
        return json({ ok: true, value: null });
      }
      if (op === "results.listBatches") return json({ ok: true, value: [sheetRow] });
      if (op === "results.getBatch") return json({ ok: true, value: sheetRow });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));

    const result = await academicsService.withdrawPublication(SHEET_REF, "Published before the recheck was complete");
    expect(result.ok).toBe(true);
    expect(withdrawn).toMatchObject({ publicationId: PUBLICATION_ID, reason: "Published before the recheck was complete" });
  });

  it("fails when the batch has no live publication", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = opOf(init);
      if (op === "results.listPublications") return json({ ok: true, value: [] });
      if (op === "results.listBatches") return json({ ok: true, value: [sheetRow] });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));
    const result = await academicsService.withdrawPublication(SHEET_REF, "Reason text");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain("No live publication");
  });
});

describe("correction approval and queue", () => {
  it("approves with the request id and expected version and returns the new sheet", async () => {
    let approved: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op, payload } = opOf(init);
      if (op === "results.approveCorrection") {
        approved = payload;
        return json({ ok: true, value: { requestId: "request-1", sheetId: "sheet-2", sheetRef: "RES-2026-CORR01", sheetVersion: 1 } });
      }
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));

    const result = await academicsService.approveCorrection("request-1", 4);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ requestId: "request-1", sheetRef: "RES-2026-CORR01", sheetVersion: 1 });
    expect(approved).toMatchObject({ requestId: "request-1", expectedVersion: 4 });
  });

  it("does not claim approval succeeded when the new sheet reference is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, value: { requestId: "request-1" } })));
    const result = await academicsService.approveCorrection("request-1", 1);
    expect(result.ok).toBe(false);
  });

  it("maps pending corrections with their display fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = opOf(init);
      if (op === "results.listCorrections") {
        return json({
          ok: true,
          value: [{
            id: "request-1",
            version: 2,
            reason: "Recheck question 4",
            status: "requested",
            created_at: "2026-09-11T13:00:00Z",
            release_reference: RELEASE_REF,
            publication_id: PUBLICATION_ID,
            sheet_reference: SHEET_REF,
            subject_name: "English",
            term: "midterm",
            section_label: "A",
            grade_label: "Class 8",
          }],
        });
      }
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));

    const result = await academicsService.listCorrections();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toMatchObject({
        requestId: "request-1",
        version: 2,
        reason: "Recheck question 4",
        releaseRef: RELEASE_REF,
        sheetRef: SHEET_REF,
        subject: "English",
        className: "Class 8 · A",
      });
    }
  });

  it("returns an honest empty list in demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
    const result = await academicsService.listCorrections();
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe("report release candidates", () => {
  it("labels a blank student name instead of rendering an empty row", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { op } = opOf(init);
      if (op === "results.listBatches") return json({ ok: true, value: [sheetRow] });
      if (op === "results.releaseCandidates") {
        return json({
          ok: true,
          value: [{
            studentId: "00000000-0000-4000-8000-000000001001",
            enrollmentId: "00000000-0000-4000-8000-000000001101",
            studentName: "",
            publications: [{ publicationId: PUBLICATION_ID, reference: PUBLICATION_REF }],
            release: null,
          }],
        });
      }
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${op}`, field: null }] }, 500);
    }));

    const result = await academicsService.listReleaseCandidates(SHEET_REF);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.studentName).toBe("Student");
  });
});
