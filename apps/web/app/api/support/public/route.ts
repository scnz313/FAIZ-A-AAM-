import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";

import { isSameOrigin } from "@/lib/auth/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Cross-origin requests are not accepted.", field: null }] }, { status: 403 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, errors: [{ code: "validation", message: "Check the support form fields.", field: null }] }, { status: 400 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const captcha = await captchaAdapter().verify({ token: parsed.data.captchaToken ?? null, ipAddress: forwarded });
  if (!captcha.ok) return NextResponse.json({ ok: false, errors: [{ code: "forbidden", message: "Complete the CAPTCHA check before sending your concern.", field: "captchaToken" }] }, { status: 403 });
  const intakeKey = createHash("sha256").update(`support-public:${forwarded}`, "utf8").digest("hex");
  const result = await supportPublicIntake(await createSupabaseServerClient(), { ...parsed.data, intakeKey, captchaProvider: captcha.provider, captchaVerifiedAt: captcha.verifiedAt ?? undefined });
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
