// @vitest-environment node
/**
 * Upload-intent route boundary for school documents: a content-publisher
 * staff session may create an intent anchored to its own account, the
 * server-resolved constraints stay PDF/JPEG/PNG, and every other owner
 * domain, malformed payload, and CSV declaration is refused before any
 * storage operation. All values are synthetic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dataAdapter: vi.fn(() => "supabase"),
  getServerActor: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  callAppRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ dataAdapter: mocks.dataAdapter }));
vi.mock("@/lib/auth/actor", () => ({ getServerActor: mocks.getServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/supabase/rpc", () => ({ callAppRpc: mocks.callAppRpc }));

import { POST } from "@/app/api/documents/upload-intent/route";

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000203";

const CONTENT_PUBLISHER = {
  accountId: ACCOUNT_ID,
  userId: ACCOUNT_ID,
  displayName: "Sana Wani",
  accountStatus: "active",
  roles: ["content_publisher"],
  securityVersion: 0,
  aal: "aal2",
};

function requestFor(body: unknown): Request {
  return new Request("http://localhost/api/documents/upload-intent", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      host: "localhost",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function schoolDocumentPayload(overrides: Record<string, unknown> = {}) {
  return {
    ownerDomain: "school_document",
    ownerRecordRef: ACCOUNT_ID,
    attachmentCode: "school_policy",
    filename: "fee-schedule.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    ...overrides,
  };
}

function adminClient() {
  const createSignedUploadUrl = vi.fn().mockResolvedValue({
    data: { token: "signed-upload-token" },
    error: null,
  });
  return { storage: { from: vi.fn(() => ({ createSignedUploadUrl })) }, createSignedUploadUrl };
}

function admissionClientWithoutMatch() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const eq = vi.fn(() => ({ eq, maybeSingle }));
  const select = vi.fn(() => ({ eq, maybeSingle }));
  return { from: vi.fn(() => ({ select })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataAdapter.mockReturnValue("supabase");
  mocks.getServerActor.mockResolvedValue(CONTENT_PUBLISHER);
  mocks.createSupabaseServerClient.mockResolvedValue({});
  mocks.createSupabaseAdminClient.mockReturnValue(adminClient());
  mocks.callAppRpc.mockResolvedValue({
    data: {
      id: "00000000-0000-4000-8000-000000000901",
      reference: "DOC-2026-SCHOOL",
      objectKey: "uploads/11111111-1111-4111-8111-111111111111.pdf",
      status: "pending_scan",
    },
    error: null,
  });
});

describe("school document upload intent", () => {
  it("accepts a content-publisher school document anchored to the actor account", async () => {
    const admin = adminClient();
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await POST(requestFor(schoolDocumentPayload()));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.documentRef).toBe("DOC-2026-SCHOOL");
    expect(mocks.callAppRpc).toHaveBeenCalledWith(
      expect.anything(),
      "documents_create_upload_intent",
      expect.objectContaining({
        p_owner_domain: "school_document",
        p_owner_record_id: ACCOUNT_ID,
        p_attachment_code: "school_policy",
        p_declared_mime_type: "application/pdf",
        p_declared_size: 2048,
        p_allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"],
        p_max_bytes: 10 * 1024 * 1024,
      }),
    );
    expect(admin.createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("refuses a CSV declaration for a school document before creating an intent", async () => {
    const response = await POST(requestFor(schoolDocumentPayload({
      filename: "export.csv",
      mimeType: "text/csv",
    })));

    expect(response.status).toBe(422);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("rejects an unsupported owner domain before creating an intent", async () => {
    const response = await POST(requestFor(schoolDocumentPayload({ ownerDomain: "invoice" })));

    expect(response.status).toBe(400);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload", async () => {
    const response = await POST(requestFor({ ownerDomain: "school_document", ownerRecordRef: ACCOUNT_ID }));

    expect(response.status).toBe(400);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("rejects the request when no staff session is present", async () => {
    mocks.getServerActor.mockResolvedValue(null);

    const response = await POST(requestFor(schoolDocumentPayload()));

    expect(response.status).toBe(401);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("keeps other owner domains on their existing lookup denial path", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(admissionClientWithoutMatch());

    const response = await POST(requestFor(schoolDocumentPayload({
      ownerDomain: "admission_application",
      ownerRecordRef: "APP-2026-7K4M2Q",
    })));

    expect(response.status).toBe(404);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });
});
