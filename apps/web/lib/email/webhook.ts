import { createHash } from "node:crypto";
import { Webhook } from "svix";

/** Resend/Svix header names preserved from the raw request. */
export type ResendWebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

/**
 * Verify the untouched Resend request body with the official Svix verifier.
 * The boundary deliberately returns only a boolean so provider diagnostics,
 * payloads, and secrets never escape into route responses or logs.
 */
export function verifyResendWebhook(
  secret: string,
  rawBody: string,
  headers: ResendWebhookHeaders,
): boolean {
  if (!secret.trim() || !rawBody || !headers.id || !headers.timestamp || !headers.signature) return false;
  /* svix 1.99.x hardcodes a five-minute timestamp tolerance and exposes no
   * override, so older-but-unseen receipts are rejected here and must be
   * replayed from the provider rather than accepted on trust. */
  try {
    new Webhook(secret).verify(rawBody, {
      "svix-id": headers.id,
      "svix-timestamp": headers.timestamp,
      "svix-signature": headers.signature,
    });
    return true;
  } catch {
    return false;
  }
}

export type ResendPayload = {
  type?: string;
  data?: {
    email_id?: string;
    to?: string[];
    created_at?: string;
    bounce?: { type?: string; subType?: string };
  };
};

export function deliveryProjection(eventType: string, payload?: ResendPayload): { status: string; rank: number } | null {
  const type = eventType.toLowerCase();
  if (type.includes("bounced")) {
    /* A transient bounce is a soft failure the provider may retry. Ranking it
     * terminal would let it outrank a later delivered event and would push a
     * retryable address into the permanent failure path. */
    if (payload?.data?.bounce?.type?.trim().toLowerCase() === "transient") return { status: "failed", rank: 15 };
    return { status: "bounced", rank: 40 };
  }
  if (type.includes("complained") || type.includes("complaint")) return { status: "complained", rank: 40 };
  if (type.includes("suppressed")) return { status: "suppressed", rank: 40 };
  if (type.includes("delivered")) return { status: "delivered", rank: 30 };
  if (type.includes("delivery_delayed") || type.includes("delayed")) return { status: "failed", rank: 10 };
  if (type.includes("failed") || type.includes("failure")) return { status: "failed", rank: 20 };
  return null;
}

/** Terminal webhook projections carry a permanent failure class so a delivery
 *  is never retried after a hard bounce, complaint, or suppression. A
 *  transient bounce or delayed delivery keeps a retryable class; delivered
 *  projections clear it. */
export function deliveryFailureClass(projection: { status: string; rank: number } | null): "permanent" | "provider" | "transient" | null {
  if (projection === null || projection.status === "delivered") return null;
  if (projection.rank >= 40) return "permanent";
  if (projection.status === "failed" && projection.rank >= 20) return "provider";
  return "transient";
}

export function webhookSuppressionReason(payload: ResendPayload, eventType: string): "hard_bounce" | "complaint" | null {
  const projection = deliveryProjection(eventType, payload);
  if (projection?.status === "complained") return "complaint";
  if (projection?.status === "suppressed") return "hard_bounce";
  if (projection?.status === "bounced" && payload.data?.bounce?.type?.trim().toLowerCase() !== "transient") return "hard_bounce";
  return null;
}

export function normalizedWebhookPayload(payload: ResendPayload, eventType: string, eventAt: string) {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return {
    type: eventType,
    eventAt,
    emailId: typeof payload.data?.email_id === "string" ? payload.data.email_id : null,
    recipientHashes: (payload.data?.to ?? []).filter((address): address is string => typeof address === "string").map((address) => hash(address.toLowerCase().trim())),
    bounceType: payload.data?.bounce?.type ?? null,
    bounceSubType: payload.data?.bounce?.subType ?? null,
  };
}

