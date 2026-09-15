// @vitest-environment node
/**
 * Public job-application intake routes (owner requirement, 15 September
 * 2026). The public applicant has no session, so these tests lock the
 * security boundary: same-origin enforcement, strict schema (no mass
 * assignment), honeypot rejection without a database write, rate limiting,
 * typed SQL error mapping, and the one optional photo intent. All values are
 * synthetic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dataAdapter: vi.fn(() => "supabase"),
  consumeAuthRateLimit: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  callAppRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({ dataAdapter: mocks.dataAdapter }));
vi.mock("@/lib/auth/identity-server", () => ({ consumeAuthRateLimit: mocks.consumeAuthRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/supabase/rpc", () => ({ callAppRpc: mocks.callAppRpc }));

import { POST as applyPost } from "@/app/api/careers/apply/route";
import { POST as photoIntentPost } from "@/app/api/careers/apply/photo-intent/route";

const VALID_APPLICATION = {
  vacancyRef: "VAC-2026-40E963",
  vacancyVersion: 1,
  fullName: "Aisha Mir",
  email: "Aisha@Example.com",
  phone: "+91 90000 00000",
  location: "Bandipora",
  qualification: "Bachelor of Education (B.Ed.)",
  subject: "Mathematics",
  year: "2020",
  institution: "Demo College of Education",
  experience: "3–5 years",
  currentRole: "Teacher",
  message: "Available from April.",
  consent: true,
};

function requestFor(path: string, body: unknown, init: { origin?: string; host?: string; secFetchSite?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.origin !== undefined) headers.origin = init.origin;
  if (init.host !== undefined) headers.host = init.host;
  if (init.secFetchSite !== undefined) headers["sec-fetch-site"] = init.secFetchSite;
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function adminClient() {
  const createSignedUploadUrl = vi.fn().mockResolvedValue({ data: { token: "signed-upload-token" }, error: null });
  return { storage: { from: vi.fn(() => ({ createSignedUploadUrl })) }, createSignedUploadUrl };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataAdapter.mockReturnValue("supabase");
  mocks.consumeAuthRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
  mocks.createSupabaseAdminClient.mockReturnValue(adminClient());
  mocks.callAppRpc.mockResolvedValue({ data: { applicationId: "00000000-0000-4000-8000-000000000901", reference: "JOB-2026-PUBLIC", status: "submitted", version: 1 }, error: null });
});

describe("POST /api/careers/apply", () => {
  it("submits a validated public application and returns the reference", async () => {
    const response = await applyPost(requestFor("/api/careers/apply", VALID_APPLICATION, { origin: "http://localhost", host: "localhost" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, reference: "JOB-2026-PUBLIC" });
    expect(mocks.callAppRpc).toHaveBeenCalledTimes(1);
    const [, operation, params] = mocks.callAppRpc.mock.calls[0]!;
    expect(operation).toBe("jobs_public_submit_application");
    expect((params as { p_payload: Record<string, unknown> }).p_payload).toMatchObject({
      vacancyRef: "VAC-2026-40E963",
      vacancyVersion: 1,
      fullName: "Aisha Mir",
      consent: true,
    });
    expect((params as { p_payload: Record<string, unknown> }).p_payload).not.toHaveProperty("website");
  });

  it("refuses a cross-origin submission before any rate limit or database work", async () => {
    const response = await applyPost(requestFor("/api/careers/apply", VALID_APPLICATION, { origin: "http://evil.example" }));

    expect(response.status).toBe(403);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
    expect(mocks.consumeAuthRateLimit).not.toHaveBeenCalled();
  });

  it("refuses fetch-metadata cross-site requests even when the origin header is absent", async () => {
    const response = await applyPost(requestFor("/api/careers/apply", VALID_APPLICATION, { origin: "http://localhost", host: "localhost", secFetchSite: "cross-site" }));

    expect(response.status).toBe(403);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("refuses a body over the public JSON cap with 413 before rate limits or parsing", async () => {
    const oversized = { ...VALID_APPLICATION, message: "x".repeat(70 * 1024) };

    const response = await applyPost(requestFor("/api/careers/apply", oversized, { origin: "http://localhost", host: "localhost" }));

    expect(response.status).toBe(413);
    expect(mocks.consumeAuthRateLimit).not.toHaveBeenCalled();
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload with 400 and never reaches the command", async () => {
    const response = await applyPost(requestFor("/api/careers/apply", { ...VALID_APPLICATION, email: "not-an-email" }, { origin: "http://localhost", host: "localhost" }));

    expect(response.status).toBe(400);
    expect((await response.json() as Record<string, unknown>).code).toBe("validation");
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("rejects unknown fields so mass assignment is impossible", async () => {
    const response = await applyPost(requestFor(
      "/api/careers/apply",
      { ...VALID_APPLICATION, ownerAccountId: "00000000-0000-4000-8000-000000000999", current_status: "offered" },
      { origin: "http://localhost", host: "localhost" },
    ));

    expect(response.status).toBe(400);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("requires an explicit consent declaration", async () => {
    const response = await applyPost(requestFor("/api/careers/apply", { ...VALID_APPLICATION, consent: false }, { origin: "http://localhost", host: "localhost" }));

    expect(response.status).toBe(400);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("silently accepts a honeypot submission without writing a record", async () => {
    const response = await applyPost(requestFor("/api/careers/apply", { ...VALID_APPLICATION, website: "http://spam.example" }, { origin: "http://localhost", host: "localhost" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
    expect(mocks.consumeAuthRateLimit).not.toHaveBeenCalled();
  });

  it("rate limits by connection and contact with Retry-After", async () => {
    mocks.consumeAuthRateLimit.mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 1 });
    mocks.consumeAuthRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 900 });

    const response = await applyPost(requestFor("/api/careers/apply", VALID_APPLICATION, { origin: "http://localhost", host: "localhost" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("900");
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
    const subjects = mocks.consumeAuthRateLimit.mock.calls.map((call) => (call[0] as { subject: string }).subject);
    expect(subjects).toContain("aisha@example.com");
  });

  it("reports the honest unavailable state when the rate-limit store is down", async () => {
    mocks.consumeAuthRateLimit.mockRejectedValue(new Error("rate store down"));

    const response = await applyPost(requestFor("/api/careers/apply", VALID_APPLICATION, { origin: "http://localhost", host: "localhost" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.code).toBe("unavailable");
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("maps typed command errors to honest statuses", async () => {
    const cases = [
      { error: "duplicate_application: an application was already received", status: 409, code: "duplicate" },
      { error: "vacancy_not_found: this vacancy is not available", status: 404, code: "not_found" },
      { error: "vacancy_not_open: this vacancy is not open", status: 410, code: "closed" },
      { error: "deadline_passed: the deadline has passed", status: 410, code: "closed" },
      { error: "vacancy_version_mismatch: refresh the page", status: 409, code: "stale_vacancy" },
      { error: "invalid_payload: the phone number is not accepted", status: 422, code: "validation" },
    ];
    for (const entry of cases) {
      mocks.callAppRpc.mockResolvedValueOnce({ data: null, error: { message: entry.error } });
      const response = await applyPost(requestFor("/api/careers/apply", VALID_APPLICATION, { origin: "http://localhost", host: "localhost" }));
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(entry.status);
      expect(body.code).toBe(entry.code);
      expect(body.error).not.toMatch(/^[a-z_]+:/);
    }
  });

  it("keeps a transport failure retryable with a correlation id", async () => {
    mocks.callAppRpc.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });

    const response = await applyPost(requestFor("/api/careers/apply", VALID_APPLICATION, { origin: "http://localhost", host: "localhost" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.code).toBe("unavailable");
    expect(typeof body.correlationId).toBe("string");
  });

  it("is unavailable in demo mode instead of pretending to persist", async () => {
    mocks.dataAdapter.mockReturnValue("demo");

    const response = await applyPost(requestFor("/api/careers/apply", VALID_APPLICATION, { origin: "http://localhost", host: "localhost" }));

    expect(response.status).toBe(503);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/careers/apply/photo-intent", () => {
  const VALID_PHOTO = { reference: "JOB-2026-PUBLIC", filename: "profile.jpg", mimeType: "image/jpeg", sizeBytes: 2048 };

  beforeEach(() => {
    mocks.callAppRpc.mockResolvedValue({
      data: { applicationId: "00000000-0000-4000-8000-000000000901", applicationReference: "JOB-2026-PUBLIC", documentId: "00000000-0000-4000-8000-000000000902", documentRef: "DOC-2026-PHOTO", objectKey: "uploads/opaque.jpg", status: "pending_scan" },
      error: null,
    });
  });

  it("creates a signed upload URL for the service-role photo intent", async () => {
    const admin = adminClient();
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await photoIntentPost(requestFor("/api/careers/apply/photo-intent", VALID_PHOTO, { origin: "http://localhost", host: "localhost" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, documentRef: "DOC-2026-PHOTO", objectKey: "uploads/opaque.jpg", token: "signed-upload-token", bucket: "fass-private-documents" });
    expect(admin.createSignedUploadUrl).toHaveBeenCalledWith("uploads/opaque.jpg");
    expect(mocks.callAppRpc).toHaveBeenCalledWith(expect.anything(), "jobs_public_photo_intent", {
      p_application_reference: "JOB-2026-PUBLIC",
      p_safe_filename: "profile.jpg",
      p_declared_mime_type: "image/jpeg",
      p_declared_size: 2048,
    });
  });

  it("refuses non-image declarations and oversized images before any storage intent", async () => {
    for (const payload of [
      { ...VALID_PHOTO, mimeType: "application/pdf" },
      { ...VALID_PHOTO, sizeBytes: 2 * 1024 * 1024 + 1 },
      { ...VALID_PHOTO, sizeBytes: 0 },
    ]) {
      const response = await photoIntentPost(requestFor("/api/careers/apply/photo-intent", payload, { origin: "http://localhost", host: "localhost" }));
      expect(response.status).toBe(400);
    }
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("refuses cross-origin photo intents", async () => {
    const response = await photoIntentPost(requestFor("/api/careers/apply/photo-intent", VALID_PHOTO, { origin: "http://evil.example" }));

    expect(response.status).toBe(403);
    expect(mocks.callAppRpc).not.toHaveBeenCalled();
  });

  it("maps command denials (one photo per application, wrong stage)", async () => {
    for (const entry of [
      { error: "photo_already_attached: a profile photo is already attached", status: 409 },
      { error: "photo_not_allowed: a photo cannot be added at this stage", status: 422 },
      { error: "application_not_found: this application reference is not available", status: 404 },
    ]) {
      mocks.callAppRpc.mockResolvedValueOnce({ data: null, error: { message: entry.error } });
      const response = await photoIntentPost(requestFor("/api/careers/apply/photo-intent", VALID_PHOTO, { origin: "http://localhost", host: "localhost" }));
      expect(response.status).toBe(entry.status);
    }
  });

  it("reports unavailable when the signed URL cannot be created", async () => {
    const admin = adminClient();
    admin.createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "storage down" } });
    mocks.createSupabaseAdminClient.mockReturnValue(admin);

    const response = await photoIntentPost(requestFor("/api/careers/apply/photo-intent", VALID_PHOTO, { origin: "http://localhost", host: "localhost" }));

    expect(response.status).toBe(503);
  });
});
