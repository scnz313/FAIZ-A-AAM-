// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRecord: vi.fn(),
  attachProvider: vi.fn(),
  markFailed: vi.fn(),
  markResent: vi.fn(),
  revoke: vi.fn(),
  sender: vi.fn(),
  adminInvitation: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/supabase/domain", () => ({
  applicantRegister: vi.fn(),
  staffInvitesAcceptAuth: vi.fn(),
  staffInvitesAttachProvider: mocks.attachProvider,
  staffInvitesCreateProfileRecord: mocks.createRecord,
  staffInvitesMarkProviderFailed: mocks.markFailed,
  staffInvitesMarkResent: mocks.markResent,
  staffInvitesRevoke: mocks.revoke,
}));

vi.mock("@/lib/email/resend", () => ({
  createResendSender: () => mocks.sender,
}));

vi.mock("@/lib/supabase/env", () => ({
  requireAppEnv: () => ({ appUrl: "https://school.test" }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      is: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: mocks.adminInvitation, error: null })),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.in.mockReturnValue(chain);
    chain.is.mockReturnValue(chain);
    return { from: vi.fn(() => chain) };
  },
}));

import {
  dispatchStaffInvitation,
  resendStaffInvitation,
} from "@/lib/auth/identity-server";
import { setAuthProviderForTests, type AuthProvider } from "@/lib/auth/provider";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const client = {} as SupabaseClient<Database>;
const input = {
  contact: "probe@example.test",
  expiresAt: "2026-10-01T00:00:00.000Z",
  displayName: "Probe Invitee",
  profileCode: "principal",
  reason: "New staff appointment.",
};

let createInviteLink: ReturnType<typeof vi.fn>;
let deleteUser: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminInvitation = null;
  mocks.createRecord.mockResolvedValue({ ok: true, value: { invitationRef: "INV-2026-14A5963F8B" } });
  mocks.attachProvider.mockResolvedValue({ ok: true, value: { status: "dispatched" } });
  mocks.markFailed.mockResolvedValue({ ok: true, value: { ok: true } });
  mocks.markResent.mockResolvedValue({ ok: true, value: { invitationRef: "INV-2026-14A5963F8B", resendCount: 3, expiresAt: "2026-10-01T00:00:00.000Z" } });
  mocks.sender.mockResolvedValue({ providerMessageId: "email-1" });
  createInviteLink = vi.fn().mockResolvedValue({ userId: "00000000-0000-4000-8000-000000000999", actionLink: "https://provider.test/invite" });
  deleteUser = vi.fn().mockResolvedValue(undefined);
  setAuthProviderForTests({
    createApplicantUser: vi.fn(),
    inviteUser: vi.fn(),
    createInviteLink,
    sendRecovery: vi.fn(),
    deleteUser,
  } as unknown as AuthProvider);
});

afterEach(() => {
  setAuthProviderForTests(null);
});

describe("staff invitation dispatch", () => {
  it("creates the link, sends the branded email, then attaches the provider", async () => {
    const order: string[] = [];
    createInviteLink.mockImplementation(async () => {
      order.push("link");
      return { userId: "00000000-0000-4000-8000-000000000999", actionLink: "https://provider.test/invite" };
    });
    mocks.sender.mockImplementation(async () => {
      order.push("send");
      return { providerMessageId: "email-1" };
    });
    mocks.attachProvider.mockImplementation(async () => {
      order.push("attach");
      return { ok: true, value: { status: "dispatched" } };
    });

    const result = await dispatchStaffInvitation(client, input);

    expect(result.ok).toBe(true);
    expect(order).toEqual(["link", "send", "attach"]);
    expect(createInviteLink).toHaveBeenCalledWith(expect.objectContaining({ mode: "invite" }));
    expect(mocks.sender).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "staff-invite:INV-2026-14A5963F8B:1",
      to: ["probe@example.test"],
    }));
  });

  it("deletes the provider user and marks the invitation failed when email delivery fails", async () => {
    mocks.sender.mockRejectedValue(new Error("Transient:Resend 503"));

    const result = await dispatchStaffInvitation(client, input);

    expect(result.ok).toBe(false);
    expect(deleteUser).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000999");
    expect(mocks.markFailed).toHaveBeenCalledWith(client, {
      invitationReference: "INV-2026-14A5963F8B",
      reason: "Email delivery failed",
    });
    expect(mocks.attachProvider).not.toHaveBeenCalled();
  });

  it("uses the next send attempt after the initial delivery for a resend", async () => {
    mocks.adminInvitation = {
      contact: "probe@example.test",
      provider_subject: "00000000-0000-4000-8000-000000000999",
      expires_at: "2026-10-01T00:00:00.000Z",
      resend_count: 0,
      intended_display_name: "Probe Invitee",
    };

    const result = await resendStaffInvitation(client, {
      invitationReference: "INV-2026-14A5963F8B",
      reason: "Link expired for the invitee.",
    });

    expect(result.ok).toBe(true);
    expect(createInviteLink).toHaveBeenCalledWith(expect.objectContaining({ mode: "reinvite" }));
    expect(mocks.sender).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "staff-invite:INV-2026-14A5963F8B:2",
    }));
    expect(mocks.markResent).toHaveBeenCalledWith(client, {
      invitationReference: "INV-2026-14A5963F8B",
      providerSubject: "00000000-0000-4000-8000-000000000999",
    });
  });
});
