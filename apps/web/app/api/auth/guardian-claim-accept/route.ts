import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { acceptGuardianActivation, consumeAuthRateLimit, isSameOrigin } from "@/lib/auth/identity-server";
import { readJsonBounded, SMALL_JSON_MAX_BYTES } from "@/lib/http/request-body";
import { dataAdapter } from "@/lib/supabase/env";
import { scheduleOutboxKick } from "@/lib/supabase/outbox-kick";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { statusForServiceResult, withCorrelation } from "@/app/api/adapter/registry";

export async function POST(request: NextRequest) {
  const correlationRef = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Correlation-Id": correlationRef };
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }], correlationRef }, { status: 403, headers });
  }
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ ok: false, errors: [{ code: "unavailable", message: "The Supabase adapter is not active.", field: null }], correlationRef }, { status: 503, headers });
  }
  const read = await readJsonBounded(request, SMALL_JSON_MAX_BYTES);
  if (!read.ok || typeof read.value !== "object" || read.value === null) {
    const status = !read.ok && read.reason === "too_large" ? 413 : 400;
    return NextResponse.json({ ok: false, errors: [{ code: "validation", message: "Invalid guardian activation payload.", field: null }], correlationRef }, { status, headers });
  }
  const payload = read.value as { token?: unknown; givenName?: unknown; familyName?: unknown };
  if (typeof payload.token !== "string" || payload.token.length < 16 || typeof payload.givenName !== "string" || typeof payload.familyName !== "string") {
    return NextResponse.json({ ok: false, errors: [{ code: "validation", message: "Activation token and names are required.", field: null }], correlationRef }, { status: 400, headers });
  }
  try {
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
    const limit = await consumeAuthRateLimit({ subject: `${address}:${payload.token}`, action: "auth.guardian_claim_accept", limit: 10, windowSeconds: 900 });
    if (!limit.allowed) {
      return NextResponse.json({ ok: false, errors: [{ code: "rate_limited", message: "Too many activation attempts. Wait before trying again.", field: null, retryable: true }], correlationRef }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfterSeconds) } });
    }
  } catch {
    return NextResponse.json({ ok: false, errors: [{ code: "retryable", message: "Portal activation is temporarily unavailable. Try again shortly.", field: null, retryable: true }], correlationRef }, { status: 503, headers });
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) {
    return NextResponse.json({ ok: false, errors: [{ code: "unauthenticated", message: "Open the activation link from the school email before continuing.", field: null }], correlationRef }, { status: 401, headers });
  }
  const result = withCorrelation(await acceptGuardianActivation(supabase, {
    token: payload.token,
    givenName: payload.givenName,
    familyName: payload.familyName,
  }), correlationRef);
  if (result.ok) scheduleOutboxKick("auth.guardian_claim_accept");
  return NextResponse.json(result, { status: statusForServiceResult(result), headers });
}
