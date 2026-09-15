// @vitest-environment node
/**
 * Pipeline mapping for the selected scanner provider: only an explicit
 * provider result may change `documents.scan_status`; the manual handoff and
 * provider failures leave the document pending.
 */
import { describe, expect, it, vi } from "vitest";

import { dispatchEvent, type OutboxEventRow } from "@/lib/supabase/outbox-worker";
import { ManualDocumentScanner, type DocumentScanner, type ScanInput } from "@/modules/services/document-providers";

const DOCUMENT_BYTES = new TextEncoder().encode("%PDF-1.4 fictional pipeline fixture");
const DOCUMENT = {
  id: "00000000-0000-4000-8000-000000000201",
  reference: "DOC-2026-FICTION",
  object_key: "uploads/00000000-0000-4000-8000-000000000201.pdf",
  storage_bucket: "fass-private-documents",
  mime_type: "application/pdf",
  size_bytes: DOCUMENT_BYTES.byteLength,
  checksum_verified: true,
  scan_status: "pending_scan",
  actual_mime_type: "application/pdf",
  actual_size_bytes: DOCUMENT_BYTES.byteLength,
};

function storageEvent(): OutboxEventRow {
  return {
    id: "00000000-0000-4000-8000-000000000901",
    event_key: "storage.finalize:DOC-2026-FICTION",
    kind: "storage.finalize",
    target_type: "document",
    target_reference: "DOC-2026-FICTION",
    payload: {},
    status: "processing",
    attempts: 0,
  };
}

function harness() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === "documents" ? DOCUMENT : null, error: null }),
      };
      return chain;
    },
    schema(schema: string) {
      return {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn: `${schema}.${fn}`, args });
          return { data: { reference: DOCUMENT.reference, status: args.p_status ?? "ready" }, error: null };
        },
      };
    },
  };
  const storage = {
    stat: vi.fn(async () => ({
      bytes: DOCUMENT_BYTES,
      sizeBytes: DOCUMENT_BYTES.byteLength,
      checksumSha256: "b".repeat(64),
      contentType: "application/pdf",
    })),
  };
  return { admin, storage, calls };
}

async function run(scanner: DocumentScanner) {
  const { admin, storage, calls } = harness();
  const outcome = await dispatchEvent(
    admin as never,
    storageEvent(),
    undefined,
    storage as never,
    scanner,
  );
  return { outcome, calls, storage };
}

describe("document scan pipeline", () => {
  it("records a manual handoff as delivered and never applies a scan result", async () => {
    const { outcome, calls } = await run(new ManualDocumentScanner(null));
    expect(outcome).toEqual({ kind: "delivered", providerIds: ["manual:DOC-2026-FICTION:pending_callback"] });
    expect(calls.some((call) => call.fn === "app.documents_apply_scan")).toBe(false);
  });

  it("keeps an unreachable provider transient so the outbox retries", async () => {
    const scanner = { scan: vi.fn(async () => { throw new Error("clamav scanner connection failed"); }) };
    const { outcome, calls } = await run(scanner);
    expect(outcome).toEqual({ kind: "transient", error: "clamav scanner connection failed" });
    expect(calls.some((call) => call.fn === "app.documents_apply_scan")).toBe(false);
  });

  it("passes the storage-attested bytes to the provider", async () => {
    const scan = vi.fn(async () => ({ state: "ready" as const }));
    await run({ scan });
    expect(scan).toHaveBeenCalledWith({
      bucket: "fass-private-documents",
      objectKey: "uploads/00000000-0000-4000-8000-000000000201.pdf",
      declaredMimeType: "application/pdf",
      sizeBytes: DOCUMENT_BYTES.byteLength,
      checksumSha256: "b".repeat(64),
      bytes: DOCUMENT_BYTES,
    });
  });

  it("applies exactly the explicit provider states", async () => {
    for (const state of ["ready", "quarantined", "failed"] as const) {
      const { outcome, calls } = await run({ scan: vi.fn(async (): Promise<{ state: typeof state; detail?: string }> => ({ state, detail: `provider ${state}` })) });
      expect(outcome).toEqual({ kind: "delivered", providerIds: ["DOC-2026-FICTION"] });
      const applied = calls.find((call) => call.fn === "app.documents_apply_scan");
      expect(applied?.args).toMatchObject({ p_status: state, p_detail: `provider ${state}` });
    }
  });

  it("never reaches apply_scan through a manual deferral even when a trigger is configured", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const { outcome, calls } = await run(new ManualDocumentScanner({ endpoint: "http://127.0.0.1:3999/scan", secret: "s".repeat(32), fetchImpl }));
    expect(outcome.kind).toBe("delivered");
    expect(calls.some((call) => call.fn === "app.documents_apply_scan")).toBe(false);
  });
});
