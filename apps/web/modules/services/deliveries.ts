/**
 * Delivery operations service (Slice 5): the administrator view of the
 * outbox — queued events, masked recipient deliveries, retry/requeue.
 *
 * Supabase mode delegates to the migration-000124 RPCs through the adapter
 * registry (`deliveries.*`). Demo mode returns a small static board so the
 * workspace renders honest illustrative rows; demo writes are no-ops that
 * report `applied: false` rather than pretending to send mail.
 */

import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

/* ------------------------------------------------------------------ */
/* Models (mirror the deliveries_admin_list projection)                */
/* ------------------------------------------------------------------ */

export type DeliveryEventStatus = "pending" | "processing" | "delivered" | "failed";
export type DeliveryStatus = "pending" | "sent" | "delivered" | "bounced" | "complained" | "suppressed" | "failed";
export type DeliveryFilter = "all" | DeliveryEventStatus;

export type DeliveryRow = {
  deliveryId: string;
  /** First two characters + `***` + the domain — never a raw address. */
  recipientMasked: string;
  channel: string;
  status: DeliveryStatus | string;
  failureClass: "permanent" | "transient" | "suppressed" | null;
  attempts: number;
  lastError: string | null;
  providerMessageId: string | null;
  updatedAt: string | null;
};

export type DeliveryProviderJob = {
  jobId: string;
  jobKind: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
};

export type DeliveryEvent = {
  eventId: string;
  eventKey: string;
  kind: string;
  targetType: string;
  targetReference: string;
  status: DeliveryEventStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  deliveries: DeliveryRow[];
  providerJobs: DeliveryProviderJob[];
};

export type DeliveriesSummary = {
  pending: number;
  processing: number;
  delivered: number;
  failed: number;
  deliveriesFailedPermanent: number;
};

export type DeliveriesBoard = {
  events: DeliveryEvent[];
  summary: DeliveriesSummary;
};

export type DeliveryRetryResult = {
  applied: boolean;
  deliveryStatus?: string;
  eventStatus?: string;
};

export type EventRequeueResult = {
  applied: boolean;
  eventStatus?: string;
  providerJobsRequeued?: number;
};

/* ------------------------------------------------------------------ */
/* Projection mapping                                                  */
/* ------------------------------------------------------------------ */

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapDelivery(raw: unknown): DeliveryRow {
  const row = (raw ?? {}) as Record<string, unknown>;
  const failureClass = text(row.failureClass);
  return {
    deliveryId: text(row.deliveryId),
    recipientMasked: text(row.recipientMasked, "unknown recipient"),
    channel: text(row.channel, "email"),
    status: text(row.status, "pending"),
    failureClass:
      failureClass === "permanent" || failureClass === "transient" || failureClass === "suppressed"
        ? failureClass
        : null,
    attempts: num(row.attempts),
    lastError: nullableText(row.lastError),
    providerMessageId: nullableText(row.providerMessageId),
    updatedAt: nullableText(row.updatedAt),
  };
}

function mapProviderJob(raw: unknown): DeliveryProviderJob {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    jobId: text(row.jobId),
    jobKind: text(row.jobKind),
    status: text(row.status, "pending"),
    attempts: num(row.attempts),
    nextAttemptAt: nullableText(row.nextAttemptAt),
    lastError: nullableText(row.lastError),
  };
}

function mapEvent(raw: unknown): DeliveryEvent {
  const row = (raw ?? {}) as Record<string, unknown>;
  const status = text(row.status);
  return {
    eventId: text(row.eventId),
    eventKey: text(row.eventKey),
    kind: text(row.kind),
    targetType: text(row.targetType),
    targetReference: text(row.targetReference),
    status:
      status === "processing" || status === "delivered" || status === "failed" ? status : "pending",
    attempts: num(row.attempts),
    maxAttempts: num(row.maxAttempts, 10),
    nextAttemptAt: nullableText(row.nextAttemptAt),
    lastError: nullableText(row.lastError),
    createdAt: text(row.createdAt),
    deliveredAt: nullableText(row.deliveredAt),
    deliveries: Array.isArray(row.deliveries) ? row.deliveries.map(mapDelivery) : [],
    providerJobs: Array.isArray(row.providerJobs) ? row.providerJobs.map(mapProviderJob) : [],
  };
}

