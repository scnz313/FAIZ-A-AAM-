"use client";

import { Fragment, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { METRIC_META } from "@fass/contracts";
import type { Alert, AlertSeverity, AlertStatus, Zone } from "@fass/contracts";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { acknowledgeAlert, getAlerts, resolveAlert } from "@/lib/iot/api";
import { ALERT_SEVERITY_LABELS, ALERT_STATUS_LABELS, formatKolkata } from "@/modules/iot/domain";
import styles from "./AlertsWorkspace.module.css";

type SeverityFilter = "all" | AlertSeverity;
type StatusFilter = "all" | AlertStatus;

const SEVERITY_FILTERS: ReadonlyArray<{ key: SeverityFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "info", label: "Info" },
];

const STATUS_FILTERS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "resolved", label: "Resolved" },
];

const SEVERITY_LABELS = ALERT_SEVERITY_LABELS;
const STATUS_LABELS = ALERT_STATUS_LABELS;

const SEVERITY_DOT: Record<AlertSeverity, string> = {
  critical: "status-dot status-dot--alert",
  warning: "status-dot status-dot--watch",
  info: "status-dot status-dot--neutral",
};

const SEVERITY_TONE: Record<AlertSeverity, "alert" | "watch" | "neutral"> = {
  critical: "alert",
  warning: "watch",
  info: "neutral",
};

const STATUS_TONE: Record<AlertStatus, "alert" | "watch" | "good"> = {
  open: "alert",
  acknowledged: "watch",
  resolved: "good",
};

function trailText(alert: Alert): string {
  if (alert.status === "resolved") {
    const at = alert.resolvedAt ? formatKolkata(alert.resolvedAt, { format: "full" }) : null;
    const note = alert.resolutionNote ? ` · ${alert.resolutionNote}` : "";
    return `Resolved by ${alert.resolvedBy ?? "staff"}${at ? ` · ${at}` : ""}${note}`;
  }
  const at = alert.acknowledgedAt ? formatKolkata(alert.acknowledgedAt, { format: "full" }) : null;
  return `Acknowledged by ${alert.acknowledgedBy ?? "staff"}${at ? ` · ${at}` : ""}`;
}

type AlertsWorkspaceProps = {
  zones: Zone[];
  initialAlerts: Alert[] | null;
};

