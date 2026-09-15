import { NextResponse, type NextRequest } from "next/server";

import { developmentAccount } from "@/lib/auth/dev-accounts";
import { isSameOrigin } from "@/lib/auth/same-origin";
import {
  developmentAuthEnabled,
  requireDevelopmentTestPassword,
  totpRequired,
} from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const responseHeaders = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!developmentAuthEnabled()) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "not-found", message: "Not found.", field: null }] },
      { status: 404, headers: responseHeaders },
    );
  }
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }] },
      { status: 403, headers: responseHeaders },
    );
  }

  const body = await request.json().catch(() => null) as { account?: unknown } | null;
  const account = typeof body?.account === "string" ? developmentAccount(body.account) : null;
  if (account === null) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "validation", message: "Choose a development account.", field: "account" }] },
      { status: 400, headers: responseHeaders },
    );
  }

  let password: string;
  try {
    password = requireDevelopmentTestPassword();
  } catch {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unavailable", message: "Development accounts are not configured.", field: null }] },
      { status: 503, headers: responseHeaders },
    );
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  const { data, error } = await supabase.auth.signInWithPassword({ email: account.email, password });
  if (error !== null || data.user === null) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unauthenticated", message: "This development account is not ready. Run the development user seed and try again.", field: null }] },
      { status: 401, headers: responseHeaders },
    );
  }

  const [{ data: applicationAccount }, { data: grants }, { data: applicantIdentities }] = await Promise.all([
    supabase.from("user_accounts").select("status").eq("id", data.user.id).maybeSingle(),
    supabase.from("role_grants").select("role_code").eq("account_id", data.user.id).eq("status", "active"),
    supabase.from("applicant_identities").select("purpose").eq("account_id", data.user.id).eq("status", "active"),
  ]);
  const roles = (grants ?? []).map((grant) => grant.role_code);
  const valid = applicationAccount?.status === "active" && (
    account.audience === "staff"
      ? roles.some((role) => role !== "guardian" && role !== "student")
      : account.id === "parent"
        ? roles.includes("guardian")
        : (applicantIdentities ?? []).length > 0
  );
  if (!valid) {
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.json(
      { ok: false, errors: [{ code: "forbidden", message: "This development account is missing its required role or profile. Run the development user seed and try again.", field: null }] },
      { status: 403, headers: responseHeaders },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      value: {
        destination: account.destination,
        requiresMfaElevation: account.audience === "staff" && !totpRequired(),
      },
    },
    { status: 200, headers: responseHeaders },
  );
}
