// @vitest-environment node
/**
 * Contract tests for the outbox service demo adapter
 * (modules/services/outbox.ts). Verifies idempotent enqueue,
 * append-only storage, pending→delivered transition, and
 * unknown-id rejection. The clock is pinned and the outbox
 * session is cleared between tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  clearOutboxSession,
  enqueueOutboxEvent,
  listOutboxEvents,
  listPendingOutboxEvents,
  markOutboxEventDelivered,
  OUTBOX_SESSION_KEY_EXPORT,
} from "@/modules/services/outbox";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T12:00:00Z");

beforeEach(() => {
  setDemoNow(PINNED);
  clearOutboxSession();
  sessionRemove(OUTBOX_SESSION_KEY_EXPORT);
});

afterEach(() => {
  setDemoNow(null);
  clearOutboxSession();
  sessionRemove(OUTBOX_SESSION_KEY_EXPORT);
});

describe("enqueueOutboxEvent", () => {
  it("creates a pending event with deterministic timestamp", () => {
    const event = enqueueOutboxEvent({
      eventId: "evt-001",
      kind: "payment.posted",
      targetRef: "INV-2026-0301",
      actor: "A. Lone",
    });

    expect(event.eventId).toBe("evt-001");
    expect(event.kind).toBe("payment.posted");
    expect(event.targetRef).toBe("INV-2026-0301");
    expect(event.actor).toBe("A. Lone");
    expect(event.createdAtIso).toBe(PINNED.toISOString());
    expect(event.status).toBe("pending");
    expect(event.deliveredAtIso).toBeNull();
  });

  it("is idempotent by eventId — same id returns the existing record", () => {
    const first = enqueueOutboxEvent({
      eventId: "evt-001",
      kind: "link.approved",
      targetRef: "LINK-001",
      actor: "A. Lone",
    });
    const second = enqueueOutboxEvent({
      eventId: "evt-001",
      kind: "link.approved",
      targetRef: "LINK-001",
      actor: "A. Lone",
    });

    expect(second.eventId).toBe(first.eventId);
    expect(listOutboxEvents()).toHaveLength(1);
  });

  it("returns copies — mutating the result does not affect the store", () => {
    const event = enqueueOutboxEvent({
      eventId: "evt-001",
      kind: "results.published",
      targetRef: "RB-2026-0138",
      actor: "S. Bhat",
    });
    event.status = "delivered";

    const stored = listOutboxEvents()[0];
    expect(stored?.status).toBe("pending");
  });
});

describe("listOutboxEvents", () => {
  it("returns events oldest first (insertion order)", () => {
    enqueueOutboxEvent({ eventId: "evt-001", kind: "payment.posted", targetRef: "INV-1", actor: "A" });
    enqueueOutboxEvent({ eventId: "evt-002", kind: "link.approved", targetRef: "LINK-1", actor: "B" });
    enqueueOutboxEvent({ eventId: "evt-003", kind: "results.published", targetRef: "RB-1", actor: "C" });

    const events = listOutboxEvents();
    expect(events.map((e) => e.eventId)).toEqual(["evt-001", "evt-002", "evt-003"]);
  });

  it("returns an empty array when no events exist", () => {
    expect(listOutboxEvents()).toEqual([]);
  });
});

describe("listPendingOutboxEvents", () => {
  it("filters to only pending events", () => {
    enqueueOutboxEvent({ eventId: "evt-001", kind: "payment.posted", targetRef: "INV-1", actor: "A" });
    enqueueOutboxEvent({ eventId: "evt-002", kind: "payment.posted", targetRef: "INV-2", actor: "B" });
    markOutboxEventDelivered("evt-001");

    const pending = listPendingOutboxEvents();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.eventId).toBe("evt-002");
  });
});

describe("markOutboxEventDelivered", () => {
  it("transitions a pending event to delivered with a timestamp", () => {
    enqueueOutboxEvent({ eventId: "evt-001", kind: "payment.posted", targetRef: "INV-1", actor: "A" });
    const delivered = markOutboxEventDelivered("evt-001");

    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAtIso).toBe(PINNED.toISOString());
  });

  it("is idempotent for already-delivered events", () => {
    enqueueOutboxEvent({ eventId: "evt-001", kind: "payment.posted", targetRef: "INV-1", actor: "A" });
    markOutboxEventDelivered("evt-001");
    const second = markOutboxEventDelivered("evt-001");

    expect(second.status).toBe("delivered");
  });

  it("throws for unknown event ids", () => {
    expect(() => markOutboxEventDelivered("nonexistent")).toThrow(/No outbox event/);
  });
});

describe("outbox retry safety — duplicate delivery is a single effect (S4)", () => {
  it("re-marking delivered never duplicates the record or refreshes its timestamp", () => {
    enqueueOutboxEvent({ eventId: "evt-001", kind: "payment.posted", targetRef: "INV-1", actor: "A" });
    const first = markOutboxEventDelivered("evt-001");

    setDemoNow(new Date(PINNED.getTime() + 60 * 60 * 1000));
    const second = markOutboxEventDelivered("evt-001");

    expect(listOutboxEvents()).toHaveLength(1);
    expect(second.status).toBe("delivered");
    expect(second.deliveredAtIso).toBe(first.deliveredAtIso);
    expect(listPendingOutboxEvents()).toHaveLength(0);
  });

  it("retrying an enqueue with the same id never mutates the original effect", () => {
    const first = enqueueOutboxEvent({
      eventId: "evt-001",
      kind: "payment.posted",
      targetRef: "INV-1",
      actor: "A",
    });
    const retry = enqueueOutboxEvent({
      eventId: "evt-001",
      kind: "link.approved",
      targetRef: "OTHER",
      actor: "B",
    });

    expect(retry).toEqual(first);
    expect(listOutboxEvents()).toHaveLength(1);
    expect(listOutboxEvents()[0]).toMatchObject({
      kind: "payment.posted",
      targetRef: "INV-1",
      actor: "A",
      status: "pending",
    });
  });
});