export function AlertsWorkspace({ zones, initialAlerts }: AlertsWorkspaceProps) {
  const { summary } = useStaffContext();
  const canManage = canAnyRole(summary?.roles ?? [], "facility.manage");
  const [alerts, setAlerts] = useState<Alert[] | null>(initialAlerts);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const zoneNames = useMemo(() => new Map(zones.map((z) => [z.id, z.name])), [zones]);

  const counts = useMemo(() => {
    const open = (alerts ?? []).filter((a) => a.status === "open");
    return {
      total: open.length,
      critical: open.filter((a) => a.severity === "critical").length,
      warning: open.filter((a) => a.severity === "warning").length,
      info: open.filter((a) => a.severity === "info").length,
    };
  }, [alerts]);

  const visible = useMemo(
    () =>
      (alerts ?? []).filter(
        (a) =>
          (severityFilter === "all" || a.severity === severityFilter) &&
          (statusFilter === "all" || a.status === statusFilter),
      ),
    [alerts, severityFilter, statusFilter],
  );

  const hasFilters = severityFilter !== "all" || statusFilter !== "all";

  async function reload() {
    setActionError(null);
    try {
      setAlerts(await getAlerts());
    } catch {
      setAlerts(null);
      setActionError("Could not load alerts. Check the sensor service and retry.");
    }
  }

  function resetFilters() {
    setSeverityFilter("all");
    setStatusFilter("all");
  }

  async function acknowledge(alert: Alert) {
    setActionError(null);
    const previous = alert;
    const optimistic: Alert = {
      ...alert,
      status: "acknowledged",
      acknowledgedAt: new Date().toISOString(),
      acknowledgedBy: "Facility staff",
    };
    setAlerts((prev) => (prev ? prev.map((a) => (a.id === alert.id ? optimistic : a)) : prev));
    try {
      const updated = await acknowledgeAlert(alert.id);
      setAlerts((prev) => (prev ? prev.map((a) => (a.id === updated.id ? updated : a)) : prev));
    } catch {
      setAlerts((prev) => (prev ? prev.map((a) => (a.id === previous.id ? previous : a)) : prev));
      setActionError(`Could not acknowledge ${previous.ref}. The alert is unchanged.`);
    }
  }

  function openResolve(alert: Alert) {
    setResolvingId(alert.id);
    setResolveNote("");
    setActionError(null);
  }

  function cancelResolve() {
    setResolvingId(null);
    setResolveNote("");
  }

  async function confirmResolve(alert: Alert) {
    const note = resolveNote.trim();
    if (!note) return;
    setActionError(null);
    const previous = alert;
    const optimistic: Alert = {
      ...alert,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      resolvedBy: "Facility staff",
      resolutionNote: note,
    };
    setResolvingId(null);
    setResolveNote("");
    setAlerts((prev) => (prev ? prev.map((a) => (a.id === alert.id ? optimistic : a)) : prev));
    try {
      const updated = await resolveAlert(alert.id, note);
      setAlerts((prev) => (prev ? prev.map((a) => (a.id === updated.id ? updated : a)) : prev));
    } catch {
      setAlerts((prev) => (prev ? prev.map((a) => (a.id === previous.id ? previous : a)) : prev));
      setActionError(`Could not resolve ${previous.ref}. The alert is unchanged.`);
    }
  }

  function handleResolveSubmit(alert: Alert) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void confirmResolve(alert);
    };
  }

  if (alerts === null) {
    return (
      <div className="workspace-state" role="alert">
        <p className="workspace-state-title">Could not load alerts</p>
        <p className="workspace-state-note">
          The alert service did not respond. Retry to load the open alert trail.
        </p>
        <Button variant="quiet" onClick={() => void reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <p className={styles.liveRegion} aria-live="polite">
        {counts.total} open alert{counts.total === 1 ? "" : "s"} — {counts.critical} critical, {counts.warning} warning,{" "}
        {counts.info} info
      </p>

      <div className={styles.summary} role="group" aria-label="Open alerts summary">
        <div className={styles.summaryCell}>
          <span className="status-dot status-dot--alert" aria-hidden="true" />
          <div>
            <p className={styles.summaryWord}>Critical</p>
            <p className={`num ${styles.summaryCount}`}>{counts.critical}</p>
          </div>
        </div>
        <div className={styles.summaryCell}>
          <span className="status-dot status-dot--watch" aria-hidden="true" />
          <div>
            <p className={styles.summaryWord}>Warning</p>
            <p className={`num ${styles.summaryCount}`}>{counts.warning}</p>
          </div>
        </div>
        <div className={styles.summaryCell}>
          <span className="status-dot status-dot--neutral" aria-hidden="true" />
          <div>
            <p className={styles.summaryWord}>Info</p>
            <p className={`num ${styles.summaryCount}`}>{counts.info}</p>
          </div>
        </div>
        <div className={styles.summaryCell}>
          <div>
            <p className={styles.summaryWord}>Total open</p>
            <p className={`num ${styles.summaryCount}`}>{counts.total}</p>
          </div>
        </div>
      </div>

      {actionError && (
        <p className={styles.actionError} role="alert">
          {actionError}
        </p>
      )}

      <div className={styles.filterRow}>
        <div className="tabs" role="group" aria-label="Filter by severity">
          {SEVERITY_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={severityFilter === filter.key ? "active" : undefined}
              aria-pressed={severityFilter === filter.key}
              onClick={() => setSeverityFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="tabs" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={statusFilter === filter.key ? "active" : undefined}
              aria-pressed={statusFilter === filter.key}
              onClick={() => setStatusFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No alerts in this view</p>
          <p className="workspace-state-note">
            {hasFilters
              ? "No alerts match the current severity and status filters."
              : "Alerts appear here when a zone reading crosses a threshold."}
          </p>
          <Button variant="quiet" onClick={resetFilters}>
            Reset filters
          </Button>
        </div>
      ) : (
        <div className="table--scroll">
          <table className={`table ${styles.alertsTable}`}>
            <caption className="sr-only">Alerts with severity, status and actions</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Severity</span>
                </th>
                <th scope="col">Ref</th>
                <th scope="col">Alert</th>
                <th scope="col">Zone · metric</th>
                <th scope="col">Raised</th>
                <th scope="col">Severity</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((alert) => (
                <Fragment key={alert.id}>
                  <tr>
                    <td className={styles.cellDot}>
                      <span className={SEVERITY_DOT[alert.severity]} aria-hidden="true" />
                    </td>
                    <td className="num">{alert.ref}</td>
                    <td className={styles.cellTitle}>
                      <strong>{alert.title}</strong>
                      <small>{alert.detail}</small>
                    </td>
                    <td className={styles.cellContext}>
                      <strong>{zoneNames.get(alert.zoneId) ?? "Unknown zone"}</strong>
                      <small>{METRIC_META[alert.metric].label}</small>
                    </td>
                    <td className={styles.cellRaised}>
                      <time dateTime={alert.raisedAt}>{formatKolkata(alert.raisedAt, { format: "full" })}</time>
                    </td>
                    <td className={styles.cellBadges}>
                      <StatusBadge tone={SEVERITY_TONE[alert.severity]}>{SEVERITY_LABELS[alert.severity]}</StatusBadge>
                    </td>
                    <td className={styles.cellBadges}>
                      <StatusBadge tone={STATUS_TONE[alert.status]}>{STATUS_LABELS[alert.status]}</StatusBadge>
                    </td>
                    <td className={styles.cellActions}>
                      {alert.status === "open" && canManage && (
                        <Button variant="quiet" onClick={() => void acknowledge(alert)}>
                          Acknowledge
                        </Button>
                      )}
                      {alert.status === "acknowledged" && canManage && (
                        <Button variant="quiet" onClick={() => openResolve(alert)}>
                          Resolve
                        </Button>
                      )}
                    </td>
                  </tr>
                  {(alert.status === "acknowledged" || alert.status === "resolved") && (
                    <tr>
                      <td colSpan={8} className={styles.alertTrail}>
                        {trailText(alert)}
                      </td>
                    </tr>
                  )}
                  {resolvingId === alert.id && (
                    <tr>
                      <td colSpan={8}>
                        <form className={styles.resolveForm} onSubmit={handleResolveSubmit(alert)}>
                          <label htmlFor={`resolve-note-${alert.id}`}>Resolution note (required)</label>
                          <input
                            id={`resolve-note-${alert.id}`}
                            className={`input ${styles.resolveInput}`}
                            type="text"
                            value={resolveNote}
                            onChange={(event) => setResolveNote(event.target.value)}
                            placeholder="What brought the reading back in range?"
                            aria-required="true"
                          />
                          <div className={styles.resolveActions}>
                            <Button variant="primary" type="submit" disabled={resolveNote.trim().length === 0}>
                              Resolve
                            </Button>
                            <Button variant="quiet" type="button" onClick={cancelResolve}>
                              Cancel
                            </Button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className={styles.demoNote}>
            <span className="demo-badge">Fictional demo alerts</span>
          </p>
        </div>
      )}
    </div>
  );
}
