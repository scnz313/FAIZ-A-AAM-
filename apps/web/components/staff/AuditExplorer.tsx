"use client";

import { useMemo, useState } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatKolkata } from "@/modules/iot/domain";
import {
  type AuditAction,
  type AuditEvent,
  type AuditOutcome,
} from "@/modules/services/audit";

import styles from "./AuditExplorer.module.css";

const ACTIONS: readonly AuditAction[] = [
  "Login",
  "Application reviewed",
  "Result published",
  "Result withdrawn",
  "Payment reconciled",
  "Payment posted",
  "Notice published",
  "Timetable changed",
  "Setting changed",
  "Invoice viewed",
  "Link requested",
  "Link approved",
  "Link rejected",
  "Link revoked",
  "Enrollment converted",
];

const OUTCOME_TONE: Record<AuditOutcome, "good" | "alert"> = {
  Success: "good",
  Denied: "alert",
  Failed: "alert",
};

type RangeKey = "today" | "7d" | "30d";

const RANGES: ReadonlyArray<{ key: RangeKey; label: string; days: number }> = [
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
];

const KOLKATA_TZ = "Asia/Kolkata";

/** Calendar day of a timestamp in Asia/Kolkata, as YYYY-MM-DD. */
function istDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KOLKATA_TZ }).format(new Date(iso));
}

/** Whole IST-calendar days between a timestamp and now (0 = same IST day). */
function daysSince(iso: string, now: Date): number {
  const from = Date.parse(istDayKey(iso));
  const to = Date.parse(istDayKey(now.toISOString()));
  return Math.round((to - from) / 86_400_000);
}

const REF_RE = /^(INV|APP|JOB|GW)/;

/**
 * Read-only demo audit explorer: actor, action and date-range filters over
 * the safe audit events supplied by the page from the audit service (the
 * seeded demo list is the fallback). No editing or deletion is offered
 * anywhere.
 */
export function AuditExplorer({ events = [] }: { events?: readonly AuditEvent[] }) {
  const [actor, setActor] = useState("all");
  const [action, setAction] = useState<"all" | AuditAction>("all");
  const [range, setRange] = useState<RangeKey>("30d");

  const actors = useMemo(() => Array.from(new Set(events.map((event) => event.actor))).sort(), [events]);

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? 30;
    const now = new Date();
    return events.filter(
      (event) =>
        (actor === "all" || event.actor === actor) &&
        (action === "all" || event.action === action) &&
        daysSince(event.timestampIso, now) <= days,
    );
  }, [actor, action, range, events]);

  function resetFilters() {
    setActor("all");
    setAction("all");
    setRange("30d");
  }

  return (
    <div>
      <p className={styles.liveCount} aria-live="polite">
        {visible.length} audit event{visible.length === 1 ? "" : "s"} shown
      </p>

      <div className={styles.filterRow}>
        <div className={styles.filterField}>
          <label htmlFor="audit-actor">Actor</label>
          <select id="audit-actor" className="select" value={actor} onChange={(event) => setActor(event.target.value)}>
            <option value="all">All actors</option>
            {actors.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="audit-action">Action</label>
          <select
            id="audit-action"
            className="select"
            value={action}
            onChange={(event) => setAction(event.target.value as "all" | AuditAction)}
          >
            <option value="all">All actions</option>
            {ACTIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className={`tabs ${styles.rangeTabs}`} role="group" aria-label="Filter by date range">
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={range === item.key ? "active" : undefined}
              aria-pressed={range === item.key}
              onClick={() => setRange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No audit events in this view</p>
          <p className="workspace-state-note">No events match the current actor, action and date filters.</p>
          <Button variant="quiet" onClick={resetFilters}>
            Reset filters
          </Button>
        </div>
      ) : (
        <div className="table--scroll">
          <table className={`table ${styles.table}`}>
            <caption className="sr-only">Audit events with timestamp, actor, action, target and outcome</caption>
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Outcome</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
                <tr key={event.id}>
                  <td className={styles.timestamp}>
                    <time dateTime={event.timestampIso}>{formatKolkata(event.timestampIso, { format: "full" })}</time>
                  </td>
                  <td className={styles.actor}>{event.actor}</td>
                  <td>{event.action}</td>
                  <td className={REF_RE.test(event.target) ? `num ${styles.target}` : styles.target}>{event.target}</td>
                  <td>
                    <StatusBadge tone={OUTCOME_TONE[event.outcome]}>{event.outcome}</StatusBadge>
                  </td>
                  <td className={styles.reason}>{event.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length > 0 ? <p className={styles.demoNote}>Read-only audit projection · safe metadata only.</p> : null}
        </div>
      )}
    </div>
  );
}
