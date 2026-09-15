import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The application owns this small boundary instead of letting route handlers
 * call Supabase Auth administration directly. Production uses the server-only
 * secret-key client; tests can inject a deterministic fake without network or
 * provider credentials. This module is never imported by browser components.
 */
export type AuthProvider = {
  /** Creates/sends the provider verification invitation; email ownership is
   * not considered proven until the recipient follows that invitation. */
  createApplicantUser(input: { email: string; redirectTo: string; givenName?: string; familyName?: string }): Promise<{ userId: string; email: string; verificationRequired: true; providerRef?: string }>;
  inviteUser(input: { email: string; redirectTo: string }): Promise<{ userId: string; email: string; providerRef?: string }>;
  createInviteLink(input: { email: string; redirectTo: string; mode: "invite" | "reinvite" }): Promise<{ userId: string; actionLink: string }>;
  sendRecovery(input: { email: string; redirectTo: string }): Promise<void>;
  deleteUser(userId: string): Promise<void>;
};

export type AuthProviderErrorCode = "email_exists" | "rate_limited" | "invalid_email" | "unavailable";

export class AuthProviderError extends Error {
  constructor(
    readonly code: AuthProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthProviderError";
  }
}

type ProviderUser = { id: string; email?: string | null };
type SupabaseAuthError = { code?: string; status?: number; message?: string };

function mapInviteLinkError(error: SupabaseAuthError): AuthProviderError {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message?.toLowerCase() ?? "";
  if (code === "email_exists" || error.status === 422) {
    return new AuthProviderError("email_exists", "This email already has a sign-in account.");
  }
  if (error.status === 429 || code.includes("rate_limit")) {
    return new AuthProviderError("rate_limited", "The sign-in provider is rate limiting invitations.");
  }
  if (error.status === 400 || code.includes("invalid") || message.includes("invalid email")) {
    return new AuthProviderError("invalid_email", "Enter a valid email address.");
  }
  return new AuthProviderError("unavailable", "The sign-in provider is unavailable.");
}

function requireUser(user: ProviderUser | null, fallback: string): { userId: string; email: string } {
  if (user === null || typeof user.id !== "string" || user.id.length === 0) {
    throw new Error(fallback);
  }
  return { userId: user.id, email: user.email?.trim().toLowerCase() ?? "" };
}

function createSupabaseAuthProvider(): AuthProvider {
  return {
    async createApplicantUser({ email, redirectTo }) {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
      });
      if (error !== null) throw new Error("The verification invitation could not be sent.");
      return { ...requireUser(data.user, "The account provider did not return an invitation user."), verificationRequired: true as const, providerRef: data.user?.id };
    },

    async inviteUser({ email, redirectTo }) {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
      });
      if (error !== null) throw new Error("The invitation could not be sent.");
      return { ...requireUser(data.user, "The account provider did not return an invitation user."), providerRef: data.user?.id };
    },

    async createInviteLink({ email, redirectTo, mode }) {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.auth.admin.generateLink({
        type: mode === "invite" ? "invite" : "magiclink",
        email,
        options: { redirectTo },
      });
      if (error !== null) throw mapInviteLinkError(error);
      const user = requireUser(data.user, "The account provider did not return an invitation user.");
      const actionLink = data.properties?.action_link;
      if (typeof actionLink !== "string" || actionLink.length === 0) {
        throw new AuthProviderError("unavailable", "The sign-in provider did not return an invitation link.");
      }
      return { userId: user.userId, actionLink };
    },

    async sendRecovery({ email, redirectTo }) {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      if (error !== null) throw new Error("The recovery message could not be sent.");
    },

    async deleteUser(userId) {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error !== null) throw new Error("The provider account could not be rolled back.");
    },
  };
}

/** Deterministic provider for local contract/component tests. */
export class FakeAuthProvider implements AuthProvider {
  readonly users = new Map<string, { userId: string; email: string }>();
  readonly applicantInvites = new Map<string, { userId: string; email: string; verificationRequired: true; providerRef?: string }>();
  readonly invited = new Map<string, { userId: string; email: string; providerRef?: string }>();
  readonly recoveryEmails: string[] = [];
  readonly deletedUserIds: string[] = [];
  private sequence = 1;

  private nextId(): string {
    const suffix = String(this.sequence++).padStart(12, "0");
    return `f0000000-0000-4000-8000-${suffix}`;
  }

  async createApplicantUser({ email }: { email: string; redirectTo: string; givenName?: string; familyName?: string }) {
    const normalized = email.trim().toLowerCase();
    const existing = this.applicantInvites.get(normalized);
    if (existing !== undefined) return existing;
    const user = { userId: this.nextId(), email: normalized, verificationRequired: true as const, providerRef: `fake-applicant-${this.sequence}` };
    this.applicantInvites.set(normalized, user);
    return user;
  }

  async inviteUser({ email }: { email: string; redirectTo: string }) {
    const normalized = email.trim().toLowerCase();
    const existing = this.invited.get(normalized);
    if (existing !== undefined) return existing;
    const user = { userId: this.nextId(), email: normalized, providerRef: `fake-invite-${this.sequence}` };
    this.invited.set(normalized, user);
    return user;
  }

  async createInviteLink({ email, redirectTo }: { email: string; redirectTo: string; mode: "invite" | "reinvite" }) {
    const invited = await this.inviteUser({ email, redirectTo });
    return { userId: invited.userId, actionLink: redirectTo };
  }

  async sendRecovery({ email }: { email: string; redirectTo: string }) {
    this.recoveryEmails.push(email.trim().toLowerCase());
  }

  async deleteUser(userId: string) {
    this.deletedUserIds.push(userId);
    for (const [email, user] of this.users.entries()) if (user.userId === userId) this.users.delete(email);
    for (const [email, user] of this.applicantInvites.entries()) if (user.userId === userId) this.applicantInvites.delete(email);
    for (const [email, user] of this.invited.entries()) if (user.userId === userId) this.invited.delete(email);
  }
}

let injectedProvider: AuthProvider | null = null;

/** Test-only injection hook; production callers should use the default. */
export function setAuthProviderForTests(provider: AuthProvider | null): void {
  injectedProvider = provider;
}

export function authProvider(): AuthProvider {
  return injectedProvider ?? createSupabaseAuthProvider();
}
