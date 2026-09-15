// @vitest-environment node
/**
 * Public profile-photo finalize boundary (owner requirement, 15 September
 * 2026). The server never trusts the declared type or size: it re-reads the
 * stored bytes, checks the real magic type and exact size, finalizes through
 * the service-role document commands, and links the photo to the application.
 * The scan status intentionally remains pending.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dataAdapter: vi.fn(() => "supabase"),
  consumeAuthRateLimit: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  callAppRpc: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ dataAdapter: mocks.dataAdapter }));
vi.mock("@/lib/auth/identity-server", () => ({ consumeAuthRateLimit: mocks.consumeAuthRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/supabase/rpc", () => ({ callAppRpc: mocks.callAppRpc }));
vi.mock("@/lib/documents/providers", () => ({
  SupabaseStorageProvider: class {
    stat = mocks.stat;
  },
}));

import { POST } from "@/app/api/careers/apply/photo-finalize/route";

const APPLICATION_ID = "00000000-0000-4000-8000-000000000901";
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const DOCUMENT = {
  id: "00000000-0000-4000-8000-000000000902",
  reference: "DOC-2026-PHOTO",
  owner_domain: "job_application",
  owner_record_id: APPLICATION_ID,
  category: "profile_photo",
  object_key: "uploads/opaque.png",
  storage_bucket: "fass-private-documents",
  mime_type: "image/png",
  size_bytes: PNG_BYTES.byteLength,
  scan_status: "pending_scan",
  checksum_verified: false,
  deleted_at: null,
};

function requestFor(body: unknown, origin = "http://localhost"): Request {
  return new Request("http://localhost/api/careers/apply/photo-finalize", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: "localhost" },
    body: JSON.stringify(body),
  });
}

function fakeDb(rows: { job_applications?: unknown; documents?: unknown }) {
  return {
    from: vi.fn((table: keyof typeof rows) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: rows[table] ?? null, error: null })),
      };
      return chain;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataAdapter.mockReturnValue("supabase");
  mocks.consumeAuthRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
  mocks.createSupabaseAdminClient.mockReturnValue(fakeDb({ job_applications: { id: APPLICATION_ID, reference: "JOB-2026-PHOTO" }, documents: { ...DOCUMENT } }));
  mocks.stat.mockResolvedValue({ bytes: PNG_BYTES, sizeBytes: PNG_BYTES.byteLength, checksumSha256: "a".repeat(64) });
  mocks.callAppRpc.mockImplementation(async (_admin: unknown, operation: string) => {
    if (operation === "documents_finalize_upload") return { data: { reference: "DOC-2026-PHOTO", status: "pending_scan", checksumVerified: true }, error: null };
    if (operation === "documents_link_attachment") return { data: { reference: "DOC-2026-PHOTO" }, error: null };
    return { data: null, error: { message: `unexpected ${operation}` } };
  });
});

describe("POST /api/careers/apply/photo-finalize", () => {
  it("verifies the stored bytes, finalizes, and links the photo to the application", async () => {
    const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, documentRef: "DOC-2026-PHOTO", state: "pending_scan" });
    expect(mocks.stat).toHaveBeenCalledWith({ bucket: "fass-private-documents", objectKey: "uploads/opaque.png" });
    expect(mocks.callAppRpc).toHaveBeenCalledWith(expect.anything(), "documents_finalize_upload", {
      p_document_id: DOCUMENT.id,
      p_actual_mime_type: "image/png",
      p_actual_size: PNG_BYTES.byteLength,
      p_checksum: "a".repeat(64),
    });
    expect(mocks.callAppRpc).toHaveBeenCalledWith(expect.anything(), "documents_link_attachment", {
      p_document_id: DOCUMENT.id,
      p_owner_domain: "job_application",
      p_owner_record_id: APPLICATION_ID,
      p_attachment_code: "profile_photo",
    });
  });

  it("refuses a cross-origin finalize before any read", async () => {
    const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }, "http://evil.example"));

    expect(response.status).toBe(403);
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it("rejects a malformed reference payload", async () => {
    const response = await POST(requestFor({ reference: "x" }));

    expect(response.status).toBe(400);
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it("returns 404 when the application reference does not resolve", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb({ job_applications: null, documents: { ...DOCUMENT } }));

    const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }));

    expect(response.status).toBe(404);
  });

  it("returns 404 when the document belongs to another application or category", async () => {
    for (const document of [
      { ...DOCUMENT, owner_record_id: "00000000-0000-4000-8000-000000000999" },
      { ...DOCUMENT, category: "identity_proof" },
      { ...DOCUMENT, owner_domain: "admission_application" },
    ]) {
      mocks.createSupabaseAdminClient.mockReturnValue(fakeDb({ job_applications: { id: APPLICATION_ID, reference: "JOB-2026-PHOTO" }, documents: document }));
      const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }));
      expect(response.status).toBe(404);
    }
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("is idempotent for an already-finalized photo", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb({
      job_applications: { id: APPLICATION_ID, reference: "JOB-2026-PHOTO" },
      documents: { ...DOCUMENT, checksum_verified: true, scan_status: "clean" },
    }));

    const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, documentRef: "DOC-2026-PHOTO", state: "ready" });
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("rejects bytes whose real magic type differs from the declared image type", async () => {
    mocks.stat.mockResolvedValue({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), sizeBytes: 4, checksumSha256: "b".repeat(64) });

    const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }));

    expect(response.status).toBe(422);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("rejects a stored size that differs from the authorized size", async () => {
    mocks.stat.mockResolvedValue({ bytes: PNG_BYTES, sizeBytes: PNG_BYTES.byteLength + 1, checksumSha256: "c".repeat(64) });

    const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }));

    expect(response.status).toBe(422);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("reports an honest retryable state when the upload is not readable yet", async () => {
    mocks.stat.mockRejectedValue(new Error("not found"));

    const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }));

    expect(response.status).toBe(422);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("rate limits finalize attempts", async () => {
    mocks.consumeAuthRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 600 });

    const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }));

    expect(response.status).toBe(429);
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it("keeps the verified photo retryable when linking fails", async () => {
    mocks.callAppRpc.mockImplementation(async (_admin: unknown, operation: string) => {
      if (operation === "documents_finalize_upload") return { data: { reference: "DOC-2026-PHOTO", status: "pending_scan", checksumVerified: true }, error: null };
      return { data: null, error: { message: "link temporarily unavailable" } };
    });

    const response = await POST(requestFor({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-PHOTO" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.code).toBe("unavailable");
  });
});
