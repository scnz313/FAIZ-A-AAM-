import type { Metadata } from "next";
import Link from "next/link";

import { AuthFrame } from "@/components/identity/AuthFrame";
import RecoveryForm from "@/components/identity/RecoveryForm";
import { dataAdapter } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Account recovery",
  description: "Request secure account recovery instructions using the verified contact on a Faiz E Aam account.",
  robots: { index: false, follow: false },
};

/**
 * Account recovery — the first step of the forgot-password flow.
 * Uses the V14 AuthFrame with brand-only header and centered card.
 */
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const adapter = dataAdapter();
  const params = await searchParams;
  const expired = params.error === "expired";
  return (
    <AuthFrame
      title="Recover access"
      sub="We will send a recovery link if the account exists."
      foot={
        <Link className="underline-link" href="/sign-in">Back to sign-in</Link>
      }
    >
      {expired ? (
        <p className="alert-strip alert-strip--warning" role="alert" style={{ marginBottom: 16 }}>
          That recovery link has expired or was already used. Request a fresh email below.
        </p>
      ) : null}
      <RecoveryForm adapter={adapter} />
      {adapter === "supabase" ? (
        <p className="tiny muted" style={{ textAlign: "center", marginTop: 12 }}>
          Recovery messages are sent through the Auth email provider; account existence is never disclosed.
        </p>
      ) : (
        <p className="tiny muted" style={{ textAlign: "center", marginTop: 12 }}>
          <span className="demo-badge">UI demo</span> Recovery is a local demo — the reference and code are shown on screen.
        </p>
      )}
    </AuthFrame>
  );
}
