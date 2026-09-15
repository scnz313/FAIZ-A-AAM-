import type { Metadata } from "next";

import AuthCompleteHandler from "@/components/identity/AuthCompleteHandler";
import { AuthFrame } from "@/components/identity/AuthFrame";

export const metadata: Metadata = {
  title: "Completing your sign-in",
  description: "Complete a secure Faiz E Aam School sign-in link.",
};

export default async function AuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  return (
    <AuthFrame
      title="Completing your sign-in"
      sub="Please wait while the school verifies this secure link and opens the correct account page."
      foot={<span>Invitation and recovery links are single-use.</span>}
    >
      <AuthCompleteHandler next={next ?? null} exchangeError={error === "exchange"} />
    </AuthFrame>
  );
}
