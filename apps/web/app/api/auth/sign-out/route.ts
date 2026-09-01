import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isSameOrigin } from "@/lib/auth/identity-server";
import { dataAdapter } from "@/lib/supabase/env";
import { recordAuthEvent } from "@/lib/supabase/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }] }, { status: 403, headers });
  }
  if (dataAdapter() !== "supabase") return new NextResponse(null, { status: 204, headers });
  const body = await request.json().catch(() => null) as { scope?: unknown } | null;
  const scope = body?.scope === "global" || body?.scope === "others" ? body.scope : "local";
  const supabase = await createSupabaseServerClient();
  await recordAuthEvent(supabase, "signed_out");
  const { error } = await supabase.auth.signOut({ scope });
  if (error !== null) {
    return NextResponse.json({ ok: false, errors: [{ code: "retryable", message: "Sign out could not be completed. Try again.", field: null }] }, { status: 503, headers });
  }
  return new NextResponse(null, { status: 204, headers });
}
