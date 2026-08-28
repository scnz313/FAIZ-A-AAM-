import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isSameOrigin, registerApplicant } from "@/lib/auth/identity-server";
import { dataAdapter } from "@/lib/supabase/env";
import { statusForServiceResult, withCorrelation } from "@/app/api/adapter/registry";

export async function POST(request: NextRequest) {
  const correlationRef = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Correlation-Id": correlationRef };
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }], correlationRef }, { status: 403, headers });
  }
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ ok: false, errors: [{ code: "unavailable", message: "Applicant registration is not active in the demo adapter.", field: null }], correlationRef }, { status: 503, headers });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, errors: [{ code: "validation", message: "Enter the requested registration details.", field: null }], correlationRef }, { status: 400, headers });
  }
  const value = body as { email?: unknown; givenName?: unknown; familyName?: unknown; purpose?: unknown };
  if (typeof value?.email !== "string" || typeof value.givenName !== "string" || typeof value.familyName !== "string") {
    return NextResponse.json({ ok: false, errors: [{ code: "validation", message: "Email and both names are required.", field: null }], correlationRef }, { status: 400, headers });
  }
  const result = withCorrelation(await registerApplicant({
    email: value.email,
    givenName: value.givenName,
    familyName: value.familyName,
    purpose: value.purpose === "job_application" ? "job_application" : "student_admission",
  }), correlationRef);
  return NextResponse.json(result, { status: statusForServiceResult(result), headers });
}
