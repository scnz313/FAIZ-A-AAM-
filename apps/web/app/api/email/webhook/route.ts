import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/supabase/outbox-worker";
import { deliveryFailureClass, deliveryProjection, normalizedWebhookPayload, verifyResendWebhook, webhookSuppressionReason, type ResendPayload } from "@/lib/email/webhook";
import { providerLog } from "@/lib/observability/log";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status = 200, correlationId = crypto.randomUUID()) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId },
  });
}

async function projectDelivery(
  admin: SupabaseClient,
  payload: ResendPayload,
  eventType: string,
  eventAt: string,
): Promise<void> {
  const emailId = payload.data?.email_id;
  const projection = deliveryProjection(eventType, payload);
  if (projection !== null && typeof emailId === "string" && emailId.length > 0) {
    const { data: delivery } = await admin
      .from("notification_deliveries")
      .select("id, status, provider_event_at, provider_event_rank")
      .eq("provider_message_id", emailId)
      .maybeSingle();
    if (delivery !== null) {
      const currentAt = delivery.provider_event_at ? new Date(delivery.provider_event_at).getTime() : 0;
      const nextAt = new Date(eventAt).getTime();
      const isNewer = projection.rank > delivery.provider_event_rank || (projection.rank === delivery.provider_event_rank && nextAt >= currentAt);
      if (isNewer) {
        const { error } = await admin.from("notification_deliveries").update({
          status: projection.status,
          provider_event_at: eventAt,
          provider_event_rank: projection.rank,
          failure_class: deliveryFailureClass(projection),
          updated_at: new Date().toISOString(),
        }).eq("id", delivery.id);
        if (error !== null) throw new Error("delivery status could not be recorded");
      }
    }
  }

  const suppressionReason = webhookSuppressionReason(payload, eventType);
  if (suppressionReason !== null) {
    for (const address of payload.data?.to ?? []) {
      if (typeof address !== "string" || address.trim().length === 0) continue;
      const { error } = await admin.from("email_suppressions").upsert({
        email_hash: sha256(address.toLowerCase().trim()),
        reason: suppressionReason,
        created_by_account_id: null,
        note: `resend webhook ${eventType}`,
      }, { onConflict: "email_hash", ignoreDuplicates: true });
      if (error !== null) throw new Error("email suppression could not be recorded");
    }
  }
}

/** Resend/Svix ingestion. Failed receipts remain retryable. */
export async function POST(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim() || null;
  if (webhookSecret === null) return response({ ok: false, error: "Webhook delivery is not configured." }, 503, correlationId);

  const rawBody = await request.text();
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!verifyResendWebhook(webhookSecret, rawBody, { id: svixId, timestamp: svixTimestamp, signature: svixSignature })) {
    return response({ ok: false, error: "invalid signature" }, 401, correlationId);
  }
  if (svixId === null || svixTimestamp === null) return response({ ok: false, error: "invalid webhook headers" }, 400, correlationId);

  let payload: ResendPayload;
  try {
    payload = JSON.parse(rawBody) as ResendPayload;
  } catch {
    return response({ ok: false, error: "invalid payload" }, 400, correlationId);
  }
  const eventType = typeof payload.type === "string" ? payload.type : "unknown";
  const eventAt = typeof payload.data?.created_at === "string" && Number.isFinite(new Date(payload.data.created_at).getTime())
    ? new Date(payload.data.created_at).toISOString()
    : new Date().toISOString();
  const payloadHash = sha256(rawBody);
  const normalized = normalizedWebhookPayload(payload, eventType, eventAt);
  const admin = createSupabaseAdminClient();
  const db = admin as unknown as SupabaseClient;

  const { data: existing, error: existingError } = await db.from("resend_webhook_events").select("id, status, attempts").eq("svix_id", svixId).maybeSingle();
  if (existingError !== null) return response({ ok: false, error: "Webhook receipt lookup failed." }, 500, correlationId);
  if (existing?.status === "processed") return response({ ok: true, duplicate: true }, 200, correlationId);

  let receipt: { id: string; status: string; attempts: number } | null = null;
  if (existing !== null) {
    const { data: updated, error } = await db.from("resend_webhook_events").update({ status: "processing", attempts: existing.attempts + 1, last_error: null, next_attempt_at: null }).eq("id", existing.id).select("id, status, attempts").single();
    if (error !== null || updated === null) return response({ ok: false, error: "Webhook receipt could not be claimed." }, 500, correlationId);
    receipt = updated;
  } else {
    const { data: inserted, error } = await db.from("resend_webhook_events").insert({
      svix_id: svixId,
      event_time: eventAt,
      event_type: eventType,
      payload_hash: payloadHash,
      normalized,
      status: "processing",
      attempts: 1,
      received_at: new Date().toISOString(),
    }).select("id, status, attempts").single();
    if (error !== null || inserted === null) {
      if (error?.code === "23505") return response({ ok: true, duplicate: true }, 200, correlationId);
      return response({ ok: false, error: "Webhook event could not be recorded." }, 500, correlationId);
    }
    receipt = inserted;
  }

  try {
    await projectDelivery(db, payload, eventType, eventAt);
    const { error } = await db.from("resend_webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), next_attempt_at: null }).eq("id", receipt.id);
    if (error !== null) throw new Error("webhook receipt could not be completed");
    providerLog({ event: "resend.webhook", correlationId, outcome: "succeeded", targetType: eventType, targetReference: svixId });
    return response({ ok: true }, 200, correlationId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "webhook projection failed";
    await db.from("resend_webhook_events").update({ status: "failed", last_error: detail.slice(0, 500), next_attempt_at: new Date(Date.now() + 60_000).toISOString() }).eq("id", receipt.id);
    providerLog({ event: "resend.webhook", correlationId, outcome: "failed", targetType: eventType, targetReference: svixId });
    return response({ ok: false, error: "Webhook projection failed; retry will be accepted." }, 500, correlationId);
  }
}
