import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { consumeAuthRateLimit, isSameOrigin, requestRecovery } from "@/lib/auth/identity-server";
import { dataAdapter } from "@/lib/supabase/env";
import { statusForServiceResult, withCorrelation } from "@/app/api/adapter/registry";

export async function POST(request: NextRequest) {
  const correlationRef = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Correlation-Id": correlationRef };
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }], correlationRef }, { status: 403, headers });
  }
  /* The message and HTTP status remain identical for a known or unknown
   * contact. The demo adapter keeps its explicit local behavior separate. */
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ ok: true, value: { accepted: true }, correlationRef }, { status: 202, headers });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, errors: [{ code: "validation", message: "Enter the email or phone on the account.", field: "identifier" }], correlationRef }, { status: 400, headers });
  }
  const identifier = typeof body === "object" && body !== null && typeof (body as { identifier?: unknown }).identifier === "string"
    ? (body as { identifier: string }).identifier
    : "";
  try {
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
    const normalized = identifier.includes("@") ? identifier.trim().toLowerCase() : identifier.replace(/[^0-9+]/g, "");
    const [ipLimit, contactLimit] = await Promise.all([
      consumeAuthRateLimit({ subject: address, action: "auth.recovery.ip", limit: 10, windowSeconds: 900 }),
      consumeAuthRateLimit({ subject: normalized || "empty", action: "auth.recovery.contact", limit: 3, windowSeconds: 3600 }),
    ]);
    if (!ipLimit.allowed || !contactLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, contactLimit.retryAfterSeconds);
      return NextResponse.json({ ok: false, errors: [{ code: "rate_limited", message: "Too many recovery requests. Wait before trying again.", field: null, retryable: true }], correlationRef }, { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } });
    }
  } catch {
    return NextResponse.json({ ok: false, errors: [{ code: "retryable", message: "Recovery is temporarily unavailable. Try again shortly.", field: null, retryable: true }], correlationRef }, { status: 503, headers });
  }
  const result = withCorrelation(await requestRecovery({ identifier }), correlationRef);
  return NextResponse.json(result, { status: result.ok ? 202 : statusForServiceResult(result), headers });
}
