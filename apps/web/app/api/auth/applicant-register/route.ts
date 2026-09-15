import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { consumeAuthRateLimit, isSameOrigin, registerApplicant } from "@/lib/auth/identity-server";
import { readJsonBounded, SMALL_JSON_MAX_BYTES } from "@/lib/http/request-body";
import { dataAdapter } from "@/lib/supabase/env";
import { statusForServiceResult, withCorrelation } from "@/app/api/adapter/registry";

export async function POST(request: NextRequest) {
  const correlationRef = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Correlation-Id": correlationRef };
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }], correlationRef }, { status: 403, headers });
  }
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ ok: false, errors: [{ code: "unavailable", message: "Applicant registration is not active in the demo adapter.", field: null }], correlationRef }, { status: 503, headers });
  }
  const read = await readJsonBounded(request, SMALL_JSON_MAX_BYTES);
  if (!read.ok) {
    return read.reason === "too_large"
      ? NextResponse.json({ ok: false, errors: [{ code: "validation", message: "The registration request is too large to accept.", field: null }], correlationRef }, { status: 413, headers })
      : NextResponse.json({ ok: false, errors: [{ code: "validation", message: "Enter the requested registration details.", field: null }], correlationRef }, { status: 400, headers });
  }
  const value = read.value as { email?: unknown; givenName?: unknown; familyName?: unknown; purpose?: unknown; next?: unknown };
  if (typeof value?.email !== "string" || typeof value.givenName !== "string" || typeof value.familyName !== "string") {
    return NextResponse.json({ ok: false, errors: [{ code: "validation", message: "Email and both names are required.", field: null }], correlationRef }, { status: 400, headers });
  }
  try {
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
    const [ipLimit, contactLimit] = await Promise.all([
      consumeAuthRateLimit({ subject: address, action: "auth.applicant_register.ip", limit: 10, windowSeconds: 900 }),
      consumeAuthRateLimit({ subject: value.email.trim().toLowerCase(), action: "auth.applicant_register.contact", limit: 3, windowSeconds: 3600 }),
    ]);
    if (!ipLimit.allowed || !contactLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, contactLimit.retryAfterSeconds);
      return NextResponse.json({ ok: false, errors: [{ code: "rate_limited", message: "Too many account requests. Wait before trying again.", field: null, retryable: true }], correlationRef }, { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } });
    }
  } catch {
    return NextResponse.json({ ok: false, errors: [{ code: "retryable", message: "Registration is temporarily unavailable. Try again shortly.", field: null, retryable: true }], correlationRef }, { status: 503, headers });
  }
  const result = withCorrelation(await registerApplicant({
    email: value.email,
    givenName: value.givenName,
    familyName: value.familyName,
    purpose: value.purpose === "job_application" ? "job_application" : "student_admission",
    next: typeof value.next === "string" ? value.next : undefined,
  }), correlationRef);
  return NextResponse.json(result, { status: statusForServiceResult(result), headers });
}
