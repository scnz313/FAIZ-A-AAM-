import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCronSecretEnv } from "@/lib/supabase/env";
import { processOutboxBatch } from "@/lib/supabase/outbox-worker";

/**
 * Protected outbox dispatcher (plan.md §8, §11 B6/B8).
 *
 * Called by the platform scheduler (Vercel Cron) with
 * `Authorization: Bearer <CRON_SECRET>`. Claims a bounded batch of due
 * outbox work, dispatches email/PDF jobs, and transitions each event with
 * delivered / exponential-retry semantics. Returns the worker summary; the
 * domain records never change because a delivery failed.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim() || null;
  if (cronSecret === null) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const headerSecret = request.headers.get("x-cron-secret") ?? "";
  if (bearer !== cronSecret && headerSecret !== cronSecret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const summary = await processOutboxBatch({ admin, batchSize: 20 });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "outbox processing failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Health probe for the scheduler: same secret, no side effects. */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim() || null;
  if (cronSecret === null) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (bearer !== cronSecret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, service: "outbox" });
}

// Referenced so environments that validate env at boot surface the config.
void requireCronSecretEnv;
