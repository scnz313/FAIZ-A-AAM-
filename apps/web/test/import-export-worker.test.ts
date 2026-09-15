// @vitest-environment node

/**
 * Provider-worker import parse and export generation. These are the two
 * server-side file operations:
 *   · data_import_parse reads a private CSV, shapes canonical camelCase row
 *     fields, stores rows, and records the scan with JSON array headers.
 *   · data_export_generate writes the selected allowlisted columns under the
 *     catalog names the SQL allowlist and the builder UI agree on.
 */
import { describe, expect, it, vi } from "vitest";

import { dispatchEvent, type OutboxEventRow } from "@/lib/supabase/outbox-worker";
import { detectContentType } from "@/modules/services/document-providers";

type FakeError = { message: string };

function fakeAdmin(
  tables: Record<string, Array<Record<string, unknown>>>,
  options: { errors?: Record<string, FakeError> } = {},
) {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const failure = options.errors?.[table] ?? null;
      const result = () => failure !== null
        ? { data: null, error: { message: failure.message } }
        : { data: rows(), error: null };
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return chain; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return chain; },
        limit() { return chain; },
        range() { return chain; },
        insert() { return chain; },
        update() { return chain; },
        upsert() { return chain; },
        maybeSingle: async () => failure !== null
          ? { data: null, error: { message: failure.message } }
          : { data: rows()[0] ?? null, error: null },
        single: async () => failure !== null
          ? { data: null, error: { message: failure.message } }
          : { data: rows()[0] ?? null, error: null },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return chain;
    },
  };
}

function withRpc(
  admin: ReturnType<typeof fakeAdmin>,
  rpcResults: Record<string, { data: unknown; error: FakeError | null }>,
  calls: Array<{ fn: string; args: Record<string, unknown> }> = [],
) {
  return {
    ...admin,
    schema(schema: string) {
      return {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn: `${schema}.${fn}`, args });
          return rpcResults[`${schema}.${fn}`] ?? { data: null, error: null };
        },
      };
    },
  };
}

function event(input: Partial<OutboxEventRow>): OutboxEventRow {
  return {
    id: "00000000-0000-4000-8000-000000000901",
    event_key: "data_import_parse:BATCH-1:v2",
    kind: "data_import_parse",
    target_type: "data_import_batch",
    target_reference: "IMP-2026-0001",
    payload: {},
    status: "processing",
    attempts: 0,
    ...input,
  };
}

const CSV_BYTES = new TextEncoder().encode([
  "entity,source_key,given_name,family_name,email",
  "students,STU-1,Aarif,Hussain,Parent@Example.COM",
].join("\n"));

