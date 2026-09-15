import "server-only";

import { createHash } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAppEnv } from "@/lib/supabase/env";
import {
  applicantRegister,
  staffInvitesAcceptAuth,
  staffInvitesAttachProvider,
  staffInvitesCreateProfileRecord,
  staffInvitesMarkProviderFailed,
  staffInvitesMarkResent,
  staffInvitesRevoke,
} from "@/lib/supabase/domain";
import { AuthProviderError, authProvider } from "@/lib/auth/provider";
import { safeAuthRedirect } from "@/lib/auth/redirect";
import { createResendSender } from "@/lib/email/resend";
import { staffInvitationEmail } from "@/lib/email/templates";
import { callAppRpc } from "@/lib/supabase/rpc";
import type { ServiceResult } from "@fass/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

function safeFailure<T>(message: string, retryable = false): ServiceResult<T> {
  return {
    ok: false,
    errors: [{ code: retryable ? "retryable" : "unavailable", message, field: null, retryable }],
    httpStatus: retryable ? 503 : 400,
    retryable,
  };
}

export { isSameOrigin } from "@/lib/auth/same-origin";

export async function consumeAuthRateLimit(input: {
  subject: string;
  action: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const subjectHash = createHash("sha256").update(`${input.action}:${input.subject}`, "utf8").digest("hex");
  const admin = createSupabaseAdminClient();
  const { data, error } = await callAppRpc<{ allowed?: boolean; retryAfterSeconds?: number }>(admin, "auth_rate_limit_consume", {
    p_subject_hash: subjectHash,
    p_action: input.action,
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  });
  if (error !== null || data === null) throw new Error("Auth rate limit is unavailable.");
  return { allowed: data.allowed === true, retryAfterSeconds: Math.max(1, Number(data.retryAfterSeconds ?? input.windowSeconds)) };
}

/**
 * Create a provider-invited Auth user and provision the minimum application
 * identity in one server-controlled flow. The provider invitation proves
 * email ownership before the account can be used. If the database RPC fails,
 * the provider user is compensated so no unusable account is left.
 */
export async function registerApplicant(input: {
  email: string;
  givenName: string;
  familyName: string;
  purpose?: "student_admission" | "job_application";
  next?: string;
}): Promise<ServiceResult<{ accountId: string; applicantIdentityRef: string; verificationRequired: true }>> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@") || !input.givenName.trim() || !input.familyName.trim()) {
    return safeFailure("Enter a valid email and both names.");
  }
  const provider = authProvider();
  let created: { userId: string; email: string; verificationRequired: true; providerRef?: string };
  try {
    const { appUrl } = requireAppEnv();
    const next = safeAuthRedirect(input.next, "/apply/student");
    created = await provider.createApplicantUser({
      email,
      redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      givenName: input.givenName.trim(),
      familyName: input.familyName.trim(),
    });
  } catch {
    return safeFailure("The account could not be created. Try again shortly.", true);
  }
  let result: Awaited<ReturnType<typeof applicantRegister>>;
  try {
    const admin = createSupabaseAdminClient();
    result = await applicantRegister(admin, {
      authUserId: created.userId,
      contact: email,
      givenName: input.givenName.trim(),
      familyName: input.familyName.trim(),
      purpose: input.purpose,
    });
  } catch {
    try { await provider.deleteUser(created.userId); } catch { /* provider rollback is best effort */ }
    return safeFailure("The account could not be provisioned. Try again shortly.", true);
  }
  if (!result.ok) {
    try { await provider.deleteUser(created.userId); } catch { /* provider rollback is best effort */ }
    return safeFailure("The account could not be provisioned. Try again shortly.", true);
  }
  const value = result.value;
  return {
    ok: true,
    value: {
      accountId: String(value.accountId ?? created.userId),
      applicantIdentityRef: String(value.applicantIdentityRef ?? ""),
      verificationRequired: true,
    },
  };
}

function inviteProviderFailure(error: unknown): ServiceResult<never> {
  if (error instanceof AuthProviderError) {
    if (error.code === "email_exists") {
      return safeFailure("This email already has a sign-in account. Use profile change or recovery instead.");
    }
    if (error.code === "rate_limited") {
      return safeFailure("The sign-in provider is rate limiting invitations. Try again in a few minutes.", true);
    }
  }
  return safeFailure("The invitation could not be sent. No staff access was created.", true);
}

async function sendStaffInvitation(input: {
  contact: string;
  invitationRef: string;
  actionLink: string;
  expiresAt: string;
  displayName: string;
  attempt: number;
}): Promise<void> {
  const email = staffInvitationEmail({
    reference: input.invitationRef,
    actionLink: input.actionLink,
    expiresAt: input.expiresAt,
    displayName: input.displayName,
  });
  await createResendSender()({
    to: [input.contact.trim().toLowerCase()],
    subject: email.subject,
    html: email.html,
    idempotencyKey: `staff-invite:${input.invitationRef}:${input.attempt}`,
  });
}

