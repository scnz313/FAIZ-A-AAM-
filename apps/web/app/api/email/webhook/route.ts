import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/supabase/outbox-worker";

/**
 * Verified Resend webhook (plan.md §9).
 *
 * Rules enforced here:
 * - HMAC-SHA256 signature verification over `${svix-id}.${timestamp}.${body}`
 *   (Resend/Svix format) before any payload is trusted; timestamp drift is
 *   rejected.
 * - `svix-id` is unique (`resend_webhook_events`): at-least-once and
 *   out-of-order deliveries are deduplicated before any side effect.
 * - Bounce/complaint events disable further non-essential mail via
 *   `email_suppressions` (hashed address).
 * - Delivery failure never changes the underlying application, payment,
 *   result, timetable, or support state.
 */

function verifySignature(secret: string, body: string, header: string | null, svixId: string | null, timestamp: string | null): boolean {
  if (header === null || svixId === null || timestamp === null) return false;
  const parts = header.split(",");
  const versionPart = parts.find((part) => part.startsWith("v1="));
  if (versionPart === undefined) return false;
  const signature = versionPart.slice(3);

  const signedContent = `${svixId}.${timestamp}.${body}`;
  const expectedHmac = createHmac("sha256", secret).update(signedContent).digest();
  const provided = Buffer.from(signature, "base64");
  if (provided.length !== expectedHmac.length) return false;
  return timingSafeEqual(provided, expectedHmac);
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim() || null;
  if (webhookSecret === null) {
    return NextResponse.json({ ok: false, error: "RESEND_WEBHOOK_SECRET is not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!verifySignature(webhookSecret, rawBody, svixSignature, svixId, svixTimestamp)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    type?: string;
    data?: { email_id?: string; to?: string[]; created_at?: string };
  };
  const eventType = payload.type ?? "unknown";
  const payloadHash = sha256(rawBody);

  const admin = createSupabaseAdminClient();

  // At-least-once dedup BEFORE any side effect.
  const { error: dedupError } = await admin.from("resend_webhook_events").insert({
    svix_id: svixId ?? "",
    event_time: payload.data?.created_at ?? new Date().toISOString(),
    event_type: eventType,
    payload_hash: payloadHash,
    normalized: payload,
  });
  if (dedupError !== null) {
    if (dedupError.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ ok: false, error: dedupError.message }, { status: 500 });
  }

  const emailId = payload.data?.email_id;
  if (typeof emailId === "string" && emailId.length > 0) {
    const status = eventType.includes("bounced")
      ? "bounced"
      : eventType.includes("complained")
        ? "complained"
        : eventType.includes("delivered")
          ? "delivered"
          : null;
    if (status !== null) {
      const { error: updateError } = await admin
        .from("notification_deliveries")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("provider_message_id", emailId);
      if (updateError !== null) {
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }

      if (status === "bounced" || status === "complained") {
        const address = payload.data?.to?.[0] ?? null;
        if (typeof address === "string" && address.length > 0) {
          const { error: suppressionError } = await admin.from("email_suppressions").upsert(
            {
              email_hash: sha256(address.toLowerCase().trim()),
              reason: status === "bounced" ? "hard_bounce" : "complaint",
              created_by_account_id: null,
              note: `webhook ${eventType}`,
            },
            { onConflict: "email_hash", ignoreDuplicates: true },
          );
          if (suppressionError !== null) {
            return NextResponse.json({ ok: false, error: suppressionError.message }, { status: 500 });
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
