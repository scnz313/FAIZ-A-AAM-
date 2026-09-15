import type { Metadata } from "next";
import Link from "next/link";

import { AuthFrame } from "@/components/identity/AuthFrame";
import AuthHashHandler from "@/components/identity/AuthHashHandler";
import SignInForm from "@/components/identity/SignInForm";
import { dataAdapter, demoPasswordSignInEnabled, developmentAuthEnabled, totpRequired } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to the Faiz E Aam guardian portal. Guardian accounts, once verified by the school. Email OTP when the Supabase adapter is active; UI demo otherwise.",
};

/**
 * Family-portal sign-in. Uses the V14 AuthFrame — a minimal brand-only
 * header with a centered identity card. With the Supabase adapter active
 * the card runs the real email-OTP flow; in demo mode it keeps the honest
 * prototype flow (nothing is protected yet). `?error=auth` comes back from
 * the auth callback when an email link has expired or was already used.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const adapter = dataAdapter();
  const supabaseLive = adapter === "supabase";
  const quickSignIn = developmentAuthEnabled();
  const passwordAuth = quickSignIn || demoPasswordSignInEnabled();
  const mfaRequired = totpRequired();
  const authLinkExpired = params.error === "auth";
  const passwordReset = params.reset === "complete";
  const next = Array.isArray(params.next) ? params.next[0] : params.next;

  return (
    <AuthFrame
      title="Sign in"
      sub="Guardians, applicants and staff sign in here. New admission applicant? Create an account first."
      foot={<span>Use of this portal is logged for security. Account help: contact the office.</span>}
    >
      <AuthHashHandler next={next ?? null} />
      {supabaseLive ? (
        <p className={`alert-strip alert-strip--notice`} style={{ marginBottom: 16 }}>
          {passwordAuth
            ? "Password sign-in is live for this environment · account help: contact the school office."
            : "Email-OTP sign-in is live for this environment · codes are sent by the school."}
        </p>
      ) : (
        <p className={`alert-strip alert-strip--warning`} style={{ marginBottom: 16 }}>
          UI demo — authentication arrives with the backend. No data is protected.
        </p>
      )}
      {authLinkExpired ? (
        <p className={`alert-strip alert-strip--warning`} role="alert" style={{ marginBottom: 16 }}>
          That sign-in link has expired or was already used. Start again below — enter your email and request a
          fresh code. Your account is safe; nothing needs to be fixed first.
        </p>
      ) : null}
      {passwordReset ? (
        <p className={`alert-strip alert-strip--notice`} role="status" style={{ marginBottom: 16 }}>
          Your password has been updated and all sessions were closed. Staff can sign in with the new password.
        </p>
      ) : null}
      <SignInForm
        adapter={adapter}
        totpRequired={mfaRequired}
        developmentPasswordAuth={passwordAuth}
      />
      <hr className="rule" style={{ margin: "18px 0 14px" }} />
      <div className="row-between" style={{ flexWrap: "wrap", gap: 10 }}>
        <Link className="underline-link small" href="/register/applicant">Create applicant account</Link>
        <Link className="underline-link small" href="/sign-in/staff">Staff sign-in</Link>
      </div>
      {supabaseLive ? null : (
        <p className="tiny muted" style={{ textAlign: "center", marginTop: 12 }}>
          <span className="demo-badge">UI demo</span> This screen previews the sign-in flow — it is not real authentication.
        </p>
      )}
    </AuthFrame>
  );
}
