import type { Metadata } from "next";

import { AuthFrame } from "@/components/identity/AuthFrame";
import StaffInvitationForm from "@/components/identity/StaffInvitationForm";
import { dataAdapter } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Accept staff invitation",
  description: "Accept a Faiz Aam staff invitation and finish account setup.",
};

export default async function StaffInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string | string[] }>;
}) {
  const params = await searchParams;
  const invitation = Array.isArray(params.invitation) ? params.invitation[0] : params.invitation;
  const supabaseMode = dataAdapter() === "supabase";
  return (
    <AuthFrame
      wide
      title="Accept your invitation"
      sub={supabaseMode ? "Open this page from the invitation email, confirm your name, and set the password used for staff sign in." : "Use the private references from the school office to create your staff workspace access."}
    >
      <StaffInvitationForm initialInvitationRef={invitation ?? ""} />
    </AuthFrame>
  );
}
