import type { Metadata } from "next";
import Link from "next/link";

import { AuthFrame } from "@/components/identity/AuthFrame";
import Button from "@/components/ui/Button";
import GuardianActivationForm from "@/components/identity/GuardianActivationForm";
import { previewGuardianActivation } from "@/lib/auth/identity-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dataAdapter, demoPasswordSignInEnabled } from "@/lib/supabase/env";
import {
  demoGuardianActivationPreview,
  type GuardianActivationPreview,
} from "@/modules/services/guardians";

export const metadata: Metadata = {
  title: "Activate family portal access",
  description: "Activate verified guardian access to the Faiz E Aam School family portal.",
};

export default async function GuardianActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.claim) ? params.claim[0] : params.claim;
  const supabaseMode = dataAdapter() === "supabase";
  let hasSession = !supabaseMode;
  let client = null;
  if (supabaseMode) {
    client = await createSupabaseServerClient();
    const { data, error } = await client.auth.getUser();
    hasSession = error === null && data.user !== null;
  }

  if (!hasSession) {
    return (
      <AuthFrame
        title="Open your activation email"
        sub="This page works after the secure link in the school activation email starts a sign-in session."
      >
        <h2>Activation email required</h2>
        <p>If the link has expired, ask the school office to send a new one.</p>
        <Link className="underline-link" href="/sign-in">Back to sign in</Link>
      </AuthFrame>
    );
  }

  let preview: GuardianActivationPreview;
  if (!token || token.length < 16) {
    preview = { valid: false, reason: "claim not found" };
  } else if (supabaseMode && client !== null) {
    const result = await previewGuardianActivation(client, { token });
    preview = result.ok ? result.value as GuardianActivationPreview : { valid: false, reason: "claim not found" };
  } else {
    preview = demoGuardianActivationPreview(token);
  }

  if (!preview.valid) {
    const used = preview.reason === "claim has already been used";
    return (
      <AuthFrame
        title={used ? "Portal access is already active" : "Activation link unavailable"}
        sub={used
          ? "This activation link was already used. Sign in instead."
          : "This activation link is no longer valid. Ask the school office to send a new one."}
      >
        {used ? <Button href="/sign-in" variant="primary">Sign in</Button> : null}
        <Link className="underline-link" href="/sign-in">Back to sign in</Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      wide
      title="Activate family portal access"
      sub="Confirm your name and review the students the school linked to this account."
    >
      <GuardianActivationForm
        token={token!}
        preview={preview as GuardianActivationPreview & { valid: true }}
        passwordMode={demoPasswordSignInEnabled()}
      />
    </AuthFrame>
  );
}