export function mapDeliveriesBoard(raw: unknown): DeliveriesBoard {
  const row = (raw ?? {}) as Record<string, unknown>;
  const summary = (row.summary ?? {}) as Record<string, unknown>;
  return {
    events: Array.isArray(row.events) ? row.events.map(mapEvent) : [],
    summary: {
      pending: num(summary.pending),
      processing: num(summary.processing),
      delivered: num(summary.delivered),
      failed: num(summary.failed),
      deliveriesFailedPermanent: num(summary.deliveriesFailedPermanent),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Demo board (static illustrative rows — writes are no-ops)           */
/* ------------------------------------------------------------------ */

const DEMO_BOARD: DeliveriesBoard = {
  summary: { pending: 1, processing: 0, delivered: 4, failed: 1, deliveriesFailedPermanent: 1 },
  events: [
    {
      eventId: "demo-evt-1",
      eventKey: "email.notice_published:NTC-DEMO-1:v2",
      kind: "email.deliver",
      targetType: "notice",
      targetReference: "NTC-DEMO-1",
      status: "failed",
      attempts: 10,
      maxAttempts: 10,
      nextAttemptAt: null,
      lastError: "Permanent: recipient address suppressed by provider",
      createdAt: "2026-09-14T09:12:00.000Z",
      deliveredAt: null,
      deliveries: [
        {
          deliveryId: "demo-dlv-1",
          recipientMasked: "pa***@guardian.demo",
          channel: "email",
          status: "failed",
          failureClass: "permanent",
          attempts: 10,
          lastError: "Mailbox unavailable (sandbox sender)",
          providerMessageId: null,
          updatedAt: "2026-09-14T09:12:00.000Z",
        },
        {
          deliveryId: "demo-dlv-2",
          recipientMasked: "gr***@guardian.demo",
          channel: "email",
          status: "delivered",
          failureClass: null,
          attempts: 1,
          lastError: null,
          providerMessageId: "demo-msg-2",
          updatedAt: "2026-09-14T09:10:00.000Z",
        },
      ],
      providerJobs: [],
    },
    {
      eventId: "demo-evt-2",
      eventKey: "email.application_decision:ADM-DEMO-7:v3",
      kind: "email.deliver",
      targetType: "admission_application",
      targetReference: "ADM-DEMO-7",
      status: "pending",
      attempts: 1,
      maxAttempts: 10,
      nextAttemptAt: "2026-09-15T10:00:00.000Z",
      lastError: "provider rate limit",
      createdAt: "2026-09-14T16:40:00.000Z",
      deliveredAt: null,
      deliveries: [
        {
          deliveryId: "demo-dlv-3",
          recipientMasked: "ap***@family.demo",
          channel: "email",
          status: "pending",
          failureClass: "transient",
          attempts: 1,
          lastError: "provider rate limit",
          providerMessageId: null,
          updatedAt: "2026-09-14T16:42:00.000Z",
        },
      ],
      providerJobs: [],
    },
    {
      eventId: "demo-evt-3",
      eventKey: "email.job_status:JOB-DEMO-2:v2",
      kind: "email.deliver",
      targetType: "job_application",
      targetReference: "JOB-DEMO-2",
      status: "delivered",
      attempts: 1,
      maxAttempts: 10,
      nextAttemptAt: null,
      lastError: null,
      createdAt: "2026-09-13T11:02:00.000Z",
      deliveredAt: "2026-09-13T11:02:30.000Z",
      deliveries: [
        {
          deliveryId: "demo-dlv-4",
          recipientMasked: "ca***@applicant.demo",
          channel: "email",
          status: "delivered",
          failureClass: null,
          attempts: 1,
          lastError: null,
          providerMessageId: "demo-msg-4",
          updatedAt: "2026-09-13T11:02:30.000Z",
        },
      ],
      providerJobs: [],
    },
  ],
};

function demoBoard(status?: DeliveryEventStatus | null): DeliveriesBoard {
  return {
    summary: DEMO_BOARD.summary,
    events:
      status === undefined || status === null
        ? DEMO_BOARD.events.map((event) => ({ ...event }))
        : DEMO_BOARD.events.filter((event) => event.status === status).map((event) => ({ ...event })),
  };
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

function adapterError(result: { errors: Array<{ message: string }> }, fallback: string): Error {
  return new Error(result.errors[0]?.message ?? fallback);
}

export const deliveriesService = {
  async list(input: { status?: DeliveryEventStatus | null; limit?: number } = {}): Promise<DeliveriesBoard> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown>("deliveries.list", {
        status: input.status ?? null,
        limit: input.limit ?? 100,
      });
      if (!result.ok) throw adapterError(result, "Deliveries could not be loaded.");
      return mapDeliveriesBoard(result.value);
    }
    return demoBoard(input.status);
  },

  async retry(input: { deliveryId: string; reason: string }): Promise<DeliveryRetryResult> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown>("deliveries.retry", input);
      if (!result.ok) throw adapterError(result, "The delivery could not be retried.");
      const value = (result.value ?? {}) as Record<string, unknown>;
      const delivery = (value.delivery ?? {}) as Record<string, unknown>;
      const event = (value.event ?? {}) as Record<string, unknown>;
      return {
        applied: true,
        deliveryStatus: text(delivery.status) || undefined,
        eventStatus: text(event.status) || undefined,
      };
    }
    /* Demo writes are honest no-ops: the row is illustrative and nothing is
       re-sent. */
    return { applied: false };
  },

  async requeueEvent(input: { eventId: string; reason: string }): Promise<EventRequeueResult> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown>("deliveries.requeueEvent", input);
      if (!result.ok) throw adapterError(result, "The event could not be requeued.");
      const value = (result.value ?? {}) as Record<string, unknown>;
      return {
        applied: true,
        eventStatus: text(value.status) || undefined,
        providerJobsRequeued: num(value.providerJobsRequeued),
      };
    }
    return { applied: false };
  },
};
