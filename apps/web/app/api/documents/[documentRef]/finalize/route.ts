import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerActor } from "@/lib/auth/actor";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { SupabaseStorageProvider } from "@/lib/documents/providers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { documentActorCanAccess, type StoredDocumentAccessRecord } from "@/modules/services/document-access.server";

type Params = { params: Promise<{ documentRef: string }> };

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) return "image/png";
  return null;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function serviceAuthorized(request: Request): boolean {
  const expected = process.env.DOCUMENT_SCANNER_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  return typeof expected === "string" && expected.length >= 16 && authorization === `Bearer ${expected}`;
}

export async function POST(request: Request, { params }: Params) {
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Cross-origin requests are not accepted." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ error: "Document finalisation is not active in demo mode." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const trustedService = serviceAuthorized(request);
  const actor = trustedService ? null : await getServerActor();
  if (!trustedService && actor === null) {
    return NextResponse.json({ error: "Sign in to finalize this upload." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const { documentRef } = await params;
  /* Caller-provided MIME/size/checksum values are intentionally ignored. The
   * storage provider reads the object bytes server-side below. */
  const admin = createSupabaseAdminClient();
  const db = admin as unknown as SupabaseClient<Database>;
  const { data: document } = await db
    .from("documents")
    .select("id, reference, owner_domain, owner_record_id, uploaded_by_account_id, attachment_code, object_key, storage_bucket, mime_type, size_bytes, scan_status, checksum_verified, finalized_at, retention_until, legal_hold_until, deleted_at")
    .eq("reference", documentRef)
    .maybeSingle();
  if (!document) {
    return NextResponse.json({ error: "Document not found or unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const doc = document as unknown as Record<string, unknown>;

  if (!trustedService) {
    const userClient = await createSupabaseServerClient();
    const uploaderMatches = doc.uploaded_by_account_id === actor!.accountId;
    if (!uploaderMatches || !(await documentActorCanAccess(userClient, actor!, doc as unknown as Pick<StoredDocumentAccessRecord, "owner_domain" | "owner_record_id">))) {
      return NextResponse.json({ error: "Document not found or unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
  }

  let object;
  try {
    object = await new SupabaseStorageProvider(admin).stat({ bucket: doc.storage_bucket as string, objectKey: doc.object_key as string });
  } catch {
    return NextResponse.json({ error: "The uploaded object could not be verified yet." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  const actualMimeType = detectMime(object.bytes);
  const checksum = await sha256(object.bytes);
  if (!actualMimeType || object.sizeBytes !== doc.size_bytes || actualMimeType !== doc.mime_type) {
    return NextResponse.json({ error: "The uploaded object does not match its authorized type or size." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }

  const result = await callAppRpc<{ reference: string; status: string; checksumVerified: boolean }>(admin, "documents_finalize_upload", {
    p_document_id: doc.id as string,
    p_actual_mime_type: actualMimeType,
    p_actual_size: object.sizeBytes,
    p_checksum: checksum,
  });
  if (result.error !== null || result.data === null) {
    return NextResponse.json({ error: "Document metadata could not be finalized." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }

  /* Migration 000030 made byte finalisation idempotent and deliberately
   * separate from attachment linking. Complete the association here so the
   * owning application readiness check sees exactly this verified document. */
  const linked = await callAppRpc<{ reference: string; status: string }>(admin, "documents_link_attachment", {
    p_document_id: doc.id as string,
    p_owner_domain: doc.owner_domain as string,
    p_owner_record_id: doc.owner_record_id as string,
    p_attachment_code: doc.attachment_code as string,
  });
  if (linked.error !== null || linked.data === null) {
    return NextResponse.json({ error: "The upload was verified but could not be linked to its record. Retry finalization." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { ok: true, documentRef: result.data.reference, state: result.data.status === "clean" ? "ready" : result.data.status, checksumVerified: result.data.checksumVerified },
    { headers: { "Cache-Control": "no-store" } },
  );
}
