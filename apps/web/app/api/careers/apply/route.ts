import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeAuthRateLimit } from "@/lib/auth/identity-server";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { statusForCareersIntakeError } from "@/lib/careers/public-intake";
import { readJsonBounded, PUBLIC_JSON_MAX_BYTES } from "@/lib/http/request-body";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";
import { scheduleOutboxKick } from "@/lib/supabase/outbox-kick";

/**
 * Public job-application intake (owner requirement, 15 September 2026).
 *
 * The applicant has no account: the browser never signs in and never holds a
 * service credential. This route is the only writer. It enforces same-origin,
 * per-IP and per-email rate limits, a honeypot field, and a strict schema
 * (unknown keys are rejected, so no mass assignment is possible), then calls
 * the service-role-only `app.jobs_public_submit_application` command which
 * re-validates everything and owns deduplication.
 */

const inputSchema = z
  .object({
    vacancyRef: z.string().trim().min(3).max(40),
    vacancyVersion: z.number().int().min(1).max(100000),
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(24).regex(/^[0-9+()\-\s]*$/u).optional(),
    location: z.string().trim().max(160).optional(),
    qualification: z.string().trim().max(120).optional(),
    subject: z.string().trim().max(120).optional(),
    year: z.string().trim().max(10).optional(),
    institution: z.string().trim().max(160).optional(),
    experience: z.string().trim().max(60).optional(),
    currentRole: z.string().trim().max(120).optional(),
    message: z.string().trim().max(2000).optional(),
    consent: z.literal(true),
    /** Honeypot: a real applicant never fills this hidden field. */
    website: z.string().max(200).optional(),
  })
  .strict();

const HEADERS = { "Cache-Control": "no-store" };

type RpcFailure = { message?: string };

export async function POST(request: Request) {
  const correlationId = crypto.randomUUID();
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ ok: false, code: "forbidden", error: "Cross-origin requests are not accepted." }, { status: 403, headers: HEADERS });
  }
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ ok: false, code: "unavailable", error: "The online application form is not active in demo mode." }, { status: 503, headers: HEADERS });
  }

  const read = await readJsonBounded(request, PUBLIC_JSON_MAX_BYTES);
  if (!read.ok) {
    return NextResponse.json(
      read.reason === "too_large"
        ? { ok: false, code: "validation", error: "The application is too large to accept." }
        : { ok: false, code: "validation", error: "Check the application fields and try again." },
      { status: read.reason === "too_large" ? 413 : 400, headers: HEADERS },
    );
  }
  const parsed = inputSchema.safeParse(read.value);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "validation", error: "Check the application fields and try again." }, { status: 400, headers: HEADERS });
  }

  /* Honeypot: silently accept the bot-shaped submission without creating a
     record, so automated probes cannot learn which field caught them. */
  if (parsed.data.website !== undefined && parsed.data.website.trim().length > 0) {
    return NextResponse.json({ ok: true }, { status: 200, headers: HEADERS });
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  const email = parsed.data.email.toLowerCase();
  try {
    const [ipLimit, contactLimit] = await Promise.all([
      consumeAuthRateLimit({ subject: forwarded, action: "careers.apply.ip", limit: 10, windowSeconds: 900 }),
      consumeAuthRateLimit({ subject: email, action: "careers.apply.contact", limit: 3, windowSeconds: 3600 }),
    ]);
    if (!ipLimit.allowed || !contactLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, contactLimit.retryAfterSeconds);
      return NextResponse.json(
        { ok: false, code: "rate_limited", error: "Too many applications from this connection. Please try again later." },
        { status: 429, headers: { ...HEADERS, "Retry-After": String(retryAfter) } },
      );
    }
  } catch {
    return NextResponse.json({ ok: false, code: "unavailable", error: "Applications are temporarily unavailable. Try again shortly.", correlationId }, { status: 503, headers: { ...HEADERS, "X-Correlation-Id": correlationId } });
  }

  const { website: _honeypot, ...payload } = parsed.data;
  void _honeypot;
  const result = await callAppRpc<{ applicationId: string; reference: string; status: string; version: number }>(
    createSupabaseAdminClient(),
    "jobs_public_submit_application",
    { p_payload: payload },
  );
  if (result.error !== null || result.data === null) {
    const failure = result.error as RpcFailure | null;
    const mapped = statusForCareersIntakeError(failure?.message ?? "");
    return NextResponse.json(
      {
        ok: false,
        code: mapped.code,
        error: mapped.status === 503
          ? "We could not submit your application right now. Your details are still on this page · please try again."
          : (failure?.message ?? "The application could not be accepted.").replace(/^[a-z_]+:\s*/, ""),
        correlationId,
      },
      { status: mapped.status, headers: { ...HEADERS, "X-Correlation-Id": correlationId } },
    );
  }

  scheduleOutboxKick("careers.apply");
  return NextResponse.json(
    { ok: true, reference: result.data.reference },
    { status: 200, headers: { ...HEADERS, "X-Correlation-Id": correlationId } },
  );
}
