// @vitest-environment node
/**
 * Server command contract for `documentsSetPublicVisibility` (domain.ts):
 * it resolves the document through the same authorized projection the
 * documents workspace lists (`documents_projection_get`, one reference), not
 * the unbounded full-register read (000114), delegates to the
 * content-publisher-only `app.documents_set_public_visibility` RPC with the
 * expected payload, and surfaces readiness refusals without a direct table
 * update.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { documentsSetPublicVisibility } from "@/lib/supabase/domain";
import type { Database } from "@/lib/supabase/database.types";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000084";

const readyRow = {
  id: DOCUMENT_ID,
  reference: "DOC-2026-0001",
  ownerDomain: "school_document",
  visibility: "private",
  status: "ready",
  scanState: "ready",
  finalizationState: "verified",
  checksumVerified: true,
  finalizedAt: "2026-09-01T00:00:00Z",
};

function commandClient(
  projectionRows: Array<Record<string, unknown>>,
  resolution: { data: unknown; error: { message: string } | null },
) {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: projectionRows[0] ?? null, error: null })
    .mockResolvedValue(resolution);
  const client = {
    schema: vi.fn().mockReturnValue({ rpc }),
  } as unknown as SupabaseClient<Database>;
  return { client, rpc };
}

function commandCalls(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls.filter(([fn]) => fn === "documents_set_public_visibility");
}

describe("documentsSetPublicVisibility command", () => {
  it("calls the anchored RPC with the resolved id, boolean, and reason", async () => {
    const { client, rpc } = commandClient([readyRow], {
      data: { documentId: DOCUMENT_ID, reference: "DOC-2026-0001", visibility: "public_approved" },
      error: null,
    });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-0001",
      visibility: "public_approved",
      reason: "Approved for the public downloads register",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ reference: "DOC-2026-0001", visibility: "public_approved" });
    expect(rpc).toHaveBeenCalledWith("documents_projection_get", { p_reference: "DOC-2026-0001" });
    expect(rpc).toHaveBeenCalledWith("documents_set_public_visibility", {
      p_document_id: DOCUMENT_ID,
      p_public: true,
      p_reason: "Approved for the public downloads register",
    });
  });

  it("resolves a non-school record through the staff projection so it can still be withdrawn", async () => {
    /* The live defect: `public.documents` RLS via `document_staff_allowed`
       excludes `data_import_batch`, so the old direct read returned null for a
       row the register clearly listed and approve/withdraw answered 404.
       Import artifacts may no longer be approved, but withdrawal must still
       resolve them through the same projection. */
    const importArtifact = { ...readyRow, ownerDomain: "data_import_batch", visibility: "public_approved" };
    const { client, rpc } = commandClient([importArtifact], {
      data: { documentId: DOCUMENT_ID, reference: "DOC-2026-0001", visibility: "private" },
      error: null,
    });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-0001",
      visibility: "private",
    });

    expect(result.ok).toBe(true);
    expect(commandCalls(rpc)).toHaveLength(1);
    expect(commandCalls(rpc)[0]?.[1]).toMatchObject({ p_document_id: DOCUMENT_ID, p_public: false });
  });

  it("refuses to approve a per-student document for the anonymous public register", async () => {
    /* Live defect: a report card carries a clean scan and verified bytes, so
       the readiness check alone let it be approved into the anonymous public
       downloads register. Only school-level documents belong there. */
    const reportCard = { ...readyRow, reference: "DOC-2026-REPORT", ownerDomain: "student" };
    const { client, rpc } = commandClient([reportCard], { data: null, error: null });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-REPORT",
      visibility: "public_approved",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("conflict");
    expect(result.errors[0]?.message).toMatch(/only school documents/i);
    expect(commandCalls(rpc)).toHaveLength(0);
  });

  it("still allows withdrawing a non-school document that was already public", async () => {
    const reportCard = { ...readyRow, reference: "DOC-2026-REPORT", ownerDomain: "student", visibility: "public_approved" };
    const { client, rpc } = commandClient([reportCard], {
      data: { documentId: DOCUMENT_ID, reference: "DOC-2026-REPORT", visibility: "private" },
      error: null,
    });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-REPORT",
      visibility: "private",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.visibility).toBe("private");
    expect(commandCalls(rpc)).toHaveLength(1);
    expect(commandCalls(rpc)[0]?.[1]).toMatchObject({ p_document_id: DOCUMENT_ID, p_public: false });
  });

  it("passes a null reason and the withdraw boolean unchanged", async () => {
    const { client, rpc } = commandClient([{ ...readyRow, visibility: "public_approved" }], {
      data: { documentId: DOCUMENT_ID, reference: "DOC-2026-0001", visibility: "private" },
      error: null,
    });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-0001",
      visibility: "private",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.visibility).toBe("private");
    expect(rpc).toHaveBeenCalledWith("documents_set_public_visibility", {
      p_document_id: DOCUMENT_ID,
      p_public: false,
      p_reason: null,
    });
  });

  it("reports a document outside the visible projection as not found", async () => {
    const { client, rpc } = commandClient([], { data: null, error: null });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-9999",
      visibility: "public_approved",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("not-found");
    expect(commandCalls(rpc)).toHaveLength(0);
  });

  it("surfaces the local readiness refusal without reaching the RPC", async () => {
    const { client, rpc } = commandClient([{ ...readyRow, status: "quarantined", scanState: "quarantined" }], { data: null, error: null });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-0001",
      visibility: "public_approved",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("conflict");
    expect(result.errors[0]?.message).toMatch(/quarantined/i);
    expect(commandCalls(rpc)).toHaveLength(0);
  });

  it("refuses an expired or retention-reached projection row", async () => {
    const { client, rpc } = commandClient([
      { ...readyRow, status: "expired", scanState: "ready", finalizationState: "verified" },
    ], { data: null, error: null });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-0001",
      visibility: "public_approved",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("conflict");
    expect(result.errors[0]?.message).toMatch(/retention period/i);
    expect(commandCalls(rpc)).toHaveLength(0);
  });

  it("maps an RPC readiness refusal to conflict", async () => {
    const { client } = commandClient([readyRow], {
      data: null,
      error: { message: "document is not ready for public view (scan status pending_scan)" },
    });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-0001",
      visibility: "public_approved",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("conflict");
  });

  it("maps the RPC role denial to forbidden", async () => {
    const { client } = commandClient([readyRow], {
      data: null,
      error: { message: "content publisher role and aal2 required" },
    });

    const result = await documentsSetPublicVisibility(client, {
      reference: "DOC-2026-0001",
      visibility: "public_approved",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("forbidden");
  });
});
