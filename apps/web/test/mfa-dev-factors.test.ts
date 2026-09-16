// @vitest-environment node
/**
 * Dev-factor safety for the MFA routes:
 * - /api/auth/mfa/dev-elevate deletes ONLY "Dev auto-elevation" factors and
 *   leaves real "Staff access" factors untouched.
 * - /api/auth/mfa/purge-dev-factors requires a session, is a no-op while
 *   TOTP is not required, and removes only dev-named factors.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSameOrigin: vi.fn(() => true),
  dataAdapter: vi.fn(() => "supabase"),
  totpRequired: vi.fn(() => false),
  requireSupabasePublicEnv: vi.fn(() => ({ url: "https://supabase.test", publishableKey: "pk" })),
  requireSupabaseSecretEnv: vi.fn(() => ({ secretKey: "sk" })),
  createSupabaseServerClient: vi.fn(),
  createAdminClient: vi.fn(),
  markMfaVerified: vi.fn().mockResolvedValue({ ok: true }),
  recordAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/same-origin", () => ({ isSameOrigin: mocks.isSameOrigin }));
vi.mock("@/lib/supabase/env", () => ({
  dataAdapter: mocks.dataAdapter,
  totpRequired: mocks.totpRequired,
  requireSupabasePublicEnv: mocks.requireSupabasePublicEnv,
  requireSupabaseSecretEnv: mocks.requireSupabaseSecretEnv,
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/supabase/domain", () => ({
  markMfaVerified: mocks.markMfaVerified,
  recordAuthEvent: mocks.recordAuthEvent,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createAdminClient }));

import { POST as devElevate } from "@/app/api/auth/mfa/dev-elevate/route";
import { POST as purgeDevFactors } from "@/app/api/auth/mfa/purge-dev-factors/route";

function post(path: string): Request {
  return new Request(`https://school.test${path}`, { method: "POST", body: "{}" });
}

function aal1Session() {
  return {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: { claims: { sub: "user-1", aal: "aal1" } },
        error: null,
      }),
      mfa: {
        enroll: vi.fn().mockResolvedValue({
          data: { id: "new-factor", totp: { secret: "JBSWY3DPEHPK3PXP", qr_code: "otpauth://x" } },
          error: null,
        }),
        challenge: vi.fn().mockResolvedValue({ data: { id: "challenge-1" }, error: null }),
        verify: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  };
}

function adminWithFactors(factors: Array<{ id: string; friendly_name: string }>) {
  const adminAuth = {
    _listFactors: vi.fn().mockResolvedValue({ data: { factors } }),
    _deleteFactor: vi.fn().mockResolvedValue({ error: null }),
  };
  mocks.createAdminClient.mockReturnValue({ auth: { admin: adminAuth } });
  return adminAuth;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSameOrigin.mockReturnValue(true);
  mocks.dataAdapter.mockReturnValue("supabase");
  mocks.totpRequired.mockReturnValue(false);
  mocks.markMfaVerified.mockResolvedValue({ ok: true });
});

describe("dev-elevate factor cleanup", () => {
  it("deletes only the dev factor and preserves a real Staff access factor", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(aal1Session());
    const adminAuth = adminWithFactors([
      { id: "real-1", friendly_name: "Staff access" },
      { id: "dev-1", friendly_name: "Dev auto-elevation" },
    ]);

    const response = await devElevate(post("/api/auth/mfa/dev-elevate"));

    expect(response.status).toBe(200);
    expect(adminAuth._deleteFactor).toHaveBeenCalledTimes(1);
    expect(adminAuth._deleteFactor).toHaveBeenCalledWith({ userId: "user-1", id: "dev-1" });
    expect(adminAuth._deleteFactor).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "real-1" }),
    );
  });

  it("still works when no dev factor exists", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(aal1Session());
    const adminAuth = adminWithFactors([{ id: "real-1", friendly_name: "Staff access" }]);

    const response = await devElevate(post("/api/auth/mfa/dev-elevate"));

    expect(response.status).toBe(200);
    expect(adminAuth._deleteFactor).not.toHaveBeenCalled();
  });
});

describe("purge-dev-factors route", () => {
  it("returns 401 without an authenticated session", async () => {
    mocks.totpRequired.mockReturnValue(true);
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getClaims: vi.fn().mockResolvedValue({ data: null, error: { message: "no session" } }) },
    });

    const response = await purgeDevFactors(post("/api/auth/mfa/purge-dev-factors"));

    expect(response.status).toBe(401);
  });

  it("is a no-op when TOTP is not required", async () => {
    mocks.totpRequired.mockReturnValue(false);
    mocks.createSupabaseServerClient.mockResolvedValue(aal1Session());
    const adminAuth = adminWithFactors([{ id: "dev-1", friendly_name: "Dev auto-elevation" }]);

    const response = await purgeDevFactors(post("/api/auth/mfa/purge-dev-factors"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, removed: 0 });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(adminAuth._listFactors).not.toHaveBeenCalled();
  });

  it("removes only dev-named factors for the signed-in user", async () => {
    mocks.totpRequired.mockReturnValue(true);
    mocks.createSupabaseServerClient.mockResolvedValue(aal1Session());
    const adminAuth = adminWithFactors([
      { id: "dev-1", friendly_name: "Dev auto-elevation" },
      { id: "real-1", friendly_name: "Staff access" },
      { id: "dev-2", friendly_name: "Dev auto-elevation" },
    ]);

    const response = await purgeDevFactors(post("/api/auth/mfa/purge-dev-factors"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, removed: 2 });
    expect(adminAuth._deleteFactor).toHaveBeenCalledTimes(2);
    expect(adminAuth._deleteFactor).toHaveBeenCalledWith({ userId: "user-1", id: "dev-1" });
    expect(adminAuth._deleteFactor).toHaveBeenCalledWith({ userId: "user-1", id: "dev-2" });
  });
});
