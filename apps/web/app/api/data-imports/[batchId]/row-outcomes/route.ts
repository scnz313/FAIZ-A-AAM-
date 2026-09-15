import { NextResponse } from "next/server";

import { getServerActor } from "@/lib/auth/actor";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { CSV_MAX_ROWS } from "@/lib/imports/csv-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Per-row import outcomes for the Report step. The roster payload
 * (`normalized`) never leaves this route: it returns the stored row number,
 * entity, canonical source key, row status, and committed outcome only, so a
 * partially committed batch shows exactly which rows committed, skipped, or
 * failed instead of an aggregate that can disagree with the stored records.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ error: "Import row outcomes are unavailable in demo mode." }, { status: 503, headers });
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
    .select("id, reference, state")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404, headers });

  /* Bounded by default: the Report step pages through outcomes instead of
   * shipping a 10k-row payload and rendering a 10k-row table. */
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "500");
  const rawOffset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 2000) : 500;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0;
  if (offset > CSV_MAX_ROWS) {
    return NextResponse.json({ error: "The batch exceeds the row outcome limit." }, { status: 422, headers });
  }

  const { data: page, error: rowsError, count } = await admin
    .from("data_import_rows")
    .select("row_number, entity, source_key, status, outcome", { count: "exact" })
    .eq("batch_id", batchId)
    .order("row_number", { ascending: true })
    .range(offset, offset + limit - 1);
  if (rowsError !== null) {
    return NextResponse.json({ error: "The import row outcomes could not be read." }, { status: 503, headers });
  }
  const rows = (page ?? []).map((row) => ({
    rowNumber: row.row_number,
    entity: row.entity,
    sourceKey: row.source_key,
    status: row.status,
    outcome: row.outcome,
  }));
  const total = count ?? offset + rows.length;
  const nextOffset = offset + rows.length < total ? offset + rows.length : null;

  return NextResponse.json({ ok: true, reference: batch.reference, state: batch.state, rows, total, nextOffset }, { headers });
}
