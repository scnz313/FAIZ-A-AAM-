// @vitest-environment node
/**
 * Manual callback route contract: the shared secret is the only write
 * authority, only ready/quarantined/failed are accepted, and the response
 * never echoes provider detail or file content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dataAdapter: vi.fn(() => "supabase"),
  createSupabaseAdminClient: vi.fn(),
  callAppRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ dataAdapter: mocks.dataAdapter }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/supabase/rpc", () => ({ callAppRpc: mocks.callAppRpc }));

import { POST } from "@/app/api/documents/[documentRef]/scan/route";

const SECRET = "scanner-secret-0123456789abcdef";
const DOCUMENT_REF = "DOC-2026-FICTION";

function requestFor(reference: string, options: { authorization?: string | null; body?: unknown } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.authorization !== undefined && options.authorization !== null) headers.set("Authorization", options.authorization);
  return new Request(`http://localhost/api/documents/${reference}/scan`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? { status: "ready" }),
  });
}

function contextFor(reference: string) {
  return { params: Promise.resolve({ documentRef: reference }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DOCUMENT_SCANNER_SECRET", SECRET);
  mocks.dataAdapter.mockReturnValue("supabase");
  mocks.createSupabaseAdminClient.mockReturnValue({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { id: "00000000-0000-4000-8000-000000000301", reference: DOCUMENT_REF }, error: null }),
      };
      return chain;
    },
  });
  mocks.callAppRpc.mockResolvedValue({ data: { reference: DOCUMENT_REF, status: "ready" }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("document scan callback", () => {
  it("rejects a missing or mismatched shared secret without touching the pipeline", async () => {
    const missing = await POST(requestFor(DOCUMENT_REF, { authorization: null }), contextFor(DOCUMENT_REF));
    expect(missing.status).toBe(401);
    const wrong = await POST(requestFor(DOCUMENT_REF, { authorization: "Bearer wrong-secret-0123456789abcdef" }), contextFor(DOCUMENT_REF));
    expect(wrong.status).toBe(401);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("refuses a configured secret below the 16-character floor", async () => {
    vi.stubEnv("DOCUMENT_SCANNER_SECRET", "short");
    const response = await POST(requestFor(DOCUMENT_REF, { authorization: "Bearer short" }), contextFor(DOCUMENT_REF));
    expect(response.status).toBe(401);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("stays inactive in demo mode", async () => {
    mocks.dataAdapter.mockReturnValue("demo");
    const response = await POST(requestFor(DOCUMENT_REF, { authorization: `Bearer ${SECRET}` }), contextFor(DOCUMENT_REF));
    expect(response.status).toBe(503);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("accepts only ready/quarantined/failed, never pending or clean", async () => {
    for (const status of ["clean", "pending_scan", "ready ", "", null, 7]) {
      const response = await POST(requestFor(DOCUMENT_REF, { authorization: `Bearer ${SECRET}`, body: { status } }), contextFor(DOCUMENT_REF));
      expect(response.status).toBe(400);
    }
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("hides an unknown document and a rejected pipeline write", async () => {
    mocks.createSupabaseAdminClient.mockReturnValueOnce({
      from: () => {
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
        return chain;
      },
    });
    const notFound = await POST(requestFor("DOC-2026-MISSING", { authorization: `Bearer ${SECRET}` }), contextFor("DOC-2026-MISSING"));
    expect(notFound.status).toBe(404);

    mocks.callAppRpc.mockResolvedValueOnce({ data: null, error: { message: "document has not been finalized" } });
    const rejected = await POST(requestFor(DOCUMENT_REF, { authorization: `Bearer ${SECRET}` }), contextFor(DOCUMENT_REF));
    expect(rejected.status).toBe(422);
  });

  it("applies ready, quarantined, and failed results without echoing provider detail", async () => {
    for (const status of ["ready", "quarantined", "failed"] as const) {
      mocks.callAppRpc.mockResolvedValueOnce({ data: { reference: DOCUMENT_REF, status }, error: null });
      const response = await POST(
        requestFor(DOCUMENT_REF, { authorization: `Bearer ${SECRET}`, body: { status, detail: "provider internals must not surface" } }),
        contextFor(DOCUMENT_REF),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, documentRef: DOCUMENT_REF, status });
      expect(mocks.callAppRpc).toHaveBeenCalledWith(
        expect.anything(),
        "documents_apply_scan",
        expect.objectContaining({ p_document_id: "00000000-0000-4000-8000-000000000301", p_status: status }),
      );
    }
  });
});
