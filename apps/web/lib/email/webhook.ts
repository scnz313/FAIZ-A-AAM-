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

