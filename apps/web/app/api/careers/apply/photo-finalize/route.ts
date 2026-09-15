import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { consumeAuthRateLimit } from "@/lib/auth/identity-server";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { detectImageMimeType } from "@/lib/documents/image-type";
import { statusForCareersIntakeError } from "@/lib/careers/public-intake";
import { readJsonBounded, SMALL_JSON_MAX_BYTES } from "@/lib/http/request-body";
import { SupabaseStorageProvider } from "@/lib/documents/providers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";

/**
 * Finalize the optional public-application profile photo. The server reads the
 * stored bytes itself and verifies the real image type, the exact authorized
 * size, and the SHA-256 checksum before the existing service-role document
 * finalize/link commands run. The scan status intentionally stays pending for
 * the existing scanning pipeline.
 */

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const inputSchema = z
  .object({
    reference: z.string().trim().min(5).max(40),
    documentRef: z.string().trim().min(5).max(40),
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
      { ok: false, code: "validation", error: read.reason === "too_large" ? "The finalize request is too large to accept." : "The photo reference is missing or malformed." },
      { status: read.reason === "too_large" ? 413 : 400, headers: HEADERS },
    );
  }
  const parsed = inputSchema.safeParse(read.value);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "validation", error: "The photo reference is missing or malformed." }, { status: 400, headers: HEADERS });
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  try {
    const [ipLimit, referenceLimit] = await Promise.all([
      consumeAuthRateLimit({ subject: forwarded, action: "careers.photo.finalize.ip", limit: 20, windowSeconds: 900 }),
      consumeAuthRateLimit({ subject: parsed.data.reference, action: "careers.photo.finalize.reference", limit: 20, windowSeconds: 3600 }),
    ]);
    if (!ipLimit.allowed || !referenceLimit.allowed) {
      const retryAfter = Math.max(ipLimit.retryAfterSeconds, referenceLimit.retryAfterSeconds);
      return NextResponse.json(
        { ok: false, code: "rate_limited", error: "Too many attempts. Please try again later." },
        { status: 429, headers: { ...HEADERS, "Retry-After": String(retryAfter) } },
      );
    }
  } catch {
    return NextResponse.json({ ok: false, code: "unavailable", error: "Photo verification is temporarily unavailable.", correlationId }, { status: 503, headers: { ...HEADERS, "X-Correlation-Id": correlationId } });
  }

  const admin = createSupabaseAdminClient();
  const db = admin as unknown as SupabaseClient<Database>;

  const { data: application, error: applicationError } = await db
    .from("job_applications")
    .select("id, reference")
    .eq("reference", parsed.data.reference)
    .maybeSingle();
  if (applicationError !== null) {
    return NextResponse.json({ ok: false, code: "unavailable", error: "The application could not be verified.", correlationId }, { status: 503, headers: { ...HEADERS, "X-Correlation-Id": correlationId } });
  }
  if (application === null) {
    return NextResponse.json({ ok: false, code: "not_found", error: "This application reference is not available." }, { status: 404, headers: HEADERS });
  }

  const { data: document, error: documentError } = await db
    .from("documents")
    .select("id, reference, owner_domain, owner_record_id, category, object_key, storage_bucket, mime_type, size_bytes, scan_status, checksum_verified, deleted_at")
    .eq("reference", parsed.data.documentRef)
    .maybeSingle();
  if (documentError !== null) {
    return NextResponse.json({ ok: false, code: "unavailable", error: "The photo could not be verified.", correlationId }, { status: 503, headers: { ...HEADERS, "X-Correlation-Id": correlationId } });
  }
  if (
    document === null
    || document.owner_domain !== "job_application"
    || document.owner_record_id !== application.id
    || document.category !== "profile_photo"
    || document.deleted_at !== null
  ) {
    return NextResponse.json({ ok: false, code: "not_found", error: "This photo does not belong to the application." }, { status: 404, headers: HEADERS });
  }

  /* Idempotent retry: an already-finalized photo returns its current state. */
  if (document.checksum_verified === true) {
    return NextResponse.json(
      { ok: true, documentRef: document.reference, state: document.scan_status === "clean" ? "ready" : document.scan_status },
      { status: 200, headers: HEADERS },
    );
  }
  if (document.scan_status !== "pending_scan" && document.scan_status !== "failed") {
    return NextResponse.json({ ok: false, code: "conflict", error: "This photo is not awaiting finalization." }, { status: 409, headers: HEADERS });
  }

  let object: { bytes: Uint8Array; sizeBytes: number; checksumSha256: string };
  try {
    object = await new SupabaseStorageProvider(admin).stat({
      bucket: typeof document.storage_bucket === "string" ? document.storage_bucket : "fass-private-documents",
      objectKey: document.object_key as string,
    });
  } catch {
    return NextResponse.json({ ok: false, code: "unavailable", error: "The uploaded photo could not be read yet. Try again in a moment." }, { status: 422, headers: HEADERS });
  }

  const actualMimeType = detectImageMimeType(object.bytes);
  if (
    actualMimeType === null
    || actualMimeType !== document.mime_type
    || object.sizeBytes !== document.size_bytes
    || object.sizeBytes > MAX_PHOTO_BYTES
  ) {
    return NextResponse.json({ ok: false, code: "validation", error: "The uploaded file is not the authorized image type or size." }, { status: 422, headers: HEADERS });
  }

  const finalized = await callAppRpc<{ reference: string; status: string; checksumVerified: boolean }>(admin, "documents_finalize_upload", {
    p_document_id: document.id as string,
    p_actual_mime_type: actualMimeType,
    p_actual_size: object.sizeBytes,
    p_checksum: object.checksumSha256,
  });
  if (finalized.error !== null || finalized.data === null) {
    const mapped = statusForCareersIntakeError(finalized.error?.message ?? "");
    return NextResponse.json({ ok: false, code: mapped.code, error: "The photo metadata could not be finalized. Try again.", correlationId }, { status: mapped.status, headers: { ...HEADERS, "X-Correlation-Id": correlationId } });
  }

  const linked = await callAppRpc<{ reference: string }>(admin, "documents_link_attachment", {
    p_document_id: document.id as string,
    p_owner_domain: "job_application",
    p_owner_record_id: application.id as string,
    p_attachment_code: "profile_photo",
  });
  if (linked.error !== null || linked.data === null) {
    return NextResponse.json({ ok: false, code: "unavailable", error: "The photo was verified but could not be attached. Try again.", correlationId }, { status: 503, headers: { ...HEADERS, "X-Correlation-Id": correlationId } });
  }

  return NextResponse.json(
    { ok: true, documentRef: finalized.data.reference, state: "pending_scan" },
    { status: 200, headers: HEADERS },
  );
}
