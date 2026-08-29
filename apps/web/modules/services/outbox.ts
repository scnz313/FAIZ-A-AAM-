/**
 * Deterministic demo outbox (plan.md Phase 4 / FEATURE-INTEGRATION-SPEC.md
 * §5.3): session-backed, append-only, idempotent by event id.
 *
 * Consequential domain writes (payment posted, enrollment converted, result
 * published, notice published, link approved…) enqueue one outbox event here
 * so the eventual delivery work — email/SMS, PDF rendering, projections —
 * has a durable record to retry. Retrying the domain action never duplicates
 * the event: `enqueue` is idempotent by event id, and `markDelivered` is the
 * only transition out of `pending`.
 *
 * The backend replaces this wholesale; the demo exists so the UI phase can
 * prove "one write reaches every intended consumer exactly once" before any
 * provider is chosen.
 */

import { demoNowIso } from "@/modules/demo/clock";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type OutboxEventKind =
  | "link.approved"
  | "link.rejected"
  | "link.revoked"
  | "link.restricted"
  | "link.capabilities.changed"
  | "link.requested"
  | "enrollment.converted"
  | "admissions.withdrawn"
  | "results.published"
  | "results.withdrawn"
  | "content.published"
  | "payment.posted";

export type OutboxEventStatus = "pending" | "delivered";

/**
 * One pending/finished delivery. `eventId` is the idempotency key: the same
 * consequential action (identified by kind + target ref, or an explicit
 * versioned event id) can never enqueue twice.
 */
export type OutboxEvent = {
  eventId: string;
  kind: OutboxEventKind;
  /** The domain record this event describes, e.g. "INV-2026-0301". */
  targetRef: string;
  /** Display-safe actor, e.g. "R. Mir (admissions approver)". */
  actor: string;
  createdAtIso: string;
  status: OutboxEventStatus;
  deliveredAtIso: string | null;
};

/* ------------------------------------------------------------------ */
/* Demo adapter                                                         */
/* ------------------------------------------------------------------ */

const OUTBOX_SESSION_KEY = sessionKey("outbox");

function loadEvents(): OutboxEvent[] {
  return sessionGet<OutboxEvent[]>(OUTBOX_SESSION_KEY) ?? [];
}

function saveEvents(events: OutboxEvent[]): void {
  sessionSet(OUTBOX_SESSION_KEY, events);
}

/**
 * Enqueue a delivery event. Idempotent by `eventId`: enqueuing the same id
 * again returns the existing record and creates nothing. Callers choose the
 * id — a stable `kind:targetRef` for single-shot effects (payment post,
 * conversion, link decisions) or a versioned id when each occurrence is a
 * distinct event (e.g. `results.published:RB-2026-0138:v3`).
 */
export function enqueueOutboxEvent(input: {
  eventId: string;
  kind: OutboxEventKind;
  targetRef: string;
  actor: string;
}): OutboxEvent {
  const events = loadEvents();
  const existing = events.find((event) => event.eventId === input.eventId);
  if (existing !== undefined) return { ...existing };
  const event: OutboxEvent = {
    eventId: input.eventId,
    kind: input.kind,
    targetRef: input.targetRef,
    actor: input.actor,
    createdAtIso: demoNowIso(),
    status: "pending",
    deliveredAtIso: null,
  };
  saveEvents([...events, event]);
  return { ...event };
}

/** All events, oldest first (delivery order). */
export function listOutboxEvents(): OutboxEvent[] {
  return loadEvents().map((event) => ({ ...event }));
}

/** Only the not-yet-delivered events, oldest first. */
export function listPendingOutboxEvents(): OutboxEvent[] {
  return loadEvents()
    .filter((event) => event.status === "pending")
    .map((event) => ({ ...event }));
}

/**
 * Mark one event delivered. Unknown events throw so callers surface the
 * recoverable error instead of silently dropping delivery.
 */
export function markOutboxEventDelivered(eventId: string): OutboxEvent {
  const events = loadEvents();
  const event = events.find((candidate) => candidate.eventId === eventId);
  if (event === undefined) {
    throw new Error(`No outbox event carries the id ${eventId}.`);
  }
  if (event.status === "delivered") return { ...event };
  const next: OutboxEvent = {
    ...event,
    status: "delivered",
    deliveredAtIso: demoNowIso(),
  };
  saveEvents(events.map((candidate) => (candidate.eventId === eventId ? next : candidate)));
  return { ...next };
}

/** Test/support hook: drop the outbox for a clean session. */
export function clearOutboxSession(): void {
  sessionSet(OUTBOX_SESSION_KEY, []);
}

/** Exported so tests can reset the demo outbox deterministically. */
export const OUTBOX_SESSION_KEY_EXPORT = OUTBOX_SESSION_KEY;
