import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { safeAuthRedirect } from "@/lib/auth/redirect";
import { requireAppEnv } from "@/lib/supabase/env";
import { recordAuthEvent } from "@/lib/supabase/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Auth callback (plan.md §4): exchanges the OTP/magic-link code for a
 * session and redirects to a SAFE same-origin path. Never redirect to an
 * arbitrary `next` value — scheme-relative or foreign targets are dropped.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const { appUrl } = requireAppEnv();
  const code = searchParams.get("code");
  const next = safeAuthRedirect(searchParams.get("next"), "/portal");

  if (code !== null) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error === null) {
      await recordAuthEvent(supabase, "signed_in");
      return NextResponse.redirect(new URL(next, appUrl));
    }
  }

  const complete = new URL("/auth/complete", appUrl);
  complete.searchParams.set("next", next);
  if (code !== null) complete.searchParams.set("error", "exchange");
  return NextResponse.redirect(complete);
}
