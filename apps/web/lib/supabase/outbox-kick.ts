import "server-only";

import { after } from "next/server";

import { providerLog } from "@/lib/observability/log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataAdapter } from "@/lib/supabase/env";
import { processOutboxBatch } from "@/lib/supabase/outbox-worker";

/**
 * Inline outbox kick: after a successful domain write, schedule a small
 * worker batch to run once the response is sent, so user-facing emails do
 * not wait for the daily cron safety net. Module-level debounce keeps bursts
 * of writes (for example an import commit) from stacking worker runs; the
 * five-second window is shorter than the worker's own claim lease.
 *
 * The demo adapter is a no-op — there is no real outbox to drain.
 */
const KICK_DEBOUNCE_MS = 5_000;
let lastKickStartedAt = Number.NEGATIVE_INFINITY;

export function scheduleOutboxKick(reason: string): void {
  if (dataAdapter() !== "supabase") return;
  const now = Date.now();
  if (now - lastKickStartedAt < KICK_DEBOUNCE_MS) return;
  const correlationId = crypto.randomUUID();
  try {
    after(async () => {
      const startedAt = Date.now();
      try {
        const summary = await processOutboxBatch({ admin: createSupabaseAdminClient(), batchSize: 10 });
        providerLog({
          event: "outbox.kick",
          correlationId,
          outcome: "succeeded",
          durationMs: Date.now() - startedAt,
          values: { reason, claimed: summary.claimed, delivered: summary.delivered },
        });
      } catch {
        providerLog({ event: "outbox.kick", correlationId, outcome: "failed", values: { reason } });
      }
    });
    lastKickStartedAt = now;
  } catch {
    /* `after()` throws outside a request scope (unit tests, non-route
       callers); the kick is best-effort and must never fail the write. */
    providerLog({ event: "outbox.kick", correlationId, outcome: "failed", values: { reason, stage: "schedule" } });
  }
}
