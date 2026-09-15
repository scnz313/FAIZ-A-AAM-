import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getServerActor } from "@/lib/auth/actor";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dataAdapter } from "@/lib/supabase/env";
import {
  parseAdapterOperation,
  ReferenceResolutionError,
  resolveAdapterReferences,
  statusForServiceResult,
  withCorrelation,
} from "./registry";
import type { AdapterSelection } from "./registry/types";

const ACTIVE_FAMILY_STUDENT_COOKIE = "fass-active-student";
const ACTIVE_STAFF_WORKSPACE_COOKIE = "fass-active-workspace";

function responseFor(body: unknown, status: number, correlationRef: string, cookies: Array<{ name: string; value: string }> = []) {
  const response = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationRef },
  });
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}

function errorBody(code: "unauthenticated" | "forbidden" | "validation" | "unavailable", message: string, correlationRef: string, httpStatus: number) {
  return { ok: false, errors: [{ code, message, field: null }], correlationRef, httpStatus, retryable: httpStatus >= 500 };
}

export async function POST(request: NextRequest) {
  const correlationRef = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  if (dataAdapter() !== "supabase") {
    return responseFor(errorBody("unavailable", "The Supabase adapter is not active.", correlationRef, 503), 503, correlationRef);
  }

  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return responseFor(errorBody("forbidden", "Cross-origin requests are not accepted.", correlationRef, 403), 403, correlationRef);
  }

  const actor = await getServerActor();
  if (actor === null) {
    return responseFor(errorBody("unauthenticated", "Sign in to continue.", correlationRef, 401), 401, correlationRef);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return responseFor(errorBody("validation", "Invalid operation payload.", correlationRef, 400), 400, correlationRef);
  }
  const parsed = parseAdapterOperation(body);
  if (parsed === null) {
    return responseFor(errorBody("validation", "Invalid operation payload.", correlationRef, 400), 400, correlationRef);
  }

  const supabase = await createSupabaseServerClient();
  const selection: AdapterSelection = {
    familyStudentId: request.cookies.get(ACTIVE_FAMILY_STUDENT_COOKIE)?.value,
    staffRoleGrantId: request.cookies.get(ACTIVE_STAFF_WORKSPACE_COOKIE)?.value,
  };
  const context = { supabase, actor, selection };
  let result;
  try {
    const normalized = await resolveAdapterReferences(supabase, parsed.operation.name, parsed.payload as Record<string, unknown>);
    result = await parsed.operation.handle(context, normalized);
  } catch (error) {
    if (error instanceof ReferenceResolutionError) {
      result = { ok: false as const, errors: [{ code: error.code, message: error.message, field: null }] };
    } else {
      /* Keep provider/SQL details out of the browser. The correlation reference
       * is sufficient for operators to find the structured server log. */
      result = { ok: false as const, errors: [{ code: "unavailable" as const, message: "The operation could not be completed.", field: null }] };
    }
  }
  const safeResult = withCorrelation(result, correlationRef);
  const payload = parsed.payload as Record<string, unknown>;
  const cookies: Array<{ name: string; value: string }> = [];
  if (safeResult.ok && parsed.operation.name === "context.family" && typeof (payload.studentId ?? payload.studentRef) === "string") {
    cookies.push({ name: ACTIVE_FAMILY_STUDENT_COOKIE, value: String(payload.studentId ?? payload.studentRef) });
  }
  if (safeResult.ok && parsed.operation.name === "context.staff" && typeof (payload.roleGrantId ?? payload.roleGrantRef) === "string") {
    cookies.push({ name: ACTIVE_STAFF_WORKSPACE_COOKIE, value: String(payload.roleGrantId ?? payload.roleGrantRef) });
  }
  return responseFor(safeResult, statusForServiceResult(safeResult), correlationRef, cookies);
}
