"use client";

import { useMemo, useState } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatKolkata } from "@/modules/iot/domain";
import {
  auditService,
  type AuditEvent,
  type AuditOutcome,
} from "@/modules/services/audit";

import styles from "./AuditExplorer.module.css";

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

const REF_RE = /^(INV|APP|JOB|GW|ROLE|LINK|IMP|EXP|SET|STU)/;

const PAGE_SIZE = 50;

/**
 * Read-only audit explorer: actor, action and date-range filters over the
 * safe audit events supplied by the page from the audit service (the
 * seeded demo list is the fallback). No editing or deletion is offered
 * anywhere.
 *
 * The action filter is derived from the events actually loaded, so newly
 * recorded action kinds (for example "Account suspended" or "MFA verified")
 * are filterable instead of being invisible behind a stale fixed list. When
 * `initialCursor` is present, the register continues to paginate backwards
 * through history with "Load older events" instead of silently stopping at
 * the first page.
 */
export function AuditExplorer({
  events = [],
  initialCursor = null,
  paged = false,
}: {
  events?: readonly AuditEvent[];
  initialCursor?: string | null;
  paged?: boolean;
}) {
  const [rows, setRows] = useState<readonly AuditEvent[]>(events);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [actor, setActor] = useState("all");
  const [action, setAction] = useState("all");
  const [range, setRange] = useState<RangeKey>("30d");

  const actors = useMemo(() => Array.from(new Set(rows.map((event) => event.actor))).sort(), [rows]);
  const actions = useMemo(
    () => Array.from(new Set(rows.map((event) => event.action))).sort((left, right) => left.localeCompare(right)),
    [rows],
  );

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? 30;
    const now = new Date();
    return rows.filter(
      (event) =>
        (actor === "all" || event.actor === actor) &&
        (action === "all" || event.action === action) &&
        daysSince(event.timestampIso, now) <= days,
    );
  }, [actor, action, range, rows]);

  function resetFilters() {
    setActor("all");
    setAction("all");
    setRange("30d");
  }

  async function loadOlder(): Promise<void> {
    if (loadingOlder || cursor === null) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await auditService.listEventsPage({ limit: PAGE_SIZE, cursor });
      setRows((current) => {
        const seen = new Set(current.map((event) => event.id));
        return [...current, ...page.events.filter((event) => !seen.has(event.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setOlderError("Older audit events could not be loaded · the loaded history is unchanged. Try again.");
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <div>
      <p className={styles.liveCount} aria-live="polite">
        {visible.length} audit event{visible.length === 1 ? "" : "s"} shown
        {paged ? ` · newest ${rows.length} loaded` : ""}
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
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="all">All actions</option>
            {actions.map((name) => (
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
          <p className="workspace-state-note">
            No events match the current actor, action and date filters.
            {cursor !== null ? " Older events are available and may match." : ""}
          </p>
          <div className={styles.stateActions}>
            <Button variant="quiet" onClick={resetFilters}>
              Reset filters
            </Button>
            {cursor !== null ? (
              <Button variant="quiet" onClick={() => void loadOlder()} disabled={loadingOlder}>
                {loadingOlder ? "Loading older events…" : "Load older events"}
              </Button>
            ) : null}
          </div>
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
          {paged ? (
            <div className={styles.olderRow}>
              {olderError !== null ? (
                <p className="field-error" role="alert">
                  {olderError}
                </p>
              ) : null}
              {cursor !== null ? (
                <Button variant="quiet" onClick={() => void loadOlder()} disabled={loadingOlder}>
                  {loadingOlder ? "Loading older events…" : "Load older events"}
                </Button>
              ) : (
                <p className="small muted">End of the audit register.</p>
              )}
            </div>
          ) : null}
          {rows.length > 0 ? <p className={styles.demoNote}>Read-only audit projection · safe metadata only.</p> : null}
        </div>
      )}
    </div>
  );
}
