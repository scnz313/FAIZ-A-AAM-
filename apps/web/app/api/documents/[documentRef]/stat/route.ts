import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerActor } from "@/lib/auth/actor";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ documentRef: string }> }) {
  if (dataAdapter() !== "supabase") return NextResponse.json({ error: "document stat is not active in demo mode" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const actor = await getServerActor();
  if (!actor) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { documentRef } = await params;
  const admin = createSupabaseAdminClient();
  const userClient = await createSupabaseServerClient();
  const db = admin as unknown as SupabaseClient;
  const { data: document } = await db.from("documents").select("id, reference, owner_domain, owner_record_id, safe_filename, mime_type, size_bytes, actual_mime_type, actual_size_bytes, checksum, checksum_verified, scan_status, finalized_at, attachment_code, storage_bucket, storage_stat_at").eq("reference", documentRef).maybeSingle();
  if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  let authorized = false;
  if (document.owner_domain === "admission_application") authorized = (await userClient.from("admission_applications").select("id").eq("id", document.owner_record_id).eq("owner_account_id", actor.accountId).maybeSingle()).data !== null;
  else if (document.owner_domain === "job_application") authorized = (await userClient.from("job_applications").select("id").eq("id", document.owner_record_id).eq("owner_account_id", actor.accountId).maybeSingle()).data !== null;
  else if (document.owner_domain === "invoice") {
    const { data: invoice } = await userClient.from("invoices").select("student_id").eq("id", document.owner_record_id).maybeSingle();
    authorized = invoice?.student_id !== null && invoice?.student_id !== undefined && (await userClient.from("guardian_student_links").select("id").eq("student_id", invoice.student_id).eq("status", "active").maybeSingle()).data !== null;
  } else authorized = (await userClient.from("guardian_student_links").select("id").eq("student_id", document.owner_record_id).eq("status", "active").maybeSingle()).data !== null;
  if (!authorized) return NextResponse.json({ error: "Document not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ documentRef: document.reference, filename: document.safe_filename, declaredMimeType: document.mime_type, actualMimeType: document.actual_mime_type, declaredSizeBytes: document.size_bytes, actualSizeBytes: document.actual_size_bytes, checksum: document.checksum, checksumVerified: document.checksum_verified, status: document.scan_status, finalizedAt: document.finalized_at, storageStatAt: document.storage_stat_at, attachmentCode: document.attachment_code }, { headers: { "Cache-Control": "no-store" } });
}
