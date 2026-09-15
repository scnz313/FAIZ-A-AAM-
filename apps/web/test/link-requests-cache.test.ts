// @vitest-environment jsdom
/**
 * Link-queue read-model regression: one bounded page serves both the request
 * rows and the summary rows, and a link command invalidates the page cache so
 * the refresh is authoritative. The paged shape replaced the former unbounded
 * table read (000114).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SUMMARY = {
  link: {
    id: "00000000-0000-4000-8000-000000000801",
    ref: "LINK-2026-0801",
    guardianId: "00000000-0000-4000-8000-000000000802",
    studentId: "00000000-0000-4000-8000-000000000803",
    relationshipLabel: "Parent",
    status: "pending_verification",
    verificationSource: "guardian_request",
    approvedAtIso: null,
    effectiveFromIso: "2026-08-10T05:00:00.000Z",
    effectiveToIso: null,
    restrictionReason: null,
    rejectionReason: null,
    contactPriority: 1,
    isEmergencyContact: false,
    isBillingContact: false,
    capabilities: [],
    version: 1,
  },
  guardianName: "Zoya Khan",
  studentName: "Aarif Khan",
  studentRef: "STU-2026-0801",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function page(rows: unknown[]): unknown {
  return { rows, total: rows.length, nextOffset: null };
}

beforeEach(() => {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("link request projection", () => {
  it("serves request rows and summaries from one bounded pending page", async () => {
    vi.resetModules();
    const ops: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload?: { offset?: number; limit?: number } };
        ops.push(request.op);
        if (request.op === "links.listPage") return json({ ok: true, value: page([SUMMARY]) });
        return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
      }),
    );

    const { familyContextService } = await import("@/modules/services/family-context");
    const requests = await familyContextService.listLinkRequests();
    const summaries = await familyContextService.listLinkRequestSummaries();

    expect(requests.rows).toHaveLength(1);
    expect(requests.total).toBe(1);
    expect(summaries.rows).toHaveLength(1);
    expect(summaries.total).toBe(1);
    expect(requests.rows[0]?.request.ref).toBe("LINK-2026-0801");
    expect(summaries.rows[0]?.guardianName).toBe("Zoya Khan");
    expect(ops.filter((op) => op === "links.listPage")).toHaveLength(1);
  });

  it("invalidates the pending page after a rejection so the refresh is authoritative", async () => {
    vi.resetModules();
    const ops: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
        ops.push(request.op);
        if (request.op === "links.listPage") return json({ ok: true, value: page([SUMMARY]) });
        if (request.op === "links.get") return json({ ok: true, value: SUMMARY });
        if (request.op === "links.reject") return json({ ok: true, value: { id: SUMMARY.link.id, status: "rejected", version: 2 } });
        return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
      }),
    );

    const { familyContextService } = await import("@/modules/services/family-context");
    await familyContextService.listLinkRequests();
    await familyContextService.rejectPendingLinkRequest(SUMMARY.link.id, "The relationship could not be verified.");
    await familyContextService.listLinkRequests();

    expect(ops.filter((op) => op === "links.listPage")).toHaveLength(2);
    expect(ops).toContain("links.get");
    expect(ops).toContain("links.reject");
  });
});
