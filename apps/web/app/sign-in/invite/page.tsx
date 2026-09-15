import type { Metadata } from "next";
import Link from "next/link";

import { AuthFrame } from "@/components/identity/AuthFrame";
import StaffInvitationForm from "@/components/identity/StaffInvitationForm";
import { dataAdapter } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Accept staff invitation",
  description: "Accept a Faiz E Aam staff invitation and finish account setup.",
};

export default async function StaffInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string | string[] }>;
}) {
  const params = await searchParams;
  const invitation = Array.isArray(params.invitation) ? params.invitation[0] : params.invitation;
  const supabaseMode = dataAdapter() === "supabase";
  let hasSession = !supabaseMode;
  if (supabaseMode) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    hasSession = error === null && data.user !== null;
  }
  if (!hasSession) {
    return (
      <AuthFrame
        title="Open your invitation email"
        sub="This page only works after the secure link in your invitation email starts a sign-in session."
      >
        <h2>Invitation required</h2>
        {invitation ? <p className="ref">Invitation reference: {invitation}</p> : null}
        <p>If the link has expired, ask the administrator to resend it.</p>
        <Link className="underline-link" href="/sign-in">Back to sign in</Link>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame
      wide
      title="Accept your invitation"
      sub={supabaseMode ? "Confirm your name and set the password used for staff sign in." : "Use the private references from the school office to create your staff workspace access."}
    >
      <StaffInvitationForm initialInvitationRef={invitation ?? ""} invitationRefReadOnly={supabaseMode && invitation !== undefined} />
    </AuthFrame>
  );
}
