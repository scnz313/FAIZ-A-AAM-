import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerActor } from "@/lib/auth/actor";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { documentActorCanAccess, storedDocumentAvailability, type StoredDocumentAccessRecord } from "@/modules/services/document-access.server";

const SIGNED_URL_TTL_SECONDS = 60;
const DOCUMENT_REFERENCE = /^[A-Z0-9][A-Z0-9-]{2,80}$/i;

const noStoreHeaders = (correlationId?: string) => ({
  "Cache-Control": "private, no-store",
  ...(correlationId ? { "X-Correlation-Id": correlationId } : {}),
});

function unavailable() {
  /* Unknown and unauthorized references deliberately share one response. */
  return NextResponse.json(
    { error: "Document not found or unavailable." },
    { status: 404, headers: noStoreHeaders() },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentRef: string }> },
) {
  const correlationId = crypto.randomUUID();
  if (dataAdapter() !== "supabase") {
    return NextResponse.json(
      { state: "failed", error: "Document delivery is not active in demo mode." },
      { status: 503, headers: noStoreHeaders(correlationId) },
    );
  }

  const actor = await getServerActor();
  if (actor === null) {
    return NextResponse.json(
      { state: "denied", error: "Sign in to continue." },
      { status: 401, headers: noStoreHeaders(correlationId) },
    );
  }

  const { documentRef } = await params;
  if (!DOCUMENT_REFERENCE.test(documentRef)) return unavailable();

  /* The admin read is restricted to this delivery boundary. No storage field
   * is returned until the request-aware user client passes the explicit
   * owning-record authorization check below. */
  const admin = createSupabaseAdminClient();
  const db = admin as unknown as SupabaseClient<Database>;
  const { data: document, error } = await db
    .from("documents")
    .select("reference, owner_domain, owner_record_id, object_key, storage_bucket, mime_type, safe_filename, scan_status, checksum_verified, finalized_at, retention_until, legal_hold_until, deleted_at")
    .eq("reference", documentRef)
    .maybeSingle();
  if (error !== null || document === null) return unavailable();

  /* The generated database types do not yet expose storage_bucket (and the
   * retention/hold/deleted columns used by the availability helper), so the
   * select above resolves to a SelectQueryError. Cast to a string-keyed record
   * before accessing those columns, exactly like the finalize route. */
  const doc = document as unknown as Record<string, unknown>;

  const userClient = await createSupabaseServerClient();
  if (!(await documentActorCanAccess(userClient, actor, doc as unknown as Pick<StoredDocumentAccessRecord, "owner_domain" | "owner_record_id">))) return unavailable();

  const state = storedDocumentAvailability(doc as unknown as StoredDocumentAccessRecord);
  if (state === "expired") {
    return NextResponse.json(
      { state, error: "This document is no longer available under its retention policy." },
      { status: 410, headers: noStoreHeaders(correlationId) },
    );
  }
  if (state === "pending") {
    return NextResponse.json(
      { state, error: "This document is still being finalized or scanned." },
      { status: 409, headers: noStoreHeaders(correlationId) },
    );
  }
  if (state === "quarantined") {
    return NextResponse.json(
      { state, error: "This document was quarantined and cannot be downloaded." },
      { status: 423, headers: noStoreHeaders(correlationId) },
    );
  }
  if (state === "failed") {
    return NextResponse.json(
      { state, error: "Document processing failed. Ask the school office to retry or replace it." },
      { status: 422, headers: noStoreHeaders(correlationId) },
    );
  }

  const { data: signed, error: signedError } = await admin.storage
    .from(doc.storage_bucket as string)
    .createSignedUrl(doc.object_key as string, SIGNED_URL_TTL_SECONDS, { download: doc.safe_filename as string });
  if (signedError !== null || signed?.signedUrl === undefined) {
    return NextResponse.json(
      { state: "failed", error: "Document delivery is temporarily unavailable.", correlationId },
      { status: 503, headers: noStoreHeaders(correlationId) },
    );
  }

  /* Sensitive delivery is attributable. If audit persistence fails, do not
   * return the otherwise usable signed URL. */
  const audit = await callAppRpc<string>(userClient, "record_audit", {
    p_action: "Private document download URL issued",
    p_target_type: "document",
    p_target_reference: doc.reference as string,
    p_outcome: "Success",
    p_reason: null,
    p_actor_label: actor.displayName,
  });
  if (audit.error !== null) {
    return NextResponse.json(
      { state: "failed", error: "Document delivery is temporarily unavailable.", correlationId },
      { status: 503, headers: noStoreHeaders(correlationId) },
    );
  }

  const expiresAtIso = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  const wantsJson = request.headers.get("accept")?.includes("application/json")
    || new URL(request.url).searchParams.get("response") === "json";
  if (wantsJson) {
    return NextResponse.json(
      { state: "ready", url: signed.signedUrl, expiresAtIso, filename: doc.safe_filename as string },
      { headers: noStoreHeaders(correlationId) },
    );
  }

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: noStoreHeaders(correlationId),
  });
}
