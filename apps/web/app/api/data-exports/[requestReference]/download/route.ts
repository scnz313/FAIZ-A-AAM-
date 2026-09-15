import { NextResponse } from "next/server";

import { getServerActor } from "@/lib/auth/actor";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";

export const runtime = "nodejs";
const URL_TTL_SECONDS = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestReference: string }> },
) {
  const correlationId = crypto.randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Correlation-Id": correlationId };
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ error: "Export downloads are unavailable in demo mode." }, { status: 503, headers });
  }
  const actor = await getServerActor();
  if (actor === null) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers });
  if (actor.aal !== "aal2" || !actor.roles.includes("system_administrator")) {
    return NextResponse.json({ error: "Administrator verification is required." }, { status: 403, headers });
  }

  const { requestReference } = await params;
  const admin = createSupabaseAdminClient();
  const { data: exportRequest } = await admin
    .from("data_export_requests")
    .select("id, reference, state, document_id, expires_at")
    .eq("reference", requestReference)
    .maybeSingle();
  if (!exportRequest || exportRequest.state !== "ready" || !exportRequest.document_id) {
    return NextResponse.json({ error: "Export artifact is not ready." }, { status: 404, headers });
  }
  if (exportRequest.expires_at && new Date(exportRequest.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "This export has expired. Request a new export." }, { status: 410, headers });
  }
  const { data: document } = await admin
    .from("documents")
    .select("reference, storage_bucket, object_key, safe_filename, scan_status, checksum_verified")
    .eq("id", exportRequest.document_id)
    .maybeSingle();
  if (!document || !["ready", "clean"].includes(document.scan_status) || !document.checksum_verified) {
    return NextResponse.json({ error: "Export artifact is not available for download." }, { status: 409, headers });
  }
  const { data: signed, error } = await admin.storage
    .from(document.storage_bucket)
    .createSignedUrl(document.object_key, URL_TTL_SECONDS, { download: document.safe_filename });
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: "The download link could not be created. Try again." }, { status: 503, headers });
  }
  await admin.from("audit_events").insert({
    actor_account_id: actor.accountId,
    actor_label: "System administrator",
    action: "Export download URL issued",
    target_type: "data_export_request",
    target_reference: exportRequest.reference,
    outcome: "Success",
    reason: `document=${document.reference}`,
    correlation_id: correlationId,
  });
  return NextResponse.json({ signedUrl: signed.signedUrl, expiresInSeconds: URL_TTL_SECONDS }, { headers });
}
