import { NextResponse } from "next/server";

import { isSameOrigin } from "@/lib/auth/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dataAdapter } from "@/lib/supabase/env";
import { markMfaVerified, recordAuthEvent } from "@/lib/supabase/domain";
import { scheduleOutboxKick } from "@/lib/supabase/outbox-kick";

export async function POST(request: Request) {
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }] }, { status: 403 });
  }
  if (dataAdapter() !== "supabase") return NextResponse.json({ ok: false, errors: [{ code: "unavailable", message: "MFA recording is unavailable in demo mode.", field: null }] }, { status: 503 });
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError !== null || claimsData === null) return NextResponse.json({ ok: false, errors: [{ code: "unauthenticated", message: "Sign in to continue.", field: null }] }, { status: 401 });
  if (claimsData.claims.aal !== "aal2") return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Complete two-step verification first.", field: null }] }, { status: 403 });
  const result = await markMfaVerified(supabase);
  if (result.ok) {
    await recordAuthEvent(supabase, "signed_in");
    scheduleOutboxKick("auth.mfa_verified");
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 403, headers: { "Cache-Control": "no-store" } });
}
