import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/components/identity/AuthFrame";
import PasswordResetForm from "@/components/identity/PasswordResetForm";
import { getServerActor } from "@/lib/auth/actor";
import { dataAdapter } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password after opening a verified recovery email.",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage() {
  if (dataAdapter() !== "supabase") redirect("/sign-in/recovery");
  if ((await getServerActor()) === null) redirect("/sign-in/recovery?error=expired");
  return (
    <AuthFrame
      title="Set a new password"
      sub="Choose a strong password for staff access. The recovery session is closed after the change."
    >
      <PasswordResetForm />
    </AuthFrame>
  );
}