export async function dispatchStaffInvitation(
  client: SupabaseClient<Database>,
  input: {
    contact: string;
    expiresAt: string;
    displayName: string;
    title?: string;
    profileCode: string;
    reason: string;
  },
): Promise<ServiceResult<{ invitationRef: string; status: "pending"; expiresAt: string }>> {
  const record = await staffInvitesCreateProfileRecord(client, input);
  if (!record.ok) return record as ServiceResult<{ invitationRef: string; status: "pending"; expiresAt: string }>;
  const invitationRef = String(record.value.invitationRef ?? "");
  const provider = authProvider();
  let invited: { userId: string; actionLink: string };
  try {
    const { appUrl } = requireAppEnv();
    const invitationPath = `/sign-in/invite?invitation=${encodeURIComponent(invitationRef)}`;
    invited = await provider.createInviteLink({
      email: input.contact.trim().toLowerCase(),
      redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(invitationPath)}`,
      mode: "invite",
    });
  } catch (error) {
    await staffInvitesMarkProviderFailed(client, { invitationReference: invitationRef, reason: "Auth invite provider failed." });
    return inviteProviderFailure(error) as ServiceResult<{ invitationRef: string; status: "pending"; expiresAt: string }>;
  }
  try {
    await sendStaffInvitation({
      contact: input.contact,
      invitationRef,
      actionLink: invited.actionLink,
      expiresAt: input.expiresAt,
      displayName: input.displayName,
      attempt: 1,
    });
  } catch {
    try { await provider.deleteUser(invited.userId); } catch { /* best effort compensation */ }
    await staffInvitesMarkProviderFailed(client, { invitationReference: invitationRef, reason: "Email delivery failed" });
    return safeFailure("The invitation email could not be delivered. No staff access was created.", true);
  }
  const attached = await staffInvitesAttachProvider(client, {
    invitationReference: invitationRef,
    providerSubject: invited.userId,
  });
  if (!attached.ok) {
    try { await provider.deleteUser(invited.userId); } catch { /* best effort compensation */ }
    await staffInvitesMarkProviderFailed(client, { invitationReference: invitationRef, reason: "Invitation could not be bound to the Auth account." });
    return safeFailure("The invitation could not be completed. No staff access was created.", true);
  }
  return { ok: true, value: { invitationRef, status: "pending", expiresAt: input.expiresAt } };
}

export async function resendStaffInvitation(
  client: SupabaseClient<Database>,
  input: { invitationReference: string; reason: string },
): Promise<ServiceResult<{ invitationRef: string; resendCount: number; expiresAt: string }>> {
  const admin = createSupabaseAdminClient();
  const { data: invitation, error } = await admin
    .from("account_invitations")
    .select("contact, provider_subject, expires_at, resend_count, intended_display_name, account_id")
    .eq("reference", input.invitationReference)
    .eq("purpose", "staff")
    .in("status", ["pending", "expired"])
    .is("account_id", null)
    .maybeSingle();
  if (error !== null || invitation === null) {
    return safeFailure("This pending staff invitation could not be found.");
  }
  const provider = authProvider();
  const { appUrl } = requireAppEnv();
  const invitationPath = `/sign-in/invite?invitation=${encodeURIComponent(input.invitationReference)}`;
  let invited: { userId: string; actionLink: string };
  try {
    invited = await provider.createInviteLink({
      email: invitation.contact,
      redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(invitationPath)}`,
      mode: invitation.provider_subject ? "reinvite" : "invite",
    });
  } catch (providerError) {
    return inviteProviderFailure(providerError) as ServiceResult<{ invitationRef: string; resendCount: number; expiresAt: string }>;
  }
  const expiresAt = new Date(Math.max(
    new Date(invitation.expires_at).getTime(),
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  )).toISOString();
  try {
    await sendStaffInvitation({
      contact: invitation.contact,
      invitationRef: input.invitationReference,
      actionLink: invited.actionLink,
      expiresAt,
      displayName: invitation.intended_display_name ?? "Staff member",
      attempt: invitation.resend_count + 2,
    });
  } catch {
    return safeFailure("The invitation email could not be delivered. Try again.", true);
  }
  return staffInvitesMarkResent(client, {
    invitationReference: input.invitationReference,
    providerSubject: invited.userId,
  });
}

export async function revokeStaffInvitation(
  client: SupabaseClient<Database>,
  input: { invitationReference: string; reason: string },
): Promise<ServiceResult<{ invitationRef: string; providerSubject: string | null; status: "revoked" }>> {
  const revoked = await staffInvitesRevoke(client, input);
  if (!revoked.ok) return revoked;
  if (revoked.value.providerSubject !== null) {
    try { await authProvider().deleteUser(revoked.value.providerSubject); } catch { /* best effort provider cleanup */ }
  }
  return revoked;
}

export async function acceptStaffInvitation(
  client: SupabaseClient<Database>,
  input: { invitationReference: string; givenName: string; familyName: string },
) {
  return staffInvitesAcceptAuth(client, input);
}

/** Generic recovery lookup. The route deliberately returns the same response
 * for known and unknown contacts; only the server provider sees the match. */
export async function requestRecovery(input: { identifier: string }): Promise<ServiceResult<{ accepted: true }>> {
  const identifier = input.identifier.trim();
  if (!identifier) return safeFailure("Enter the email or phone on the account.");
  const admin = createSupabaseAdminClient();
  const normalize = (value: string) => value.includes("@") ? value.trim().toLowerCase() : value.replace(/[^0-9+]/g, "");
  const wanted = normalize(identifier);
  const { data: match, error } = await admin
    .from("user_accounts")
    .select("id, verified_contact, status")
    .eq("verified_contact", wanted)
    .in("status", ["active", "invited"])
    .maybeSingle();
  if (error !== null) return safeFailure("Recovery is temporarily unavailable.", true);
  if (match?.verified_contact !== null && match?.verified_contact !== undefined) {
    try {
      const { appUrl } = requireAppEnv();
      await authProvider().sendRecovery({ email: match.verified_contact, redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent("/sign-in/reset-password")}` });
      await callAppRpc(admin, "accounts_record_recovery_request", { p_account_id: match.id });
    } catch {
      /* Keep the public response generic even when a provider is unavailable. */
    }
  }
  return { ok: true, value: { accepted: true } };
}
