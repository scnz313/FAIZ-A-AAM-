import type { Metadata } from "next";
import Link from "next/link";

import { AuthFrame } from "@/components/identity/AuthFrame";
import SignInForm from "@/components/identity/SignInForm";
import { dataAdapter, developmentAuthEnabled, totpRequired } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Staff sign in",
  description: "Staff sign in with an invited school account and two-step verification.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function StaffSignInPage() {
  const adapter = dataAdapter();
  const active = adapter === "supabase";
  const quickSignIn = developmentAuthEnabled();
  const mfaRequired = totpRequired();
  return (
    <AuthFrame
      wide
      title="Staff sign-in"
      sub="Work accounts use two-step verification. Your administrator issues invitations; there are no walk-in accounts."
      foot={
        <Link className="underline-link small" href="/sign-in">Back to guardian &amp; applicant sign-in</Link>
      }
    >
      <p className={`alert-strip ${active ? "alert-strip--notice" : "alert-strip--warning"}`} style={{ marginBottom: 16 }}>
        {active
          ? "Staff access uses an invited account, password, and authenticator verification."
          : "UI demo — use the staff workspace identity picker; no real staff session is created."}
      </p>
      {active ? (
        <>
          <SignInForm
            adapter={adapter}
            audience="staff"
            totpRequired={mfaRequired}
            developmentPasswordAuth={quickSignIn}
          />
        </>
      ) : (
        <div>
          <p className="demo-note">Staff authentication is available when the Supabase adapter is enabled.</p>
          <Link className="btn btn-primary" href="/administrator" prefetch={false}>Open the Administrator portal</Link>
        </div>
      )}
    </AuthFrame>
  );
}
