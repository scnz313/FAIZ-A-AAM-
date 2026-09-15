// @vitest-environment node
/**
 * Audited document delivery route (slice C3): anonymous visitors may only
 * fetch school-approved, finalized public documents; private and quarantined
 * references stay indistinguishable from unknown ones, and every public
 * issue is audited with a service-session audit row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dataAdapter: vi.fn(() => "supabase"),
  getServerActor: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  callAppRpc: vi.fn(),
  documentActorCanAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ dataAdapter: mocks.dataAdapter }));
vi.mock("@/lib/auth/actor", () => ({ getServerActor: mocks.getServerActor }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/supabase/rpc", () => ({ callAppRpc: mocks.callAppRpc }));
vi.mock("@/modules/services/document-access.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/services/document-access.server")>();
  return { ...actual, documentActorCanAccess: mocks.documentActorCanAccess };
});

import { GET } from "@/app/api/documents/[documentRef]/route";

const PUBLIC_DOCUMENT = {
  reference: "DOC-2026-PUBLIC",
  owner_domain: "school",
  owner_record_id: "00000000-0000-4000-8000-000000000001",
  object_key: "public/fee-schedule.pdf",
  storage_bucket: "fass-private-documents",
  mime_type: "application/pdf",
  safe_filename: "fee-schedule.pdf",
  scan_status: "ready",
  visibility: "public_approved",
  checksum_verified: true,
  finalized_at: "2026-08-01T00:00:00.000Z",
  retention_until: null,
  legal_hold_until: null,
  deleted_at: null,
};

function adminClientFor(
  document: Record<string, unknown>,
  extras: { generation?: Record<string, unknown> | null; release?: Record<string, unknown> | null } = {},
) {
  const rows: Record<string, Record<string, unknown> | null> = {
    documents: document,
    document_generation_records: extras.generation ?? null,
    result_report_releases: extras.release ?? null,
  };
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: "https://signed.example/document" },
    error: null,
  });
  const from = vi.fn((table: string) => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: rows[table] ?? null, error: null });
    const eq = vi.fn(() => ({ eq, maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    return { select };
  });
  return {
    from,
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
    createSignedUrl,
  };
}

const STUDENT_ID = "00000000-0000-4000-8000-000000000777";
const RELEASE_ID = "00000000-0000-4000-8000-000000001001";
const GUARDIAN_ACTOR = {
  accountId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000010",
  personId: "00000000-0000-4000-8000-000000000777",
  displayName: "Sana Wani",
  accountStatus: "active",
  roles: ["guardian"],
  securityVersion: 0,
  aal: "aal1",
};

const REPORT_CARD_DOCUMENT = {
  id: "00000000-0000-4000-8000-000000000901",
  reference: "DOC-2026-B4EEBA",
  owner_domain: "student",
  owner_record_id: STUDENT_ID,
  category: "generated_report_card",
  object_key: "generated/report_card/release/checksum.pdf",
  storage_bucket: "fass-generated-documents",
  mime_type: "application/pdf",
  safe_filename: "report-card-RPR-2026-8E5549.pdf",
  scan_status: "ready",
  visibility: "private",
  checksum_verified: true,
  finalized_at: "2026-09-11T18:35:26.000Z",
  retention_until: null,
  legal_hold_until: null,
  deleted_at: null,
};

const REPORT_CARD_GENERATION = { source_record_id: RELEASE_ID, document_type: "report_card" };

function requestFor(reference: string) {
  return new Request(`http://localhost/api/documents/${reference}`);
}

function contextFor(reference: string) {
  return { params: Promise.resolve({ documentRef: reference }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataAdapter.mockReturnValue("supabase");
  mocks.getServerActor.mockResolvedValue(null);
  mocks.documentActorCanAccess.mockResolvedValue(false);
  mocks.callAppRpc.mockResolvedValue({ data: "AUD-TEST-1", error: null });
});

describe("public document delivery", () => {
  it("redirects an anonymous visitor to a signed URL for an approved ready document and audits it", async () => {
    const admin = adminClientFor(PUBLIC_DOCUMENT);
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await GET(requestFor("DOC-2026-PUBLIC"), contextFor("DOC-2026-PUBLIC"));

    expect(response.status).toBe(302);
    expect(admin.storage.from).toHaveBeenCalledWith("fass-private-documents");
    expect(admin.createSignedUrl).toHaveBeenCalledWith("public/fee-schedule.pdf", 60, {
      download: "fee-schedule.pdf",
    });
    expect(mocks.callAppRpc).toHaveBeenCalledWith(
      expect.anything(),
      "record_audit",
      expect.objectContaining({
        p_action: "Public document download URL issued",
        p_target_type: "document",
        p_target_reference: "DOC-2026-PUBLIC",
        p_actor_label: "Public visitor",
      }),
    );
  });

  it("hides a quarantine-flagged approved document behind the shared not-found response", async () => {
    const admin = adminClientFor({ ...PUBLIC_DOCUMENT, scan_status: "quarantined" });
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await GET(requestFor("DOC-2026-QUARANTINE"), contextFor("DOC-2026-QUARANTINE"));

    expect(response.status).toBe(404);
    expect(admin.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("never serves a private document anonymously", async () => {
    const admin = adminClientFor({ ...PUBLIC_DOCUMENT, visibility: "private", scan_status: "clean" });
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await GET(requestFor("DOC-2026-PRIVATE"), contextFor("DOC-2026-PRIVATE"));

    expect(response.status).toBe(404);
    expect(admin.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("refuses an approved public document past its retention window", async () => {
    const admin = adminClientFor({
      ...PUBLIC_DOCUMENT,
      retention_until: "2026-07-01T00:00:00.000Z",
      legal_hold_until: null,
    });
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await GET(requestFor("DOC-2026-EXPIRED"), contextFor("DOC-2026-EXPIRED"));

    expect(response.status).toBe(404);
    expect(admin.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("withholds a generated report card whose source release is superseded from the family boundary", async () => {
    mocks.getServerActor.mockResolvedValue(GUARDIAN_ACTOR);
    mocks.createSupabaseServerClient.mockResolvedValue({});
    mocks.documentActorCanAccess.mockResolvedValue(true);
    mocks.callAppRpc.mockImplementation(async (_client, fn) =>
      fn === "document_staff_allowed" ? { data: false, error: null } : { data: "AUD-TEST-1", error: null },
    );
    const admin = adminClientFor(REPORT_CARD_DOCUMENT, {
      generation: REPORT_CARD_GENERATION,
      release: { status: "superseded" },
    });
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await GET(requestFor("DOC-2026-B4EEBA"), contextFor("DOC-2026-B4EEBA"));

    expect(response.status).toBe(404);
    expect(admin.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.callAppRpc).toHaveBeenCalledWith(
      expect.anything(),
      "document_staff_allowed",
      expect.objectContaining({ p_owner_domain: "student", p_owner_record_id: STUDENT_ID }),
    );
    expect(mocks.callAppRpc).not.toHaveBeenCalledWith(expect.anything(), "record_audit", expect.anything());
  });

  it("still serves the superseded report card to staff/audit access", async () => {
    mocks.getServerActor.mockResolvedValue({ ...GUARDIAN_ACTOR, roles: ["auditor"], aal: "aal2" });
    mocks.createSupabaseServerClient.mockResolvedValue({});
    mocks.documentActorCanAccess.mockResolvedValue(true);
    mocks.callAppRpc.mockImplementation(async (_client, fn) =>
      fn === "document_staff_allowed" ? { data: true, error: null } : { data: "AUD-TEST-1", error: null },
    );
    const admin = adminClientFor(REPORT_CARD_DOCUMENT, {
      generation: REPORT_CARD_GENERATION,
      release: { status: "superseded" },
    });
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await GET(requestFor("DOC-2026-B4EEBA"), contextFor("DOC-2026-B4EEBA"));

    expect(response.status).toBe(302);
    expect(admin.createSignedUrl).toHaveBeenCalled();
  });

  it("serves a generated report card whose source release is currently published", async () => {
    mocks.getServerActor.mockResolvedValue(GUARDIAN_ACTOR);
    mocks.createSupabaseServerClient.mockResolvedValue({});
    mocks.documentActorCanAccess.mockResolvedValue(true);
    mocks.callAppRpc.mockResolvedValue({ data: "AUD-TEST-1", error: null });
    const admin = adminClientFor(REPORT_CARD_DOCUMENT, {
      generation: REPORT_CARD_GENERATION,
      release: { status: "published" },
    });
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await GET(requestFor("DOC-2026-B4EEBA"), contextFor("DOC-2026-B4EEBA"));

    expect(response.status).toBe(302);
    expect(admin.createSignedUrl).toHaveBeenCalled();
    expect(mocks.callAppRpc).not.toHaveBeenCalledWith(expect.anything(), "document_staff_allowed", expect.anything());
  });

  it("records the signed-in actor label when a non-owner fetches a public document", async () => {
    mocks.getServerActor.mockResolvedValue({
      accountId: "00000000-0000-4000-8000-000000000010",
      userId: "00000000-0000-4000-8000-000000000010",
      accountStatus: "active",
      displayName: "Sana Wani",
    });
    mocks.createSupabaseServerClient.mockResolvedValue({});
    const admin = adminClientFor(PUBLIC_DOCUMENT);
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await GET(requestFor("DOC-2026-PUBLIC"), contextFor("DOC-2026-PUBLIC"));

    expect(response.status).toBe(302);
    expect(mocks.callAppRpc).toHaveBeenCalledWith(
      expect.anything(),
      "record_audit",
      expect.objectContaining({
        p_action: "Public document download URL issued",
        p_actor_label: "Sana Wani",
      }),
    );
  });
});
