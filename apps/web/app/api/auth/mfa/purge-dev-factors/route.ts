import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { isSameOrigin } from "@/lib/auth/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dataAdapter, totpRequired, requireSupabasePublicEnv, requireSupabaseSecretEnv } from "@/lib/supabase/env";

/**
 * Removes this account's "Dev auto-elevation" TOTP factors so the sign-in
 * flow can fall through to real "Staff access" enrolment. The dev factors are
 * disposable — their secret is never shown — but Supabase treats them as
 * verified factors, so they must be deleted server-side before a real factor
 * is challenged. Only effective when `totpRequired()` is true; in dev mode
 * (auto-elevation active) it is a no-op.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }] },
      { status: 403 },
    );
  }
  if (dataAdapter() !== "supabase") {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unavailable", message: "MFA maintenance is unavailable in demo mode.", field: null }] },
      { status: 503 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError !== null || claimsData === null) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unauthenticated", message: "Sign in to continue.", field: null }] },
      { status: 401 },
    );
  }

  // Nothing to purge while dev auto-elevation is active — dev factors are
  // managed by /api/auth/mfa/dev-elevate on each sign-in.
  if (!totpRequired()) {
    return NextResponse.json({ ok: true, removed: 0 }, { headers: { "Cache-Control": "no-store" } });
  }

  const userId = claimsData.claims.sub;
  if (typeof userId !== "string" || userId.length === 0) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unauthenticated", message: "Sign in to continue.", field: null }] },
      { status: 401 },
    );
  }

  const { url } = requireSupabasePublicEnv();
  const { secretKey } = requireSupabaseSecretEnv();
  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // _listFactors/_deleteFactor are internal GoTrue admin methods — required
  // because the user-scoped client cannot unenroll verified factors at AAL1.
  const adminAuth = admin.auth.admin as unknown as {
    _listFactors: (params: { userId: string }) => Promise<{ data: { factors: Array<{ id: string; friendly_name?: string }> } | null }>;
    _deleteFactor: (params: { userId: string; id: string }) => Promise<{ error: unknown | null }>;
  };
  const { data: adminFactors } = await adminAuth._listFactors({ userId });
  const devFactors = (adminFactors?.factors ?? []).filter(
    (factor) => factor.friendly_name === "Dev auto-elevation",
  );
  let removed = 0;
  for (const factor of devFactors) {
    const { error } = await adminAuth._deleteFactor({ userId, id: factor.id });
    if (error === null) removed += 1;
  }

  return NextResponse.json({ ok: true, removed }, { headers: { "Cache-Control": "no-store" } });
}
