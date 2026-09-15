import { NextResponse } from "next/server";

import { getServerActor } from "@/lib/auth/actor";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCAN_READY = new Set(["ready", "clean"]);
const SCAN_TROUBLE = new Set(["failed", "quarantined"]);
/** A finalized source document that is still unscanned after this long is
 *  reported as stalled so the operator gets a replace/cancel next step
 *  instead of an endless spinner. */
const STALLED_AFTER_MS = 5 * 60 * 1000;

/**
 * Reconciles the scan step of a school-data import batch.
 *
 * The parse pipeline advances `uploaded → scanning` when the source
 * document's scan completes. Two provider realities break that: the scan can
 * finish before the upload is linked to the batch (the state guard then never
 * fires), and a scanner can reject the file. This route, called by the scan
 * step's own poll, moves a linked-and-ready batch forward with the operator's
 * session and otherwise reports the document scan state so the workspace can
 * offer a truthful next step (wait, replace the source file, cancel).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ error: "Import scan reconciliation is unavailable in demo mode." }, { status: 503, headers });
  }
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin requests are not accepted." }, { status: 403, headers });
  }
  const actor = await getServerActor();
  if (actor === null) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers });
  if (actor.aal !== "aal2" || !actor.roles.includes("system_administrator")) {
    return NextResponse.json({ error: "Administrator verification is required." }, { status: 403, headers });
  }

  const { batchId } = await params;
  if (!UUID_PATTERN.test(batchId)) {
    return NextResponse.json({ error: "The import batch reference is invalid." }, { status: 400, headers });
  }

  const admin = createSupabaseAdminClient();
  const { data: batch } = await admin
    .from("data_import_batches")
    .select("id, reference, state, version, source_document_id")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404, headers });

  const respond = (input: {
    state: string;
    version: number;
    scanStatus: string | null;
    advanced: boolean;
    nextStep: "none" | "upload" | "wait" | "mapping" | "replace";
    stalled: boolean;
    error?: string;
  }) => NextResponse.json({ ok: true, reference: batch.reference, ...input }, { headers });

  if (batch.state !== "uploaded") {
    return respond({ state: batch.state, version: batch.version, scanStatus: null, advanced: false, nextStep: "none", stalled: false });
  }
  if (batch.source_document_id === null) {
    return respond({ state: batch.state, version: batch.version, scanStatus: null, advanced: false, nextStep: "upload", stalled: false });
  }

  const { data: document } = await admin
    .from("documents")
    .select("id, reference, scan_status, finalized_at")
    .eq("id", batch.source_document_id)
    .maybeSingle();
  if (!document) {
    return respond({
      state: batch.state, version: batch.version, scanStatus: null, advanced: false, nextStep: "upload", stalled: false,
      error: "The linked source file is no longer available. Replace it with a corrected CSV or cancel the batch.",
    });
  }
  const finalizedAtMs = document.finalized_at === null ? null : Date.parse(String(document.finalized_at));
  const stalled = finalizedAtMs !== null && Number.isFinite(finalizedAtMs) && Date.now() - finalizedAtMs > STALLED_AFTER_MS;

  if (SCAN_TROUBLE.has(document.scan_status)) {
    return respond({
      state: batch.state, version: batch.version, scanStatus: document.scan_status, advanced: false,
      nextStep: "replace", stalled,
      error: "The source file did not pass the security scan. Replace it with a corrected CSV or cancel the batch.",
    });
  }

  if (!SCAN_READY.has(document.scan_status)) {
    return respond({ state: batch.state, version: batch.version, scanStatus: document.scan_status, advanced: false, nextStep: "wait", stalled });
  }

  const userClient = await createSupabaseServerClient();
  const advanced = await callAppRpc<{ state: string; version: number }>(userClient, "data_import_set_state", {
    p_batch_id: batch.id,
    p_new_state: "scanning",
    p_expected_version: batch.version,
  });
  if (advanced.error !== null || advanced.data === null) {
    /* A concurrent operator or the state guard already moved the batch; report
     * the current state instead of failing the poll. */
    const { data: current } = await admin
      .from("data_import_batches")
      .select("state, version")
      .eq("id", batchId)
      .maybeSingle();
    return respond({
      state: current?.state ?? batch.state,
      version: current?.version ?? batch.version,
      scanStatus: document.scan_status,
      advanced: (current?.state ?? batch.state) !== "uploaded",
      nextStep: (current?.state ?? batch.state) === "uploaded" ? "wait" : "mapping",
      stalled: false,
    });
  }

  return respond({
    state: advanced.data.state, version: advanced.data.version,
    scanStatus: document.scan_status, advanced: true, nextStep: "mapping", stalled: false,
  });
}
