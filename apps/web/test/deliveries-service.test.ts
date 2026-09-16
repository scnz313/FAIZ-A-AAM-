// @vitest-environment jsdom
/**
 * Deliveries service: maps the migration-000124 projection into the typed
 * board model, filters demo rows by event status, and keeps demo writes as
 * honest no-ops (nothing is re-sent in demo mode).
 */
import { describe, expect, it } from "vitest";

import { deliveriesService, mapDeliveriesBoard } from "@/modules/services/deliveries";

const RPC_BOARD = {
  summary: { pending: 2, processing: 1, delivered: 40, failed: 3, deliveriesFailedPermanent: 34 },
  events: [
    {
      eventId: "evt-1",
      eventKey: "email.notice_published:NTC-2026-0001:v2",
      kind: "email.deliver",
      targetType: "notice",
      targetReference: "NTC-2026-0001",
      status: "failed",
      attempts: 10,
      maxAttempts: 10,
      nextAttemptAt: "2026-09-15T00:00:00.000Z",
      lastError: "Permanent: provider rejected sender",
      createdAt: "2026-09-10T08:00:00.000Z",
      deliveredAt: null,
      deliveries: [
        {
          deliveryId: "dlv-1",
          recipientMasked: "fi***@example.test",
          channel: "email",
          status: "failed",
          failureClass: "permanent",
          attempts: 10,
          lastError: "Mailbox unavailable",
          providerMessageId: null,
          updatedAt: "2026-09-10T08:10:00.000Z",
        },
      ],
      providerJobs: [
        { jobId: "job-1", jobKind: "storage_finalize", status: "failed", attempts: 4, nextAttemptAt: null, lastError: "boom" },
      ],
    },
    {
      eventId: "evt-2",
      eventKey: "email.offer:ADM-2026-0003",
      kind: "email.deliver",
      targetType: "admission_application",
      targetReference: "ADM-2026-0003",
      status: "pending",
      attempts: 0,
      maxAttempts: 10,
      nextAttemptAt: "2026-09-15T10:00:00.000Z",
      lastError: null,
      createdAt: "2026-09-15T09:00:00.000Z",
      deliveredAt: null,
      deliveries: [],
    },
  ],
};

describe("mapDeliveriesBoard", () => {
  it("maps the RPC projection to the typed board", () => {
    const board = mapDeliveriesBoard(RPC_BOARD);
    expect(board.summary).toEqual({ pending: 2, processing: 1, delivered: 40, failed: 3, deliveriesFailedPermanent: 34 });
    expect(board.events).toHaveLength(2);
    const failed = board.events[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.deliveries[0]).toMatchObject({
      recipientMasked: "fi***@example.test",
      status: "failed",
      failureClass: "permanent",
      attempts: 10,
    });
    expect(failed.providerJobs[0]).toMatchObject({ jobKind: "storage_finalize", status: "failed" });
  });

  it("normalizes missing and malformed fields to safe defaults", () => {
    const board = mapDeliveriesBoard({ events: [{ eventId: "x", status: "unexpected" }], summary: null });
    expect(board.events[0]?.status).toBe("pending");
    expect(board.events[0]?.deliveries).toEqual([]);
    expect(board.summary.deliveriesFailedPermanent).toBe(0);
  });
});

describe("deliveriesService demo branch", () => {
  it("returns illustrative rows with the honest summary", async () => {
    const board = await deliveriesService.list();
    expect(board.summary.deliveriesFailedPermanent).toBe(1);
    expect(board.events.every((event) => event.deliveries.every((delivery) => delivery.recipientMasked.includes("***")))).toBe(true);
  });

  it("filters demo rows by event status", async () => {
    const board = await deliveriesService.list({ status: "failed" });
    expect(board.events).toHaveLength(1);
    expect(board.events[0]?.status).toBe("failed");
  });

  it("keeps demo writes as no-ops", async () => {
    await expect(deliveriesService.retry({ deliveryId: "demo-dlv-1", reason: "checking the retry path" }))
      .resolves.toEqual({ applied: false });
    await expect(deliveriesService.requeueEvent({ eventId: "demo-evt-1", reason: "checking the requeue path" }))
      .resolves.toEqual({ applied: false });
  });
});
