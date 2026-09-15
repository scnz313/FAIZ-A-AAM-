import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";

import { consumeAuthRateLimit } from "@/lib/auth/identity-server";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { readJsonBounded, PUBLIC_JSON_MAX_BYTES } from "@/lib/http/request-body";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { supportPublicIntake } from "@/lib/supabase/domain";
import { captchaAdapter } from "@/lib/support/captcha";

const inputSchema = z.object({
  category: z.string().min(1).max(80),
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(5000),
  contact: z.string().min(5).max(240),
  requesterName: z.string().max(120).nullable().optional(),
  captchaToken: z.string().max(4000).nullable().optional(),
});

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }] }, { status: 403, headers });
  }
  const read = await readJsonBounded(request, PUBLIC_JSON_MAX_BYTES);
  if (!read.ok) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "validation", message: read.reason === "too_large" ? "The message is too long to accept." : "Check the support form fields.", field: null }] },
      { status: read.reason === "too_large" ? 413 : 400, headers },
    );
  }
  const parsed = inputSchema.safeParse(read.value);
  if (!parsed.success) return NextResponse.json({ ok: false, errors: [{ code: "validation", message: "Check the support form fields.", field: null }] }, { status: 400, headers });

  /* The intake command is service-role only (migration 000087): anonymous
     callers cannot reach it through PostgREST, and the public form is always
     mediated by this route, which owns the CAPTCHA check and rate limiting. */
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ ok: false, errors: [{ code: "unavailable", message: "The public support form is not available in demo mode.", field: null }] }, { status: 503, headers });
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  try {
    const [ipLimit, contactLimit] = await Promise.all([
      consumeAuthRateLimit({ subject: forwarded, action: "support.public.ip", limit: 10, windowSeconds: 900 }),
      consumeAuthRateLimit({ subject: parsed.data.contact.trim().toLowerCase(), action: "support.public.contact", limit: 3, windowSeconds: 3600 }),
    ]);
    if (!ipLimit.allowed || !contactLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, contactLimit.retryAfterSeconds);
      return NextResponse.json({ ok: false, errors: [{ code: "unavailable", message: "Too many requests. Please try again later.", field: null }] }, { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } });
    }
  } catch {
    return NextResponse.json({ ok: false, errors: [{ code: "unavailable", message: "Support intake is temporarily unavailable.", field: null }] }, { status: 503, headers });
  }

  const captcha = await captchaAdapter().verify({ token: parsed.data.captchaToken ?? null, ipAddress: forwarded });
  if (!captcha.ok) return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Complete the CAPTCHA check before sending your concern.", field: "captchaToken" }] }, { status: 403, headers });
  const intakeKey = createHash("sha256").update(`support-public:${forwarded}`, "utf8").digest("hex");
  const result = await supportPublicIntake(createSupabaseAdminClient(), { ...parsed.data, intakeKey, captchaProvider: captcha.provider, captchaVerifiedAt: captcha.verifiedAt ?? undefined });
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers });
}
