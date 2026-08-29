import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";
import { SupabaseStorageProvider } from "@/lib/documents/providers";

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
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin requests are not accepted." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!serviceAuthorized(request)) return NextResponse.json({ error: "Storage service authorization required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (dataAdapter() !== "supabase") return NextResponse.json({ error: "document finalisation is not active in demo mode" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const { documentRef } = await params;
  // Caller-provided MIME/size/checksum values are intentionally ignored. The
  // storage provider reads the object bytes server-side below.
  const admin = createSupabaseAdminClient();
  const db = admin as unknown as SupabaseClient;
  const { data: document } = await db.from("documents").select("id, reference, object_key, storage_bucket, mime_type, size_bytes, scan_status").eq("reference", documentRef).maybeSingle();
  if (!document) return NextResponse.json({ error: "Document not found or unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });

  let object;
  try {
    object = await new SupabaseStorageProvider(admin).stat({ bucket: document.storage_bucket, objectKey: document.object_key });
  } catch {
    return NextResponse.json({ error: "The uploaded object could not be verified yet." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  const actualMimeType = detectMime(object.bytes);
  const checksum = await sha256(object.bytes);
  if (!actualMimeType || object.sizeBytes !== document.size_bytes || actualMimeType !== document.mime_type) return NextResponse.json({ error: "The uploaded object does not match its authorized type or size." }, { status: 422, headers: { "Cache-Control": "no-store" } });

  const result = await callAppRpc<{ reference: string; status: string; checksumVerified: boolean }>(admin, "documents_finalize_upload", {
    p_document_id: document.id,
    p_actual_mime_type: actualMimeType,
    p_actual_size: object.sizeBytes,
    p_checksum: checksum,
  });
  if (result.error !== null || result.data === null) return NextResponse.json({ error: "Document metadata could not be finalized." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true, documentRef: result.data.reference, status: result.data.status, checksumVerified: result.data.checksumVerified }, { headers: { "Cache-Control": "no-store" } });
}
