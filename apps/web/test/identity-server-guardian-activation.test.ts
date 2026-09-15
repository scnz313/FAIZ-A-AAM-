// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  markDispatched: vi.fn(),
  revoke: vi.fn(),
  sender: vi.fn(),
}));

vi.mock("@/lib/supabase/domain", () => ({
  applicantRegister: vi.fn(),
  guardianClaimAcceptByToken: vi.fn(),
  guardianClaimCreate: mocks.create,
  guardianClaimMarkDispatched: mocks.markDispatched,
  guardianClaimPreview: vi.fn(),
  guardianClaimRevoke: mocks.revoke,
  staffInvitesAcceptAuth: vi.fn(),
  staffInvitesAttachProvider: vi.fn(),
  staffInvitesCreateProfileRecord: vi.fn(),
  staffInvitesMarkProviderFailed: vi.fn(),
  staffInvitesMarkResent: vi.fn(),
  staffInvitesRevoke: vi.fn(),
}));

vi.mock("@/lib/email/resend", () => ({ createResendSender: () => mocks.sender }));
vi.mock("@/lib/supabase/env", () => ({ requireAppEnv: () => ({ appUrl: "https://school.test" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const data = table === "guardian_contacts"
        ? { value: "guardian@example.test", guardian_id: "guardian-1" }
        : table === "guardians"
          ? { people: { display_name: "Test Guardian" } }
          : [{ students: { people: { display_name: "Student One" } } }];
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(async () => ({ data: Array.isArray(data) ? data[0] : data, error: null })),
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data, error: null }).then(resolve); },
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return chain;
    },
  }),
}));

import { dispatchGuardianActivation } from "@/lib/auth/identity-server";
import { AuthProviderError, setAuthProviderForTests, type AuthProvider } from "@/lib/auth/provider";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const client = {} as SupabaseClient<Database>;
let createInviteLink: ReturnType<typeof vi.fn>;
let deleteUser: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    ok: true,
    value: {
      claimId: "claim-1",
      reference: "GCL-2026-1234567890",
      channel: "email",
      status: "pending",
      expiresAt: "2026-10-01T00:00:00.000Z",
      oneTimeSecret: "guardian-activation-secret-value",
    },
  });
  mocks.markDispatched.mockResolvedValue({ ok: true, value: { status: "dispatched" } });
  mocks.revoke.mockResolvedValue({ ok: true, value: { status: "revoked" } });
  mocks.sender.mockResolvedValue({ providerMessageId: "email-1" });
  createInviteLink = vi.fn().mockResolvedValue({ userId: "provider-user-1", actionLink: "https://provider.test/activate" });
  deleteUser = vi.fn();
  setAuthProviderForTests({
    createApplicantUser: vi.fn(),
    inviteUser: vi.fn(),
    createInviteLink,
    sendRecovery: vi.fn(),
    deleteUser,
  } as unknown as AuthProvider);
});

afterEach(() => setAuthProviderForTests(null));

describe("dispatchGuardianActivation", () => {
  it("creates the claim, sends the activation email, and marks it dispatched", async () => {
    const result = await dispatchGuardianActivation(client, { guardianId: "guardian-1", contactId: "contact-1", reason: "Portal activation requested." });

    expect(result.ok).toBe(true);
    expect(createInviteLink).toHaveBeenCalledWith(expect.objectContaining({ mode: "invite" }));
    expect(mocks.sender).toHaveBeenCalledWith(expect.objectContaining({
      to: ["guardian@example.test"],
      idempotencyKey: "guardian-claim:GCL-2026-1234567890:1",
    }));
    expect(mocks.markDispatched).toHaveBeenCalledWith(client, { claimReference: "GCL-2026-1234567890", providerSubject: "provider-user-1" });
  });

  it("falls back to a reinvite link when the email already has an Auth user", async () => {
    createInviteLink
      .mockRejectedValueOnce(new AuthProviderError("email_exists", "Existing account"))
      .mockResolvedValueOnce({ userId: "provider-user-1", actionLink: "https://provider.test/reinvite" });

    const result = await dispatchGuardianActivation(client, { guardianId: "guardian-1", contactId: "contact-1", reason: "Portal activation requested." });

    expect(result.ok).toBe(true);
    expect(createInviteLink.mock.calls.map((call) => call[0].mode)).toEqual(["invite", "reinvite"]);
  });

  it("revokes the claim without deleting the Auth user when email delivery fails", async () => {
    mocks.sender.mockRejectedValue(new Error("Transient:Resend 503"));

    const result = await dispatchGuardianActivation(client, { guardianId: "guardian-1", contactId: "contact-1", reason: "Portal activation requested." });

    expect(result.ok).toBe(false);
    expect(mocks.revoke).toHaveBeenCalledWith(client, {
      claimReference: "GCL-2026-1234567890",
      reason: "Dispatch failed: email delivery",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
