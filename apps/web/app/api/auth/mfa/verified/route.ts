import { NextResponse } from "next/server";

import { getServerActor } from "@/lib/auth/actor";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dataAdapter } from "@/lib/supabase/env";
import { markMfaVerified } from "@/lib/supabase/domain";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }] }, { status: 403 });
  }
  if (dataAdapter() !== "supabase") return NextResponse.json({ ok: false, errors: [{ code: "unavailable", message: "MFA recording is unavailable in demo mode.", field: null }] }, { status: 503 });
  const actor = await getServerActor();
  if (actor === null) return NextResponse.json({ ok: false, errors: [{ code: "unauthenticated", message: "Sign in to continue.", field: null }] }, { status: 401 });
  if (actor.aal !== "aal2") return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Complete two-step verification first.", field: null }] }, { status: 403 });
  const result = await markMfaVerified(await createSupabaseServerClient());
  return NextResponse.json(result, { status: result.ok ? 200 : 403, headers: { "Cache-Control": "no-store" } });
}
