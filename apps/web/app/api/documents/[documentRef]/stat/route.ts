import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerActor } from "@/lib/auth/actor";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { dataAdapter } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { documentActorCanAccess, storedDocumentAvailability, type StoredDocumentAccessRecord } from "@/modules/services/document-access.server";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ documentRef: string }> }) {
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ error: "Document status is not active in demo mode." }, { status: 503, headers: NO_STORE });
  }
  const actor = await getServerActor();
  if (!actor) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: NO_STORE });

  const { documentRef } = await params;
  const admin = createSupabaseAdminClient();
  const db = admin as unknown as SupabaseClient<Database>;
  const { data: document } = await db
    .from("documents")
    .select("reference, owner_domain, owner_record_id, safe_filename, mime_type, size_bytes, actual_mime_type, actual_size_bytes, checksum_verified, scan_status, finalized_at, attachment_code, storage_stat_at, retention_until, legal_hold_until, deleted_at")
    .eq("reference", documentRef)
    .maybeSingle();
  if (!document) return NextResponse.json({ error: "Document not found or unavailable." }, { status: 404, headers: NO_STORE });

  /* The generated database types do not yet expose storage_stat_at (nor the
   * retention/hold/deleted columns used by the availability helper), so the
   * select above resolves to a SelectQueryError. Cast to a string-keyed record
   * before accessing those columns, exactly like the finalize route. */
  const doc = document as unknown as Record<string, unknown>;

  const userClient = await createSupabaseServerClient();
  if (!(await documentActorCanAccess(userClient, actor, doc as unknown as Pick<StoredDocumentAccessRecord, "owner_domain" | "owner_record_id">))) {
    return NextResponse.json({ error: "Document not found or unavailable." }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json({
    documentRef: doc.reference as string,
    filename: doc.safe_filename as string,
    declaredMimeType: doc.mime_type as string,
    actualMimeType: doc.actual_mime_type as string | null,
    declaredSizeBytes: doc.size_bytes as number,
    actualSizeBytes: doc.actual_size_bytes as number | null,
    checksumVerified: doc.checksum_verified as boolean,
    state: storedDocumentAvailability(doc as unknown as StoredDocumentAccessRecord),
    scanState: (doc.scan_status as string) === "clean" ? "ready" : doc.scan_status as string,
    finalizedAt: doc.finalized_at as string | null,
    storageStatAt: doc.storage_stat_at as string | null,
    attachmentCode: doc.attachment_code as string | null,
  }, { headers: NO_STORE });
}
