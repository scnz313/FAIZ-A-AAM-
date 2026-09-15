import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter, providerEnvReadiness, supabasePublicEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";

function configured(name: string): boolean {
  return typeof process.env[name] === "string" && process.env[name]!.trim().length > 0;
}

/** Safe readiness probe: it reports names/states only, never values or keys. */
export async function GET(_request: NextRequest) {
  const correlationId = crypto.randomUUID();
  let adapter: "demo" | "supabase" = "demo";
  try {
    adapter = dataAdapter();
  } catch {
    return NextResponse.json({ ok: false, status: "misconfigured", correlationId }, { status: 503, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });
  }

  const { missing, email: emailReadiness } = providerEnvReadiness();
  const publicEnv = supabasePublicEnv();
  let migrationReady = adapter === "demo";
  let workerLastRunAt: string | null = null;
  if (adapter === "supabase") {
    try {
      const admin = createSupabaseAdminClient();
      const db = admin as unknown as SupabaseClient;
      /* Migration readiness proves the CURRENT consolidation surface, not
         just the old provider_jobs table: the export pipeline (000060),
         import pipeline (000058), and claim security (000059) tables must
         all exist. It is probed independently of provider env: a missing
         scanner/cron secret must not read as a missing migration. */
      const [schemaProbe, exportProbe, importProbe, claimProbe, latestRun] = await Promise.all([
        db.from("provider_jobs").select("id").limit(1),
        db.from("data_export_requests").select("id").limit(1),
        db.from("data_import_batches").select("id").limit(1),
        db.from("guardian_claim_invitations").select("id").limit(1),
        db.from("job_runs").select("finished_at, status").eq("job_name", "outbox").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      migrationReady = schemaProbe.error === null && exportProbe.error === null
        && importProbe.error === null && claimProbe.error === null;
      workerLastRunAt = latestRun.data?.finished_at ?? null;
    } catch {
      migrationReady = false;
    }
  }
  const freshnessMs = workerLastRunAt ? Date.now() - new Date(workerLastRunAt).getTime() : null;
  const workerFresh = adapter === "demo" || (freshnessMs !== null && freshnessMs <= 5 * 60 * 1000);
  const ready = missing.length === 0 && migrationReady;
  return NextResponse.json({
    ok: ready,
    status: ready && workerFresh ? "ready" : "degraded",
    correlationId,
    adapter,
    readiness: {
      appConfig: configured("APP_URL"),
      supabaseConfigured: adapter === "demo" || (publicEnv.url !== null && publicEnv.publishableKey !== null && configured("SUPABASE_SECRET_KEY")),
      migration: migrationReady,
      /* Names only: the outbox worker refuses to claim email work while the
         sender cannot be constructed (RESEND_API_KEY / EMAIL_FROM). */
      email: { ready: emailReadiness.ready, missing: emailReadiness.missing },
      missing,
    },
    worker: { fresh: workerFresh, lastRunAt: workerLastRunAt },
  }, { status: ready && workerFresh ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });
}
