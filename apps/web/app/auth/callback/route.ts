import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Auth callback (plan.md §4): exchanges the OTP/magic-link code for a
 * session and redirects to a SAFE same-origin path. Never redirect to an
 * arbitrary `next` value — scheme-relative or foreign targets are dropped.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requested = searchParams.get("next") ?? "/portal";

  if (code !== null) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error === null) {
      const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/portal";
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth`);
}
