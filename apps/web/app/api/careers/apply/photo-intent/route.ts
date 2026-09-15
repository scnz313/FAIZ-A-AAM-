import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeAuthRateLimit } from "@/lib/auth/identity-server";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { statusForCareersIntakeError } from "@/lib/careers/public-intake";
import { readJsonBounded, SMALL_JSON_MAX_BYTES } from "@/lib/http/request-body";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";

/**
 * Signed upload intent for the one optional profile photo on a public job
 * application. The declared MIME/size is validated here and again in the
 * service-role SQL command; the browser receives only a short-lived signed
 * URL for an opaque object key and uses the publishable key to upload.
 */

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const inputSchema = z
  .object({
    reference: z.string().trim().min(5).max(40),
    filename: z.string().trim().min(1).max(160),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    sizeBytes: z.number().int().positive().max(MAX_PHOTO_BYTES),
  })
  .strict();

const HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const correlationId = crypto.randomUUID();
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ ok: false, code: "forbidden", error: "Cross-origin requests are not accepted." }, { status: 403, headers: HEADERS });
  }
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ ok: false, code: "unavailable", error: "Photo upload is not active in demo mode." }, { status: 503, headers: HEADERS });
  }

  const read = await readJsonBounded(request, SMALL_JSON_MAX_BYTES);
  if (!read.ok) {
    return NextResponse.json(
      { ok: false, code: "validation", error: read.reason === "too_large" ? "The upload request is too large to accept." : "Choose a JPEG, PNG, or WebP image up to 2 MB." },
      { status: read.reason === "too_large" ? 413 : 400, headers: HEADERS },
    );
  }
  const parsed = inputSchema.safeParse(read.value);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "validation", error: "Choose a JPEG, PNG, or WebP image up to 2 MB." }, { status: 400, headers: HEADERS });
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  try {
    const [ipLimit, referenceLimit] = await Promise.all([
      consumeAuthRateLimit({ subject: forwarded, action: "careers.photo.ip", limit: 20, windowSeconds: 900 }),
      consumeAuthRateLimit({ subject: parsed.data.reference, action: "careers.photo.reference", limit: 10, windowSeconds: 3600 }),
    ]);
    if (!ipLimit.allowed || !referenceLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, referenceLimit.retryAfterSeconds);
      return NextResponse.json(
        { ok: false, code: "rate_limited", error: "Too many attempts. Please try again later." },
        { status: 429, headers: { ...HEADERS, "Retry-After": String(retryAfter) } },
      );
    }
  } catch {
    return NextResponse.json({ ok: false, code: "unavailable", error: "Photo upload is temporarily unavailable.", correlationId }, { status: 503, headers: { ...HEADERS, "X-Correlation-Id": correlationId } });
  }

  const admin = createSupabaseAdminClient();
  const result = await callAppRpc<{ documentRef: string; objectKey: string }>(admin, "jobs_public_photo_intent", {
    p_application_reference: parsed.data.reference,
    p_safe_filename: parsed.data.filename,
    p_declared_mime_type: parsed.data.mimeType,
    p_declared_size: parsed.data.sizeBytes,
  });
  if (result.error !== null || result.data === null) {
    const mapped = statusForCareersIntakeError(result.error?.message ?? "");
    return NextResponse.json(
      { ok: false, code: mapped.code, error: (result.error?.message ?? "The photo could not be accepted.").replace(/^[a-z_]+:\s*/, ""), correlationId },
      { status: mapped.status, headers: { ...HEADERS, "X-Correlation-Id": correlationId } },
    );
  }

  const bucket = "fass-private-documents";
  const signed = await admin.storage.from(bucket).createSignedUploadUrl(result.data.objectKey);
  if (signed.error !== null || signed.data === null) {
    return NextResponse.json({ ok: false, code: "unavailable", error: "The upload service is temporarily unavailable.", correlationId }, { status: 503, headers: { ...HEADERS, "X-Correlation-Id": correlationId } });
  }

  return NextResponse.json(
    { ok: true, documentRef: result.data.documentRef, objectKey: result.data.objectKey, token: signed.data.token, bucket },
    { status: 200, headers: { ...HEADERS, "X-Correlation-Id": correlationId } },
  );
}
