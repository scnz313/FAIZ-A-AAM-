/**
 * Minimal Resend adapter (plan.md §9: application email).
 *
 * Uses the Resend REST API over fetch — no SDK dependency. Rules enforced:
 * - The API key is server-only (`RESEND_API_KEY` in `.env.local`, never
 *   NEXT_PUBLIC_ and never in `.env.example`).
 * - Delivery idempotency is provided by the caller through the
 *   `notification_deliveries` unique constraint; the Resend `Idempotency-Key`
 *   header is derived from that record.
 * - Subjects and previews contain no marks, fee balances, medical details, or
 *   sensitive applicant information (plan.md §9).
 * - Full payloads, addresses, and keys are never logged.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailAddress = string;

export type SendEmailInput = {
  to: EmailAddress[];
  subject: string;
  html: string;
  /** Resend idempotency key (derived from the notification_delivery row). */
  idempotencyKey: string;
};

export type SendEmailResult = { providerMessageId: string };

export type EmailSender = (input: SendEmailInput) => Promise<SendEmailResult>;

/** Server-only Resend sender. Throws typed errors; callers map them. */
export function createResendSender(): EmailSender {
  const apiKey = process.env.RESEND_API_KEY?.trim() || null;
  const from = process.env.EMAIL_FROM?.trim() || null;
  if (apiKey === null) {
    throw new Error("RESEND_API_KEY is not configured on the server.");
  }
  if (from === null) {
    throw new Error("EMAIL_FROM is not configured on the server.");
  }

  return async (input) => {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status >= 200 && response.status < 300) {
      const body = (await response.json()) as { id?: string };
      if (typeof body.id !== "string" || body.id.length === 0) {
        throw new Error("Permanent:Resend accepted the message without an id");
      }
      return { providerMessageId: body.id };
    }

    // Resend rate limits (429) and every 5xx response are retryable. Other
    // 4xx responses are permanent recipient/from/payload failures.
    const permanent = response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status);
    throw new Error(`${permanent ? "Permanent" : "Transient"}:Resend ${response.status}`);
  };
}

/** Test sender that records calls (used by worker tests and the staging
 *  integration script — never in production paths). */
export function createRecordingSender(records: SendEmailInput[] = []): EmailSender {
  return async (input) => {
    records.push(input);
    return { providerMessageId: `test-${records.length}` };
  };
}
