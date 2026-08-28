import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAppEnv } from "@/lib/supabase/env";
import {
  applicantRegister,
  staffInvitesAcceptAuth,
  staffInvitesAttachProvider,
  staffInvitesCreateRecord,
  staffInvitesMarkProviderFailed,
} from "@/lib/supabase/domain";
import { authProvider } from "@/lib/auth/provider";
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

/** Allow same-origin browser requests while keeping non-browser/test clients
 * usable when they omit Origin entirely. */
export function isSameOrigin(requestUrl: string, originHeader: string | null): boolean {
  if (originHeader === null || originHeader.trim() === "") return true;
  try {
    return new URL(originHeader).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
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
}): Promise<ServiceResult<{ accountId: string; applicantIdentityRef: string; verificationRequired: true }>> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@") || !input.givenName.trim() || !input.familyName.trim()) {
    return safeFailure("Enter a valid email and both names.");
  }
  const provider = authProvider();
  let created: { userId: string; email: string; verificationRequired: true; providerRef?: string };
  try {
    const { appUrl } = requireAppEnv();
    created = await provider.createApplicantUser({
      email,
      redirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent("/apply/student")}`,
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

/**
 * Dispatch a staff invitation through Supabase Auth. The DB invitation is
 * created first, then bound to the provider subject. No manual token crosses
 * the adapter boundary or is rendered in the UI.
 */
export async function dispatchStaffInvitation(
  client: SupabaseClient<Database>,
  input: {
    contact: string;
    expiresAt: string;
    displayName: string;
    roleCode: string;
    reason: string;
    academicYearIds?: string[];
    gradeSectionIds?: string[];
    subjectIds?: string[];
  },
): Promise<ServiceResult<{ invitationRef: string; status: "pending"; expiresAt: string }>> {
  const record = await staffInvitesCreateRecord(client, input);
  if (!record.ok) return record as ServiceResult<{ invitationRef: string; status: "pending"; expiresAt: string }>;
  const invitationRef = String(record.value.invitationRef ?? "");
  const provider = authProvider();
  let invited: { userId: string; email: string; providerRef?: string };
  try {
    const { appUrl } = requireAppEnv();
    invited = await provider.inviteUser({
      email: input.contact.trim().toLowerCase(),
      redirectTo: `${appUrl}/sign-in/invite?invitation=${encodeURIComponent(invitationRef)}`,
    });
  } catch {
    await staffInvitesMarkProviderFailed(client, { invitationReference: invitationRef, reason: "Auth invite provider failed." });
    return safeFailure("The invitation could not be sent. No staff access was created.", true);
  }
  const attached = await staffInvitesAttachProvider(client, {
    invitationReference: invitationRef,
    providerSubject: invited.userId,
    providerInvitationRef: invited.providerRef,
  });
  if (!attached.ok) {
    try { await provider.deleteUser(invited.userId); } catch { /* best effort compensation */ }
    await staffInvitesMarkProviderFailed(client, { invitationReference: invitationRef, reason: "Invitation could not be bound to the Auth account." });
    return safeFailure("The invitation could not be completed. No staff access was created.", true);
  }
  return { ok: true, value: { invitationRef, status: "pending", expiresAt: input.expiresAt } };
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
  const { data, error } = await admin.from("user_accounts").select("verified_contact, status");
  if (error !== null) return safeFailure("Recovery is temporarily unavailable.", true);
  const normalize = (value: string) => value.includes("@") ? value.trim().toLowerCase() : value.replace(/[^0-9+]/g, "");
  const wanted = normalize(identifier);
  const match = (data ?? []).find((row) => typeof row.verified_contact === "string" && normalize(row.verified_contact) === wanted && (row.status === "active" || row.status === "invited"));
  if (match?.verified_contact !== null && match?.verified_contact !== undefined) {
    try {
      const { appUrl } = requireAppEnv();
      await authProvider().sendRecovery({ email: match.verified_contact, redirectTo: `${appUrl}/auth/callback?next=/portal/security` });
    } catch {
      /* Keep the public response generic even when a provider is unavailable. */
    }
  }
  return { ok: true, value: { accepted: true } };
}
