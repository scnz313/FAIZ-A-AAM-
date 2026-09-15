import { NextResponse } from "next/server";

import { getServerActor } from "@/lib/auth/actor";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { CSV_MAX_ROWS } from "@/lib/imports/csv-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { callAppRpc } from "@/lib/supabase/rpc";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateSourceRows, type ValidationRowInput } from "@/modules/imports/validation";
import type { DataImportEntity } from "@fass/contracts";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALIDATABLE_STATES = new Set(["mapping", "validating", "needs_resolution"]);

/**
 * Server-side import validation boundary. The roster rows never leave this
 * route: it reads them with the service role, computes issues with the shared
 * domain validator, records the issue set + row statuses through
 * app.data_import_apply_validation, then performs the audited
 * validating/needs_resolution transition with the caller's own session.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ error: "Import validation is unavailable in demo mode." }, { status: 503, headers });
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
    .select("id, state, academic_year_id")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404, headers });
  if (!VALIDATABLE_STATES.has(batch.state)) {
    return NextResponse.json(
      { error: `Validation can only run after the mapping step (state: ${batch.state}).` },
      { status: 409, headers },
    );
  }

  /* Grade section references are checked against the configured sections for
   * the batch's academic year so an unknown (but well-formed) reference is a
   * resolvable validation issue instead of a commit-time FK failure. */
  const { data: sections, error: sectionsError } = await admin
    .from("grade_sections")
    .select("id")
    .eq("academic_year_id", batch.academic_year_id);
  if (sectionsError !== null) {
    return NextResponse.json({ error: "The school grade section configuration could not be read." }, { status: 503, headers });
  }
  const gradeSectionIds = new Set((sections ?? []).map((section) => section.id.toLowerCase()));

  /* Page through the stored rows: a PostgREST server row cap must never
   * silently abbreviate validation for a large batch. */
  const PAGE_SIZE = 1000;
  const storedRows: Array<{ id: string; row_number: number; entity: string; source_key: string; normalized: unknown }> = [];
  for (let from = 0; from <= CSV_MAX_ROWS; from += PAGE_SIZE) {
    const { data: page, error: rowsError } = await admin
      .from("data_import_rows")
      .select("id, row_number, entity, source_key, normalized")
      .eq("batch_id", batchId)
      .order("row_number", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (rowsError !== null) {
      return NextResponse.json({ error: "The uploaded rows could not be read." }, { status: 503, headers });
    }
    storedRows.push(...(page ?? []));
    if ((page ?? []).length < PAGE_SIZE) break;
  }
  if (storedRows.length > CSV_MAX_ROWS) {
    return NextResponse.json({ error: "The batch exceeds the validation row limit." }, { status: 422, headers });
  }

  const validation = validateSourceRows(storedRows.map((row): ValidationRowInput => ({
    rowId: row.id,
    rowNumber: row.row_number,
    entity: row.entity as DataImportEntity,
    sourceKey: row.source_key,
    normalized: (row.normalized ?? {}) as Record<string, unknown>,
  })), { gradeSectionIds });

  const applied = await callAppRpc<{ state: string; version: number; rowCount: number }>(admin, "data_import_apply_validation", {
    p_batch_id: batchId,
    p_rows: validation.rows,
    p_issues: validation.issues,
  });
  if (applied.error !== null || applied.data === null) {
    return NextResponse.json({ error: "Validation results could not be recorded." }, { status: 503, headers });
  }

  const userClient = await createSupabaseServerClient();
  const finished = await callAppRpc<{
    state: string;
    version: number;
    unresolvedErrorCount: number;
    warningCount: number;
  }>(userClient, "data_import_finish_validation", {
    p_batch_id: batchId,
    p_expected_version: applied.data.version,
  });
  if (finished.error !== null || finished.data === null) {
    return NextResponse.json({ error: "The validation state could not be finalised." }, { status: 503, headers });
  }

  return NextResponse.json({
    ok: true,
    state: finished.data.state,
    version: finished.data.version,
    rowCount: applied.data.rowCount,
    errorCount: validation.errorCount,
    warningCount: validation.warningCount,
    unresolvedErrorCount: finished.data.unresolvedErrorCount,
  }, { headers });
}
