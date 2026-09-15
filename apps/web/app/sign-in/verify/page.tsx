import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/components/identity/AuthFrame";
import VerifyForm from "@/components/identity/VerifyForm";
import { dataAdapter } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Verify sign-in",
  description:
    "Enter the 6-digit verification code to finish signing in to the Faiz Aam family portal. UI demo — the code is shown on screen.",
};

/**
 * Sign-in verification step — the code screen after a successful sign-in.
 * Uses the V14 AuthFrame with brand-only header and centered card.
 */
export default function VerifyPage() {
  if (dataAdapter() === "supabase") redirect("/sign-in");
  return (
    <AuthFrame
      title="Verify it's you"
      sub="We sent a 6-digit code by SMS to the phone ending 34. It expires in ten minutes."
    >
      <VerifyForm />
      <p className="tiny muted" style={{ textAlign: "center", marginTop: 14 }}>
        Prototype: enter any six digits. The demo code is shown above.
      </p>
    </AuthFrame>
  );
}