describe("data_import_parse dispatch", () => {
  it("stores canonical camelCase rows and records array headers", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const tracked = withRpc(
      fakeAdmin({
        data_import_batches: [{ id: "batch-1", reference: "IMP-2026-0001", state: "scanning", source_document_id: "doc-1" }],
        documents: [{ id: "doc-1", storage_bucket: "fass-private-documents", object_key: "uploads/source.csv", safe_filename: "roster.csv", mime_type: "text/csv", size_bytes: CSV_BYTES.byteLength }],
      }),
      {
        "app.data_import_store_rows": { data: 1, error: null },
        "app.data_import_record_scan": { data: { state: "mapping" }, error: null },
      },
      calls,
    );
    const storage = {
      stat: vi.fn(async () => ({ bytes: CSV_BYTES, sizeBytes: CSV_BYTES.byteLength, checksumSha256: "a".repeat(64) })),
      list: vi.fn(),
      remove: vi.fn(),
      upload: vi.fn(),
    };

    const outcome = await dispatchEvent(
      tracked as never,
      event({}),
      undefined,
      storage as never,
      {} as never,
    );

    expect(outcome).toEqual({ kind: "delivered", providerIds: ["import:IMP-2026-0001:1rows"] });
    const storeCall = calls.find((call) => call.fn === "app.data_import_store_rows");
    const storedRows = storeCall?.args.p_rows as Array<{ sourceKey: string; normalized: Record<string, unknown> }>;
    expect(storedRows[0]?.sourceKey).toBe("STU-1");
    expect(storedRows[0]?.normalized.givenName).toBe("Aarif");
    expect(storedRows[0]?.normalized.familyName).toBe("Hussain");
    expect(storedRows[0]?.normalized.contact).toBe("parent@example.com");

    const scanCall = calls.find((call) => call.fn === "app.data_import_record_scan");
    expect(Array.isArray(scanCall?.args.p_headers)).toBe(true);
    expect(scanCall?.args.p_headers).toEqual(["entity", "source_key", "given_name", "family_name", "email"]);
  });

  it("reports a parse failure and records the scan error instead of claiming success", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const admin = withRpc(
      fakeAdmin({
        data_import_batches: [{ id: "batch-1", reference: "IMP-2026-0001", state: "scanning", source_document_id: "doc-1" }],
        documents: [{ id: "doc-1", storage_bucket: "fass-private-documents", object_key: "uploads/source.csv", safe_filename: "roster.csv", mime_type: "text/csv", size_bytes: 4 }],
      }),
      { "app.data_import_record_scan": { data: { state: "scanning" }, error: null } },
      calls,
    );
    const storage = {
      stat: vi.fn(async () => ({ bytes: new TextEncoder().encode("a\0b"), sizeBytes: 3, checksumSha256: "b".repeat(64) })),
    };

    const outcome = await dispatchEvent(admin as never, event({}), undefined, storage as never, {} as never);

    expect(outcome.kind).toBe("permanent");
    const scanCall = calls.find((call) => call.fn === "app.data_import_record_scan");
    expect(scanCall?.args.p_error).toEqual(expect.stringContaining("binary"));
  });

  it("keeps a storage read failure transient and never records it as a parse failure", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const admin = withRpc(
      fakeAdmin({
        data_import_batches: [{ id: "batch-1", reference: "IMP-2026-0001", state: "scanning", source_document_id: "doc-1" }],
        documents: [{ id: "doc-1", storage_bucket: "fass-private-documents", object_key: "uploads/source.csv", safe_filename: "roster.csv", mime_type: "text/csv", size_bytes: CSV_BYTES.byteLength }],
      }),
      { "app.data_import_record_scan": { data: { state: "mapping" }, error: null } },
      calls,
    );
    const storage = {
      stat: vi.fn(async () => { throw new Error("socket hang up"); }),
    };

    const outcome = await dispatchEvent(admin as never, event({}), undefined, storage as never, {} as never);

    expect(outcome.kind).toBe("transient");
    expect(calls.find((call) => call.fn === "app.data_import_record_scan")).toBeUndefined();
  });

  it("stores a large parse in bounded chunks instead of one unbounded payload", async () => {
    const lines = ["entity,source_key,given_name,family_name"];
    for (let index = 1; index <= 1200; index += 1) lines.push(`students,STU-${index},Pupil${index},Ward`);
    const bigCsv = new TextEncoder().encode(lines.join("\n"));
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const tracked = withRpc(
      fakeAdmin({
        data_import_batches: [{ id: "batch-1", reference: "IMP-2026-0001", state: "scanning", source_document_id: "doc-1" }],
        documents: [{ id: "doc-1", storage_bucket: "fass-private-documents", object_key: "uploads/source.csv", safe_filename: "roster.csv", mime_type: "text/csv", size_bytes: bigCsv.byteLength }],
      }),
      {
        "app.data_import_store_rows": { data: 1, error: null },
        "app.data_import_record_scan": { data: { state: "mapping" }, error: null },
      },
      calls,
    );
    const storage = { stat: vi.fn(async () => ({ bytes: bigCsv, sizeBytes: bigCsv.byteLength, checksumSha256: "e".repeat(64) })) };

    const outcome = await dispatchEvent(tracked as never, event({}), undefined, storage as never, {} as never);

    expect(outcome).toEqual({ kind: "delivered", providerIds: ["import:IMP-2026-0001:1200rows"] });
    const storeCalls = calls.filter((call) => call.fn === "app.data_import_store_rows");
    expect(storeCalls).toHaveLength(3);
    for (const call of storeCalls) {
      expect((call.args.p_rows as unknown[]).length).toBeLessThanOrEqual(500);
    }
    const stored = storeCalls.flatMap((call) => call.args.p_rows as Array<{ sourceKey: string }>);
    expect(stored).toHaveLength(1200);
    expect(stored[1199]?.sourceKey).toBe("STU-1200");
  });

  it("parses structural columns through the mapping aliases", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const aliased = new TextEncoder().encode([
      "Entity,Source Key,Given Name,Family Name,Email",
      "students,STU-9,Sana,Wani,Sana@Example.COM",
    ].join("\n"));
    const tracked = withRpc(
      fakeAdmin({
        data_import_batches: [{ id: "batch-1", reference: "IMP-2026-0001", state: "scanning", source_document_id: "doc-1" }],
        documents: [{ id: "doc-1", storage_bucket: "fass-private-documents", object_key: "uploads/source.csv", safe_filename: "roster.csv", mime_type: "text/csv", size_bytes: aliased.byteLength }],
      }),
      {
        "app.data_import_store_rows": { data: 1, error: null },
        "app.data_import_record_scan": { data: { state: "mapping" }, error: null },
      },
      calls,
    );
    const storage = {
      stat: vi.fn(async () => ({ bytes: aliased, sizeBytes: aliased.byteLength, checksumSha256: "c".repeat(64) })),
    };

    const outcome = await dispatchEvent(tracked as never, event({}), undefined, storage as never, {} as never);

    expect(outcome).toEqual({ kind: "delivered", providerIds: ["import:IMP-2026-0001:1rows"] });
    const storeCall = calls.find((call) => call.fn === "app.data_import_store_rows");
    const storedRows = storeCall?.args.p_rows as Array<{ sourceKey: string; normalized: Record<string, unknown> }>;
    expect(storedRows[0]?.sourceKey).toBe("STU-9");
    expect(storedRows[0]?.normalized.givenName).toBe("Sana");
    expect(storedRows[0]?.normalized.familyName).toBe("Wani");
    expect(storedRows[0]?.normalized.contact).toBe("sana@example.com");
  });
});

