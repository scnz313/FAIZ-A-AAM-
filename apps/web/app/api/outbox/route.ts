import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processOutboxBatch } from "@/lib/supabase/outbox-worker";
import { providerLog } from "@/lib/observability/log";

export const runtime = "nodejs";

/**
 * Protected outbox dispatcher (plan.md §8, §11 B6/B8).
 *
 * Called by the platform scheduler (Vercel Cron) with
 * `Authorization: Bearer <CRON_SECRET>`. Claims a bounded batch of due
 * outbox work, dispatches email/PDF jobs, and transitions each event with
 * delivered / exponential-retry semantics. Returns the worker summary; the
 * domain records never change because a delivery failed.
 */
function authorized(request: NextRequest, secret: string): boolean {
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  const cronSecret = process.env.CRON_SECRET?.trim() || null;
  if (cronSecret === null) {
    return NextResponse.json({ ok: false, error: "Outbox scheduler is not configured.", correlationId }, { status: 503, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });
  }
  if (!authorized(request, cronSecret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });
  }

  try {
    const startedAt = Date.now();
    const admin = createSupabaseAdminClient();
    const summary = await processOutboxBatch({ admin, batchSize: 20 });
    providerLog({ event: "outbox.batch", correlationId, outcome: "succeeded", durationMs: Date.now() - startedAt, values: { claimed: summary.claimed, delivered: summary.delivered, failed: summary.permanentFailed + summary.transientFailed } });
    return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });
  } catch {
    providerLog({ event: "outbox.batch", correlationId, outcome: "failed" });
    return NextResponse.json({ ok: false, error: "Outbox processing failed.", correlationId }, { status: 500, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } });
  }
}

export async function POST(request: NextRequest) {
  return run(request);
}

/** Vercel Cron invokes GET; it is the same bounded, protected worker. */
export async function GET(request: NextRequest) {
  return run(request);
}
