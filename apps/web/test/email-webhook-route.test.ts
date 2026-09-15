// @vitest-environment node

/**
 * Route-level Resend webhook test: real Svix signatures are verified by the
 * official verifier, and the projection is driven against the stateful
 * harness (the admin client module is mocked because the route constructs it
 * directly from server environment).
 */

import { createHash, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Webhook } from "svix";

import { createOutboxHarness, type OutboxHarness } from "./outbox-email-harness";

const adminRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => adminRef.current,
}));

import { POST as webhookPost } from "@/app/api/email/webhook/route";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const PROVIDER_MESSAGE_ID = "msg_1";
const RECIPIENT = "guardian@example.test";

let harness: OutboxHarness;

beforeEach(() => {
  harness = createOutboxHarness();
  adminRef.current = harness.admin;
  vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function seedDelivery(overrides: Record<string, unknown> = {}): void {
  harness.rowsFor("notification_deliveries").push({
    id: randomUUID(),
    event_id: randomUUID(),
    recipient_account_id: randomUUID(),
    channel: "email",
    template_version: "v1",
    provider_message_id: PROVIDER_MESSAGE_ID,
    status: "sent",
    attempts: 1,
    last_error: null,
    failure_class: null,
    provider_event_at: null,
    provider_event_rank: 0,
    next_attempt_at: null,
    ...overrides,
  });
}

function signedRequest(input: {
  svixId: string;
  body: Record<string, unknown>;
  signatureOverride?: string;
  at?: Date;
}): NextRequest {
  const raw = JSON.stringify(input.body);
  const at = input.at ?? new Date();
  const signature = input.signatureOverride ?? new Webhook(SECRET).sign(input.svixId, at, raw);
  return new NextRequest("http://localhost/api/email/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": input.svixId,
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": signature,
    },
    body: raw,
  });
}

function bounceBody(bounceType: string, subType: string): Record<string, unknown> {
  return {
    type: "email.bounced",
    data: {
      email_id: PROVIDER_MESSAGE_ID,
      to: [RECIPIENT],
      created_at: "2026-09-11T00:00:00.000Z",
      bounce: { type: bounceType, subType },
    },
  };
}

describe("Resend webhook route", () => {
  it("records a transient bounce as retryable on the delivery row", async () => {
    seedDelivery();

    const response = await webhookPost(signedRequest({ svixId: "evt-transient", body: bounceBody("Transient", "MailboxFull") }));
    expect(response.status).toBe(200);

    const delivery = harness.rowsFor("notification_deliveries")[0]!;
    expect(delivery.status).toBe("failed");
    expect(delivery.provider_event_rank).toBe(15);
    expect(delivery.failure_class).toBe("transient");
    expect(harness.rowsFor("email_suppressions")).toHaveLength(0);
    const receipt = harness.rowsFor("resend_webhook_events")[0]!;
    expect(receipt.status).toBe("processed");
    expect(receipt.event_type).toBe("email.bounced");
  });

  it("records a permanent bounce as terminal and suppresses only the hash", async () => {
    seedDelivery();

    const response = await webhookPost(signedRequest({ svixId: "evt-permanent", body: bounceBody("Permanent", "NoEmail") }));
    expect(response.status).toBe(200);

    const delivery = harness.rowsFor("notification_deliveries")[0]!;
    expect(delivery.status).toBe("bounced");
    expect(delivery.provider_event_rank).toBe(40);
    expect(delivery.failure_class).toBe("permanent");
    const suppressions = harness.rowsFor("email_suppressions");
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]!.reason).toBe("hard_bounce");
    expect(suppressions[0]!.email_hash).toBe(createHash("sha256").update(RECIPIENT).digest("hex"));
    expect(JSON.stringify(suppressions)).not.toContain(RECIPIENT);
  });

  it("keeps delivery projections monotonic and ignores out-of-order regressions", async () => {
    seedDelivery({ status: "bounced", provider_event_rank: 40, failure_class: "permanent" });
    await webhookPost(signedRequest({
      svixId: "evt-late-delivered",
      body: { type: "email.delivered", data: { email_id: PROVIDER_MESSAGE_ID, to: [RECIPIENT], created_at: "2026-09-11T00:01:00.000Z" } },
    }));
    expect(harness.rowsFor("notification_deliveries")[0]!.status).toBe("bounced");

    const harnessTwo = createOutboxHarness();
    adminRef.current = harnessTwo.admin;
    harnessTwo.rowsFor("notification_deliveries").push({
      id: randomUUID(),
      event_id: randomUUID(),
      recipient_account_id: randomUUID(),
      channel: "email",
      template_version: "v1",
      provider_message_id: PROVIDER_MESSAGE_ID,
      status: "delivered",
      attempts: 1,
      failure_class: null,
      provider_event_at: "2026-09-11T00:01:00.000Z",
      provider_event_rank: 30,
      next_attempt_at: null,
    });
    await webhookPost(signedRequest({
      svixId: "evt-late-delayed",
      body: { type: "email.delivery_delayed", data: { email_id: PROVIDER_MESSAGE_ID, to: [RECIPIENT], created_at: "2026-09-11T00:00:30.000Z" } },
    }));
    expect(harnessTwo.rowsFor("notification_deliveries")[0]!.status).toBe("delivered");
    expect(harnessTwo.rowsFor("notification_deliveries")[0]!.provider_event_rank).toBe(30);
  });

  it("rejects an invalid Svix signature before any projection", async () => {
    seedDelivery();

    const response = await webhookPost(signedRequest({
      svixId: "evt-bad-signature",
      body: bounceBody("Permanent", "NoEmail"),
      signatureOverride: "v1,deadbeef",
    }));

    expect(response.status).toBe(401);
    expect(harness.rowsFor("resend_webhook_events")).toHaveLength(0);
    expect(harness.rowsFor("notification_deliveries")[0]!.status).toBe("sent");
    expect(harness.rowsFor("email_suppressions")).toHaveLength(0);
  });

  it("acknowledges a duplicate svix-id without projecting twice", async () => {
    seedDelivery();
    const body = bounceBody("Permanent", "NoEmail");

    const first = await webhookPost(signedRequest({ svixId: "evt-duplicate", body }));
    const second = await webhookPost(signedRequest({ svixId: "evt-duplicate", body }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true });
    expect(harness.rowsFor("resend_webhook_events")).toHaveLength(1);
    expect(harness.rowsFor("email_suppressions")).toHaveLength(1);
  });
});
