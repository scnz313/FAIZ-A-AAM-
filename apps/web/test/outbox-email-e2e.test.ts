// @vitest-environment node

/**
 * Real local end-to-end harness for the email outbox lifecycle.
 *
 * A node `http` server emulates the Resend API over a real socket; the worker
 * uses the production `createResendSender` with `RESEND_API_URL` pointed at
 * that stub, so the HTTP boundary (auth header, idempotency key, payload,
 * status mapping) is exercised for real. The stateful harness models the
 * database surface (claim/mark/fail RPCs, deliveries, suppressions) with the
 * migration semantics.
 */

import http from "node:http";
import type { IncomingHttpHeaders } from "node:http";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET as healthGet } from "@/app/api/health/route";
import { createResendSender } from "@/lib/email/resend";
import { processOutboxBatch } from "@/lib/supabase/outbox-worker";
import { createOutboxHarness, type OutboxHarness } from "./outbox-email-harness";

type StubRequest = { method: string; url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> };
type StubReply = { status: number; body: Record<string, unknown> };

function startResendStub() {
  const requests: StubRequest[] = [];
  const script: StubReply[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        body = {};
      }
      requests.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body });
      const reply = script.shift() ?? { status: 200, body: { id: `resend-${requests.length}` } };
      response.writeHead(reply.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(reply.body));
    });
  });
  return new Promise<{ port: number; requests: StubRequest[]; script: StubReply[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        requests,
        script,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
const EVENT_KEY = "security.link_capabilities:LNK-1";
const SECOND_ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";

let stub: Awaited<ReturnType<typeof startResendStub>>;
let harness: OutboxHarness;

beforeAll(async () => {
  stub = await startResendStub();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(() => {
  harness = createOutboxHarness();
  stub.requests.length = 0;
  stub.script.length = 0;
  vi.stubEnv("FASS_DATA_ADAPTER", "demo");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
  vi.stubEnv("APP_URL", "https://school.example.test");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM", "office@example.test");
  vi.stubEnv("RESEND_API_URL", `http://127.0.0.1:${stub.port}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("outbox email lifecycle against a local Resend stub", () => {
  it("claims, sends through the HTTP provider, and marks the event delivered", async () => {
    harness.seedAccount(ACCOUNT_ID, "family@example.test");
    harness.seedEvent({ event_key: EVENT_KEY, target_type: "user_account", target_reference: ACCOUNT_ID });

    const summary = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });

    expect(summary).toMatchObject({ claimed: 1, delivered: 1, transientFailed: 0, permanentFailed: 0 });
    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/emails");
    expect(request.headers.authorization).toBe("Bearer re_test_key");
    expect(String(request.headers["idempotency-key"])).toMatch(/^delivery:/);
    expect(request.body).toMatchObject({ from: "office@example.test", to: ["family@example.test"] });

    expect(harness.findEvent(EVENT_KEY).status).toBe("delivered");
    const delivery = harness.findDelivery(ACCOUNT_ID);
    expect(delivery.status).toBe("sent");
    expect(delivery.attempts).toBe(1);
    expect(delivery.provider_message_id).toBe("resend-1");
  });

  it("permanently fails a provider 4xx without retrying", async () => {
    stub.script.push({ status: 422, body: { message: "invalid recipient" } });
    harness.seedAccount(ACCOUNT_ID, "family@example.test");
    harness.seedEvent({ event_key: EVENT_KEY, target_type: "user_account", target_reference: ACCOUNT_ID });

    const summary = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });

    expect(summary).toMatchObject({ delivered: 0, permanentFailed: 1, transientFailed: 0 });
    const event = harness.findEvent(EVENT_KEY);
    expect(event.status).toBe("failed");
    expect(event.last_error?.startsWith("Permanent:")).toBe(true);
    const delivery = harness.findDelivery(ACCOUNT_ID);
    expect(delivery.status).toBe("failed");
    expect(delivery.failure_class).toBe("permanent");
    expect(delivery.attempts).toBe(1);

    const second = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });
    expect(second.claimed).toBe(0);
    expect(stub.requests).toHaveLength(1);
  });

  it("retries a provider 5xx transiently with attempt increment and backoff, then delivers", async () => {
    stub.script.push({ status: 503, body: { message: "provider unavailable" } });
    harness.seedAccount(ACCOUNT_ID, "family@example.test");
    harness.seedEvent({ event_key: EVENT_KEY, target_type: "user_account", target_reference: ACCOUNT_ID });

    const first = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });

    expect(first).toMatchObject({ delivered: 0, transientFailed: 1, permanentFailed: 0 });
    const event = harness.findEvent(EVENT_KEY);
    expect(event.status).toBe("pending");
    expect(event.attempts).toBe(1);
    expect(event.last_error?.startsWith("Permanent:")).toBe(false);
    const eventDelay = new Date(event.next_attempt_at).getTime() - Date.now();
    expect(eventDelay).toBeGreaterThan(55_000);
    expect(eventDelay).toBeLessThanOrEqual(60_000);

    const delivery = harness.findDelivery(ACCOUNT_ID);
    expect(delivery.status).toBe("failed");
    expect(delivery.failure_class).toBe("transient");
    expect(delivery.attempts).toBe(1);
    const deliveryDelay = new Date(delivery.next_attempt_at as string).getTime() - Date.now();
    expect(deliveryDelay).toBeGreaterThan(55_000);
    expect(deliveryDelay).toBeLessThanOrEqual(60_000);

    harness.makeDue(EVENT_KEY);
    const second = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });

    expect(second).toMatchObject({ delivered: 1, transientFailed: 0 });
    expect(harness.findEvent(EVENT_KEY).status).toBe("delivered");
    expect(harness.findDelivery(ACCOUNT_ID).attempts).toBe(2);
    expect(harness.findDelivery(ACCOUNT_ID).status).toBe("sent");
    expect(stub.requests).toHaveLength(2);
    expect(stub.requests[0]!.headers["idempotency-key"]).toBe(stub.requests[1]!.headers["idempotency-key"]);
  });

  it("respects the suppression list without calling the provider", async () => {
    harness.seedAccount(ACCOUNT_ID, "family@example.test");
    harness.seedSuppression("Family@Example.test ", "hard_bounce");
    harness.seedEvent({ event_key: EVENT_KEY, target_type: "user_account", target_reference: ACCOUNT_ID });

    const summary = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });

    expect(summary).toMatchObject({ delivered: 1, permanentFailed: 0 });
    expect(stub.requests).toHaveLength(0);
    const delivery = harness.findDelivery(ACCOUNT_ID);
    expect(delivery.status).toBe("suppressed");
    expect(delivery.failure_class).toBe("suppressed");
    expect(String(delivery.last_error)).toContain("hard_bounce");
    expect(harness.findEvent(EVENT_KEY).status).toBe("delivered");
  });

  it("settles a zero-recipient email event as a delivered skip", async () => {
    harness.seedEvent({ event_key: EVENT_KEY, target_type: "user_account", target_reference: "00000000-0000-4000-8000-0000000000ff" });

    const summary = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });

    expect(summary).toMatchObject({ delivered: 1, skippedNoRecipients: 1, permanentFailed: 0 });
    expect(stub.requests).toHaveLength(0);
    expect(harness.findEvent(EVENT_KEY).status).toBe("delivered");
  });

  it("returns before claiming when email configuration is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    harness.seedEvent({ event_key: EVENT_KEY, target_type: "user_account", target_reference: ACCOUNT_ID });

    const summary = await processOutboxBatch({ admin: harness.admin as never });

    expect(summary.emailConfigMissing).toBe(true);
    expect(summary.claimed).toBe(0);
    expect(harness.rpcCalls).toHaveLength(0);
    const event = harness.findEvent(EVENT_KEY);
    expect(event.status).toBe("pending");
    expect(event.attempts).toBe(0);
  });

  it("treats a staff-invitation event as a no-op instead of emailing the inviter", async () => {
    harness.seedAccount(ACCOUNT_ID, "invitee@example.test");
    harness.seedAccount(SECOND_ACCOUNT_ID, "inviter@example.test");
    harness.rowsFor("account_invitations").push({ reference: "INV-1", account_id: ACCOUNT_ID, created_by_account_id: SECOND_ACCOUNT_ID });
    harness.seedEvent({ event_key: "email.staff_invitation:INV-1", target_type: "account_invitation", target_reference: "INV-1" });

    const summary = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });

    expect(stub.requests).toHaveLength(0);
    expect(summary.skippedNoRecipients).toBe(1);
    expect(harness.findEvent("email.staff_invitation:INV-1").status).toBe("delivered");
  });

  it("emails an accountless public applicant the exact decision reason", async () => {
    const applicationId = "00000000-0000-4000-8000-000000000777";
    const reason = "We required a B.Ed. qualification for this position.";
    harness.rowsFor("job_applications").push({
      id: applicationId,
      reference: "JOB-2026-PUBLIC",
      owner_account_id: null,
      applicant_email: "candidate@example.test",
    });
    harness.rowsFor("job_application_decisions").push({ application_id: applicationId, version: 2, action: "not_selected", reason });
    harness.seedEvent({
      event_key: "email.job_status:JOB-2026-PUBLIC:v2",
      target_type: "job_application",
      target_reference: "JOB-2026-PUBLIC",
      payload: { channel: "email", status: "not_selected" },
    });

    const summary = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });

    expect(summary).toMatchObject({ claimed: 1, delivered: 1, transientFailed: 0, permanentFailed: 0 });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.body).toMatchObject({ to: ["candidate@example.test"] });
    expect(JSON.stringify(stub.requests[0]!.body)).toContain(reason);
    expect(harness.findEvent("email.job_status:JOB-2026-PUBLIC:v2").status).toBe("delivered");
    const delivery = harness.rowsFor("notification_deliveries")[0]!;
    expect(delivery.recipient_account_id).toBeNull();
    expect(delivery.recipient_contact).toBe("candidate@example.test");
  });

  it("keeps an event pending while a recipient delivery is still inside backoff", async () => {
    harness.seedStudentWithGuardians({ id: "student-1", reference: "STU-1" }, [
      { accountId: ACCOUNT_ID, contact: "first@example.test" },
      { accountId: SECOND_ACCOUNT_ID, contact: "second@example.test" },
    ]);
    const event = harness.seedEvent({ event_key: "email.results_published:RP-1", target_type: "students", target_reference: "STU-1" });
    harness.rowsFor("notification_deliveries").push(
      {
        id: "00000000-0000-4000-8000-0000000000d1",
        event_id: event.id,
        recipient_account_id: ACCOUNT_ID,
        channel: "email",
        template_version: "v1",
        status: "sent",
        attempts: 1,
        failure_class: null,
        next_attempt_at: null,
        provider_message_id: "resend-existing",
      },
      {
        id: "00000000-0000-4000-8000-0000000000d2",
        event_id: event.id,
        recipient_account_id: SECOND_ACCOUNT_ID,
        channel: "email",
        template_version: "v1",
        status: "failed",
        attempts: 1,
        failure_class: "transient",
        next_attempt_at: new Date(Date.now() + 55_000).toISOString(),
        provider_message_id: null,
      },
    );

    const summary = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });

    expect(summary).toMatchObject({ delivered: 0, transientFailed: 1 });
    expect(stub.requests).toHaveLength(0);
    expect(harness.findEvent("email.results_published:RP-1").status).toBe("pending");
    expect(harness.findDelivery(SECOND_ACCOUNT_ID).attempts).toBe(1);
    expect(harness.findDelivery(SECOND_ACCOUNT_ID).status).toBe("failed");
  });

  it("leaves a scheduled content event unclaimed until its due time", async () => {
    const eventKey = "content.publish:NOT-9:1";
    harness.seedEvent({
      event_key: eventKey,
      kind: "content.publish",
      target_type: "notice",
      target_reference: "NOT-9",
      next_attempt_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      payload: { version: 1 },
    });

    const first = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });
    expect(first.claimed).toBe(0);
    expect(harness.findEvent(eventKey).status).toBe("pending");

    harness.makeDue(eventKey);
    const second = await processOutboxBatch({ admin: harness.admin as never, sender: createResendSender() });
    expect(second.claimed).toBe(1);
    expect(second.delivered).toBe(1);
    expect(harness.findEvent(eventKey).status).toBe("delivered");
  });

  it("reports email provider readiness by name only through /api/health", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");

    const response = await healthGet(new NextRequest("http://localhost/api/health"));
    const body = (await response.json()) as { readiness: { email: { ready: boolean; missing: string[] } } };

    expect(body.readiness.email).toEqual({ ready: false, missing: ["RESEND_API_KEY", "EMAIL_FROM"] });
    expect(body).not.toHaveProperty("RESEND_API_KEY");
    expect(body).not.toHaveProperty("SUPABASE_SECRET_KEY");
  });
});
