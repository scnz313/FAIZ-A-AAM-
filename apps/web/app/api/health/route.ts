import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter, supabasePublicEnv } from "@/lib/supabase/env";

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

  const required = adapter === "supabase"
    ? ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "APP_URL", "CRON_SECRET", "RESEND_API_KEY", "EMAIL_FROM", "RESEND_WEBHOOK_SECRET", "DOCUMENT_SCANNER_URL", "DOCUMENT_SCANNER_SECRET"]
    : ["APP_URL"];
  const missing = required.filter((name) => !configured(name));
  const publicEnv = supabasePublicEnv();
  let migrationReady = adapter === "demo";
  let workerLastRunAt: string | null = null;
  if (adapter === "supabase" && missing.length === 0) {
    try {
      const admin = createSupabaseAdminClient();
      const db = admin as unknown as SupabaseClient;
      const [schemaProbe, latestRun] = await Promise.all([
        db.from("provider_jobs").select("id").limit(1),
        db.from("job_runs").select("finished_at, status").eq("job_name", "outbox").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      migrationReady = schemaProbe.error === null;
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
      missing,
    },
    worker: { fresh: workerFresh, lastRunAt: workerLastRunAt },
  }, { status: ready && workerFresh ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });
}
