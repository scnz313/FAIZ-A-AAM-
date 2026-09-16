"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import Button from "@/components/ui/Button";
import RelativeTime from "@/components/ui/RelativeTime";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  deliveriesService,
  type DeliveriesBoard,
  type DeliveryEvent,
  type DeliveryEventStatus,
  type DeliveryFilter,
  type DeliveryRow,
} from "@/modules/services/deliveries";

import styles from "./page.module.css";

const EVENT_TONE: Record<DeliveryEventStatus, StatusTone> = {
  pending: "watch",
  processing: "warning",
  delivered: "good",
  failed: "alert",
};

const EVENT_LABEL: Record<DeliveryEventStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  delivered: "Delivered",
  failed: "Failed",
};

const DELIVERY_TONE: Record<string, StatusTone> = {
  pending: "watch",
  sent: "neutral",
  delivered: "good",
  bounced: "alert",
  complained: "alert",
  suppressed: "warning",
  failed: "alert",
};

const FILTERS: ReadonlyArray<{ value: DeliveryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "delivered", label: "Delivered" },
];

type InlineAction =
  | { kind: "retry"; deliveryId: string; label: string }
  | { kind: "requeue"; eventId: string; label: string }
  | null;

type WorkerRunSummary = { claimed?: number; delivered?: number; permanentFailed?: number; transientFailed?: number };

