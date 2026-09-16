import { NextResponse } from "next/server";

import { getServerActor } from "@/lib/auth/actor";
import { isSameOrigin } from "@/lib/auth/same-origin";
import { providerLog } from "@/lib/observability/log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { processOutboxBatch } from "@/lib/supabase/outbox-worker";

export const runtime = "nodejs";

/**
 * Administrator-triggered outbox drain for the Deliveries workspace. The
 * daily Vercel cron on /api/outbox stays the safety net; this endpoint lets
 * a system administrator run the same bounded batch on demand without the
 * cron secret. Same session + role + aal2 boundary as the other
 * administrator-only routes.
 */
export async function POST(request: Request) {
  const correlationId = crypto.randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Correlation-Id": correlationId };
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ ok: false, error: "The outbox worker is unavailable in demo mode.", correlationId }, { status: 503, headers });
  }
  if (!isSameOrigin(request.url, request.headers.get("origin"), request.headers.get("host"), request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ ok: false, error: "Cross-origin requests are not accepted.", correlationId }, { status: 403, headers });
  }
  const actor = await getServerActor();
  if (actor === null) {
    return NextResponse.json({ ok: false, error: "Sign in to continue.", correlationId }, { status: 401, headers });
  }
  if (actor.aal !== "aal2" || !actor.roles.includes("system_administrator")) {
    return NextResponse.json({ ok: false, error: "Administrator verification is required.", correlationId }, { status: 403, headers });
  }

  try {
    const startedAt = Date.now();
    const summary = await processOutboxBatch({ admin: createSupabaseAdminClient(), batchSize: 20 });
    providerLog({
      event: "outbox.manual_run",
      correlationId,
      outcome: "succeeded",
      durationMs: Date.now() - startedAt,
      values: { claimed: summary.claimed, delivered: summary.delivered, failed: summary.permanentFailed + summary.transientFailed },
    });
    return NextResponse.json({ ok: true, ...summary }, { headers });
  } catch {
    providerLog({ event: "outbox.manual_run", correlationId, outcome: "failed" });
    return NextResponse.json({ ok: false, error: "Outbox processing failed.", correlationId }, { status: 500, headers });
  }
}
