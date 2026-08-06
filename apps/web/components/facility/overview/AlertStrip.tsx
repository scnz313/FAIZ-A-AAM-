import type { Alert, AlertSeverity } from "@fass/contracts";

import styles from "./AlertStrip.module.css";

type AlertStripProps = {
  /** Alerts from the facility; open critical/warning alerts are surfaced here. */
  alerts: Alert[];
};

function severityRank(severity: AlertSeverity): number {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

/**
 * One-line banner for open critical/warning alerts. Renders nothing when
 * there is nothing to act on. Server-rendered and static between loads, so
 * it is not a live region.
 */
export function AlertStrip({ alerts }: AlertStripProps) {
  const open = alerts.filter(
    (alert) => alert.status === "open" && (alert.severity === "critical" || alert.severity === "warning"),
  );

  if (open.length === 0) return null;

  const criticalCount = open.filter((alert) => alert.severity === "critical").length;
  const toneClass = criticalCount > 0 ? "alert-strip--critical" : "alert-strip--warning";

  const shown = [...open]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.raisedAt.localeCompare(b.raisedAt))
    .slice(0, 2);
  const remaining = open.length - shown.length;

  const titles = shown.map((alert) => alert.title).join(" · ");
  const remainder = remaining > 0 ? ` · ${remaining} more` : "";
  const unit = open.length === 1 ? "alert" : "alerts";

  return (
    <div className={`alert-strip ${toneClass} ${styles.strip}`}>
      <p className={styles.copy}>
        <strong className="num">{open.length}</strong> open {unit} — {titles}
        {remainder}
      </p>
      <a className="link-arrow" href="/staff/facility/alerts">
        Review alerts →
      </a>
    </div>
  );
}