export default function DeliveriesWorkspace() {
  const demoMode = clientAdapterMode() !== "supabase";
  const [board, setBoard] = useState<DeliveriesBoard | null>(null);
  const [filter, setFilter] = useState<DeliveryFilter>("all");
  const [loadError, setLoadError] = useState(false);
  const [workerLastRunAt, setWorkerLastRunAt] = useState<string | null>(null);
  const [workerBusy, setWorkerBusy] = useState(false);
  const [action, setAction] = useState<InlineAction>(null);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const refresh = useCallback(async (nextFilter: DeliveryFilter) => {
    try {
      setBoard(
        await deliveriesService.list({
          status: nextFilter === "all" ? null : nextFilter,
        }),
      );
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh(filter);
  }, [refresh, filter]);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkerHealth() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const body = (await response.json()) as { worker?: { lastRunAt?: string | null } };
        if (!cancelled) setWorkerLastRunAt(body.worker?.lastRunAt ?? null);
      } catch {
        if (!cancelled) setWorkerLastRunAt(null);
      }
    }
    void loadWorkerHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runWorker() {
    setWorkerBusy(true);
    setOperationError(null);
    try {
      if (demoMode) {
        setAnnouncement("Demo mode · the worker is illustrative and no mail is sent.");
        return;
      }
      const response = await fetch("/api/outbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as WorkerRunSummary & { ok?: boolean; error?: string };
      if (!response.ok || body.ok !== true) throw new Error(body.error ?? "The worker run could not be completed.");
      const failed = (body.permanentFailed ?? 0) + (body.transientFailed ?? 0);
      setAnnouncement(
        `Worker run complete · claimed ${body.claimed ?? 0}, delivered ${body.delivered ?? 0}, failed ${failed}.`,
      );
      setWorkerLastRunAt(new Date().toISOString());
      await refresh(filter);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "The worker run could not be completed.");
    } finally {
      setWorkerBusy(false);
    }
  }

  function openAction(next: NonNullable<InlineAction>) {
    setAction(next);
    setReason("");
    setFieldError(null);
    setOperationError(null);
  }

  function closeAction() {
    setAction(null);
    setReason("");
    setFieldError(null);
  }

  async function submitAction() {
    if (action === null) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setFieldError("Enter a reason of at least 3 characters.");
      return;
    }
    setBusy(true);
    setOperationError(null);
    try {
      if (action.kind === "retry") {
        const result = await deliveriesService.retry({ deliveryId: action.deliveryId, reason: cleanReason });
        setAnnouncement(
          result.applied
            ? `Delivery for ${action.label} is queued for another attempt.`
            : `Demo mode · the delivery for ${action.label} was not changed.`,
        );
      } else {
        const result = await deliveriesService.requeueEvent({ eventId: action.eventId, reason: cleanReason });
        setAnnouncement(
          result.applied
            ? `Event ${action.label} is queued for the next worker run.`
            : `Demo mode · event ${action.label} was not changed.`,
        );
      }
      closeAction();
      await refresh(filter);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "The delivery action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const events = board?.events ?? null;

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Administrator · Deliveries</p>
          <h1 className={styles.title}>Deliveries</h1>
          <p className="ph-sub">Outbox events and recipient deliveries · manual worker runs and audited retries</p>
        </div>
      </div>

      {board ? (
        <section className="panel" aria-label="Delivery queue summary">
          <div className={`pn-body flush ${styles.summaryStrip}`}>
            <SummaryStat label="Pending" value={board.summary.pending} />
            <SummaryStat label="Processing" value={board.summary.processing} />
            <SummaryStat label="Delivered" value={board.summary.delivered} />
            <SummaryStat label="Failed events" value={board.summary.failed} />
            <SummaryStat label="Failed deliveries" value={board.summary.deliveriesFailedPermanent} />
          </div>
        </section>
      ) : null}

      {announcement ? <p className={styles.liveNote} aria-live="polite">{announcement}</p> : null}
      {operationError ? <p className={styles.error} role="alert">{operationError}</p> : null}

      <section className="panel" aria-labelledby="deliveries-ledger-heading">
        <div className="pn-head">
          <div>
            <h2 id="deliveries-ledger-heading">Outbox events</h2>
            <p className="sub">Masked recipients · retries require an explicit reason</p>
          </div>
        </div>
        <div className="pn-body flush">
          <div className={styles.toolbar}>
            <div className="seg" role="group" aria-label="Delivery status filter">
              {FILTERS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  aria-pressed={filter === entry.value}
                  onClick={() => {
                    setFilter(entry.value);
                    closeAction();
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className={styles.toolbarRight}>
              <span className={styles.toolbarMeta}>
                {workerLastRunAt !== null ? (
                  <>Last worker run <RelativeTime iso={workerLastRunAt} /></>
                ) : (
                  "Last worker run not recorded"
                )}
              </span>
              <Button variant="primary" type="button" onClick={() => void runWorker()} disabled={workerBusy}>
                {workerBusy ? "Running…" : "Run worker now"}
              </Button>
            </div>
          </div>
          {loadError && events === null ? (
            <div className={styles.statePad}>
              <ErrorPanel
                title="Deliveries could not be loaded"
                note="The delivery projection did not respond. No records were changed."
              >
                <Button variant="quiet" type="button" onClick={() => void refresh(filter)}>Try again</Button>
              </ErrorPanel>
            </div>
          ) : events === null ? (
            <div className={styles.statePad}><LoadingSkeleton lines={5} label="Loading delivery rows…" /></div>
          ) : events.length === 0 ? (
            <div className={`workspace-state ${styles.statePad}`}>
              <p className="workspace-state-title">No events in this state</p>
              <p className="workspace-state-note">
                {filter === "all"
                  ? "The outbox is empty · notifications and provider jobs appear here as work is queued."
                  : `Nothing is ${filter} right now · switch the filter to see other states.`}
              </p>
            </div>
          ) : (
            <div className="table-wrap" role="region" aria-label="Delivery events table" tabIndex={0}>
              <table className={`ledger ${styles.table}`}>
                <caption className="sr-only">Outbox events, masked recipients, delivery state and retry actions</caption>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Recipients</th>
                    <th scope="col">Status</th>
                    <th scope="col">Last error</th>
                    <th scope="col" className={styles.actionHead}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <DeliveryEventRow
                      key={event.eventId}
                      event={event}
                      action={action}
                      reason={reason}
                      fieldError={fieldError}
                      busy={busy}
                      onOpen={openAction}
                      onReason={(value) => { setReason(value); setFieldError(null); }}
                      onCancel={closeAction}
                      onSubmit={() => void submitAction()}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.summaryCell}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={`num ${styles.summaryValue}`}>{value}</span>
    </div>
  );
}

function DeliveryEventRow({
  event,
  action,
  reason,
  fieldError,
  busy,
  onOpen,
  onReason,
  onCancel,
  onSubmit,
}: {
  event: DeliveryEvent;
  action: InlineAction;
  reason: string;
  fieldError: string | null;
  busy: boolean;
  onOpen: (action: NonNullable<InlineAction>) => void;
  onReason: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const requeueOpen = action?.kind === "requeue" && action.eventId === event.eventId;
  const retryDelivery = action?.kind === "retry"
    ? event.deliveries.find((delivery) => delivery.deliveryId === action.deliveryId)
    : undefined;
  const formOpen = requeueOpen || retryDelivery !== undefined;
  const visibleDeliveries = event.deliveries.slice(0, 2);
  const hiddenDeliveryCount = Math.max(0, event.deliveries.length - visibleDeliveries.length);
  const hasRetryAction = event.deliveries.some((delivery) => delivery.status === "failed");
  const hasRequeueAction = event.status === "failed";
  return (
    <>
      <tr className={styles.dataRow}>
        <td className={styles.eventCell}>
          <span className={styles.eventKind}>{event.kind}</span>
          <span className={styles.secondary}>{event.targetType} · {event.targetReference}</span>
        </td>
        <td className={styles.recipientsCell}>
          {event.deliveries.length === 0 ? (
            <span className={styles.secondary}>No recipient deliveries</span>
          ) : (
            <div className={styles.recipientList}>
              {visibleDeliveries.map((delivery) => (
                <div key={delivery.deliveryId} className={styles.recipient}>
                  <span className={styles.recipientAddress}>{delivery.recipientMasked}</span>
                  <StatusBadge tone={DELIVERY_TONE[delivery.status] ?? "neutral"}>
                    {delivery.status.replace(/_/g, " ")}
                  </StatusBadge>
                </div>
              ))}
              {hiddenDeliveryCount > 0 ? (
                <details>
                  <summary className={styles.secondary}>+{hiddenDeliveryCount} more {hiddenDeliveryCount === 1 ? "recipient" : "recipients"}</summary>
                  {event.deliveries.slice(2).map((delivery) => (
                    <div key={delivery.deliveryId} className={styles.recipient}>
                      <span className={styles.recipientAddress}>{delivery.recipientMasked}</span>
                      <StatusBadge tone={DELIVERY_TONE[delivery.status] ?? "neutral"}>{delivery.status.replace(/_/g, " ")}</StatusBadge>
                    </div>
                  ))}
                </details>
              ) : null}
            </div>
          )}
        </td>
        <td className={styles.statusCell}>
          <StatusBadge tone={EVENT_TONE[event.status]}>{EVENT_LABEL[event.status]}</StatusBadge>
          <span className={styles.secondary}>
            Attempt <span className="num">{event.attempts}</span> of <span className="num">{event.maxAttempts}</span>
            {event.deliveredAt !== null ? <> · Delivered <RelativeTime iso={event.deliveredAt} /></> : null}
            {event.nextAttemptAt !== null && event.status !== "delivered" ? <> · Next <RelativeTime iso={event.nextAttemptAt} /></> : null}
          </span>
        </td>
        <td className={styles.errorCell}>{event.lastError ?? "—"}</td>
        <td className={styles.actionCell}>
          {hasRetryAction || hasRequeueAction ? (
            <div className={styles.rowActions}>
              {event.deliveries
                .filter((delivery) => delivery.status === "failed")
                .map((delivery) => (
                  <button
                    key={delivery.deliveryId}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      onOpen({ kind: "retry", deliveryId: delivery.deliveryId, label: delivery.recipientMasked })
                    }
                  >
                    Retry · {delivery.recipientMasked}
                  </button>
                ))}
              {hasRequeueAction ? (
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  onClick={() => onOpen({ kind: "requeue", eventId: event.eventId, label: event.eventKey })}
                >
                  Requeue
                </button>
              ) : null}
            </div>
          ) : (
            <span className={styles.mutedInline}>No action needed</span>
          )}
        </td>
      </tr>
      {formOpen ? (
        <tr>
          <td colSpan={5} className={styles.formCell}>
            <ReasonForm
              id={requeueOpen ? event.eventId : retryDelivery?.deliveryId ?? event.eventId}
              label={requeueOpen ? "Requeue event" : "Retry delivery"}
              reason={reason}
              error={fieldError}
              busy={busy}
              onReason={onReason}
              onCancel={onCancel}
              onSubmit={onSubmit}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ReasonForm({
  id,
  label,
  reason,
  error,
  busy,
  onReason,
  onCancel,
  onSubmit,
}: {
  id: string;
  label: string;
  reason: string;
  error: string | null;
  busy: boolean;
  onReason: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className={styles.inlineForm}>
      <p className={styles.mutedInline}>{label}</p>
      <div className="field">
        <label htmlFor={`delivery-reason-${id}`}>Reason</label>
        <input
          id={`delivery-reason-${id}`}
          className="input"
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error ? `delivery-error-${id}` : undefined}
        />
        {error ? <p id={`delivery-error-${id}`} className="field-error">{error}</p> : null}
      </div>
      <div className={styles.formActions}>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSubmit} disabled={busy}>
          {busy ? "Saving…" : label}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