describe("storage.finalize dispatch (import source documents)", () => {
  it("recognizes a CSV upload by its bytes instead of classifying it as binary", () => {
    expect(detectContentType(CSV_BYTES)).toBe("text/csv");
    expect(detectContentType(new TextEncoder().encode("a\0b,c"))).toBe("application/octet-stream");
    expect(detectContentType(new TextEncoder().encode("%PDF-1.4"))).toBe("application/pdf");
  });

  it("scans an already-attested CSV without re-finalizing it and without failing the batch", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const admin = withRpc(
      fakeAdmin({
        documents: [{
          id: "doc-1",
          reference: "DOC-2026-0001",
          object_key: "uploads/source.csv",
          storage_bucket: "fass-private-documents",
          mime_type: "text/csv",
          size_bytes: CSV_BYTES.byteLength,
          checksum_verified: true,
          actual_mime_type: "text/csv",
          actual_size_bytes: CSV_BYTES.byteLength,
          scan_status: "pending_scan",
        }],
      }),
      { "app.documents_apply_scan": { data: { reference: "DOC-2026-0001", status: "ready" }, error: null } },
      calls,
    );
    const storage = { stat: vi.fn(async () => ({ bytes: CSV_BYTES, sizeBytes: CSV_BYTES.byteLength, checksumSha256: "d".repeat(64) })) };
    const scanner = { scan: vi.fn(async () => ({ state: "ready" as const })) };

    const outcome = await dispatchEvent(
      admin as never,
      event({ kind: "storage.finalize", target_type: "document", target_reference: "DOC-2026-0001", event_key: "storage.finalize:DOC-2026-0001" }),
      undefined,
      storage as never,
      scanner as never,
    );

    expect(outcome).toEqual({ kind: "delivered", providerIds: ["DOC-2026-0001"] });
    expect(calls.find((call) => call.fn === "app.documents_finalize_upload")).toBeUndefined();
    expect(scanner.scan).toHaveBeenCalledWith(expect.objectContaining({ declaredMimeType: "text/csv" }));
    const scanCall = calls.find((call) => call.fn === "app.documents_apply_scan");
    expect(scanCall?.args.p_status).toBe("ready");
  });
});

describe("data_export_generate dispatch", () => {
  it("writes selected catalog columns with their real values", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const admin = withRpc(
      fakeAdmin({
        data_export_requests: [{ reference: "EXP-2026-0001", domain: "students", format: "csv", filters: {}, columns: ["reference", "display_name", "grade_label"] }],
        students: [{
          reference: "STU-1",
          people: { display_name: "Aarif Hussain" },
          status: "active",
          school_student_number: "1001",
          enrollments: [{ status: "active", grade_sections: { grades: { label: "Class 8" }, section_label: "A" }, academic_years: { label: "2026-27" } }],
        }],
        documents: [{ id: "document-1" }],
      }),
      {
        "app.data_export_claim_generation": { data: { state: "generating" }, error: null },
        "app.data_export_mark_ready": { data: { state: "ready" }, error: null },
      },
      calls,
    );
    const uploaded: { bytes?: Uint8Array } = {};
    const storage = {
      upload: vi.fn(async (input: { bytes: Uint8Array }) => { uploaded.bytes = input.bytes; }),
    };

    const outcome = await dispatchEvent(
      admin as never,
      event({ kind: "data.export.generate", target_type: "data_export_request", target_reference: "EXP-2026-0001" }),
      undefined,
      storage as never,
      {} as never,
    );

    expect(outcome).toEqual({ kind: "delivered", providerIds: ["export:EXP-2026-0001:1rows"] });
    const csv = new TextDecoder().decode(uploaded.bytes);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("reference,display_name,grade_label");
    expect(lines[1]).toBe("STU-1,Aarif Hussain,Class 8");

    const readyCall = calls.find((call) => call.fn === "app.data_export_mark_ready");
    expect(readyCall?.args.p_row_count).toBe(1);
  });

  it("records a generation failure with its reason so the workspace can offer retry", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const admin = withRpc(
      fakeAdmin({
        data_export_requests: [{ reference: "EXP-2026-0002", domain: "students", format: "csv", filters: {}, columns: [] }],
        students: [],
      }),
      {
        "app.data_export_claim_generation": { data: { state: "generating" }, error: null },
        "app.data_export_mark_failed": { data: { reference: "EXP-2026-0002", state: "failed" }, error: null },
        "app.data_export_release_generation": { data: {}, error: null },
      },
      calls,
    );
    const storage = { upload: vi.fn(async () => { throw new Error("storage unavailable"); }) };

    const outcome = await dispatchEvent(
      admin as never,
      event({ kind: "data.export.generate", target_type: "data_export_request", target_reference: "EXP-2026-0002" }),
      undefined,
      storage as never,
      {} as never,
    );

    expect(outcome.kind).toBe("permanent");
    const failedCall = calls.find((call) => call.fn === "app.data_export_mark_failed");
    expect(failedCall?.args.p_error).toContain("storage unavailable");
  });
});
