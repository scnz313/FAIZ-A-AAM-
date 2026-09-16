import { createHmac } from "node:crypto";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { isSameOrigin } from "@/lib/auth/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dataAdapter, totpRequired, requireSupabasePublicEnv, requireSupabaseSecretEnv } from "@/lib/supabase/env";
import { markMfaVerified, recordAuthEvent } from "@/lib/supabase/domain";

/**
 * Dev-only TOTP auto-elevation (plan.md §4). When `FASS_TOTP_REQUIRED=false`
 * the staff sign-in flow calls this endpoint instead of showing the QR-code
 * enrollment screen. The endpoint programmatically enrolls a TOTP factor,
 * generates a valid six-digit code from the returned secret (RFC 6238), and
 * verifies it — producing a genuine `aal2` session so every DB RPC and RLS
 * policy that checks `app.is_staff_aal2()` works unchanged.
 *
 * This endpoint returns 403 in staging/production where `totpRequired()`
 * is true. It never weakens the security model: the session is really aal2.
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
      { ok: false, errors: [{ code: "unavailable", message: "MFA elevation is unavailable in demo mode.", field: null }] },
      { status: 503 },
    );
  }
  if (totpRequired()) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "forbidden", message: "Dev MFA elevation is disabled — TOTP is required.", field: null }] },
      { status: 403 },
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

  // Already elevated — just record the auth event.
  if (claimsData.claims.aal === "aal2") {
    const result = await markMfaVerified(supabase);
    if (result.ok) await recordAuthEvent(supabase, "signed_in");
    return NextResponse.json(result, {
      status: result.ok ? 200 : 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Remove only previous "Dev auto-elevation" factors via the admin API.
  // The user-scoped client cannot unenroll VERIFIED factors at AAL1 (Supabase
  // requires AAL2 for that), so we use the secret-key admin client to delete
  // them first. A real "Staff access" factor is never touched: the dev
  // factor must be replaced each sign-in because its secret is not
  // retrievable. Dev-only — the admin key never leaves the server.
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
  // _listFactors and _deleteFactor are internal GoTrue admin API methods
  // (underscore-prefixed in supabase-js) that bypass AAL requirements —
  // necessary because the user-scoped client cannot unenroll verified
  // factors at AAL1. Cast to access the private methods.
  const adminAuth = admin.auth.admin as unknown as {
    _listFactors: (params: { userId: string }) => Promise<{ data: { factors: Array<{ id: string; friendly_name?: string }> } | null }>;
    _deleteFactor: (params: { userId: string; id: string }) => Promise<{ error: unknown | null }>;
  };
  const { data: adminFactors } = await adminAuth._listFactors({ userId });
  const existingFactors = adminFactors?.factors ?? [];
  for (const factor of existingFactors) {
    if (factor.friendly_name !== "Dev auto-elevation") continue;
    await adminAuth._deleteFactor({ userId, id: factor.id });
  }

  // Enroll a fresh TOTP factor — the response includes the base32 secret.
  const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Dev auto-elevation",
  });
  if (enrollError !== null || enrolled === null) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unavailable", message: "Could not start dev MFA elevation.", field: null }] },
      { status: 502 },
    );
  }

  const secret = enrolled.totp?.secret;
  if (typeof secret !== "string" || secret.length === 0) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unavailable", message: "Dev MFA enrollment did not return a secret.", field: null }] },
      { status: 502 },
    );
  }

  // Challenge + verify with a programmatically generated RFC 6238 code.
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: enrolled.id,
  });
  if (challengeError !== null || challenge === null) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unavailable", message: "Could not create MFA challenge.", field: null }] },
      { status: 502 },
    );
  }

  const code = totpCode(secret);
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: enrolled.id,
    challengeId: challenge.id,
    code,
  });
  if (verifyError !== null) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unavailable", message: "Dev MFA verification failed.", field: null }] },
      { status: 502 },
    );
  }

  const result = await markMfaVerified(supabase);
  if (result.ok) await recordAuthEvent(supabase, "signed_in");
  return NextResponse.json(result, {
    status: result.ok ? 200 : 403,
    headers: { "Cache-Control": "no-store" },
  });
}

/** RFC 6238 TOTP code from a base32 secret (same logic as the integration
 *  staging script). Server-only — uses Node's node:crypto. */
function totpCode(secretB32: string, period = 30, digits = 6): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretB32.replace(/=+$/, "")) {
    const value = alphabet.indexOf(char.toUpperCase());
    if (value < 0) throw new Error(`invalid base32 char ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const secret = Buffer.from(
    bits.match(/.{1,8}/g)!.map((chunk) => parseInt(chunk.padEnd(8, "0"), 2)),
  );
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits)
    .toString()
    .padStart(digits, "0");
  return code;
}
