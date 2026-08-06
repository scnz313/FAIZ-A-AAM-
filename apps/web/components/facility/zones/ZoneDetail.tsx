import type {
  Alert,
  AlertSeverity,
  AlertStatus,
  Device,
  DeviceStatus,
  MetricType,
  SeriesSample,
  Zone,
} from "@fass/contracts";
import { METRIC_META, METRIC_TYPES } from "@fass/contracts";
import {
  THRESHOLDS,
  alertStatusLabel,
  bandForMetric,
  bandLevelLabel,
  formatKolkata,
  formatMetricValue,
} from "@/modules/iot/domain";
import { StatusBadge } from "@/components/ui/StatusBadge";
import RelativeTime from "@/components/ui/RelativeTime";
import { TimeSeriesChart } from "@/components/ui/TimeSeriesChart";

import styles from "./ZoneDetail.module.css";

/** Primary metrics charted on the detail page; the page fetches those the zone has. */
export const DETAIL_CHART_METRICS = ["co2_ppm", "pm25_ugm3", "temp_c"] as const satisfies readonly MetricType[];

type StatusTone = "good" | "watch" | "alert" | "neutral" | "offline";

export type ZoneDetailData = {
  zone: Zone;
  readings: Partial<Record<MetricType, number>>;
  takenAt: string | null;
  devices: Device[];
  alerts: Alert[];
  chartSeries: { metric: MetricType; samples: SeriesSample[] }[];
};

function severityTone(severity: AlertSeverity): StatusTone {
  if (severity === "critical") return "alert";
  if (severity === "warning") return "watch";
  return "neutral";
}

function alertStatusTone(status: AlertStatus): StatusTone {
  if (status === "open") return "alert";
  if (status === "acknowledged") return "watch";
  return "good";
}

function deviceTone(status: DeviceStatus): StatusTone {
  if (status === "online") return "good";
  if (status === "low-battery") return "watch";
  if (status === "maintenance") return "neutral";
  return "offline";
}

function deviceLabel(status: DeviceStatus): string {
  if (status === "online") return "Online";
  if (status === "low-battery") return "Low battery";
  if (status === "maintenance") return "Maintenance";
  return "Offline";
}

/** Headline readings, 24-hour charts, devices and alerts for one zone. */
export function ZoneDetail({ zone, readings, takenAt, devices, alerts, chartSeries }: ZoneDetailData) {
  const sortedAlerts = [...alerts].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
  const presentMetrics = METRIC_TYPES.filter((metric) => readings[metric] !== undefined);

  return (
    <div className={styles.root}>
      <section aria-labelledby="current-readings-heading">
        <h2 id="current-readings-heading" className={styles.sectionTitle}>
          Current readings
        </h2>
        <div className={`metric-grid ${styles.metricGrid}`}>
          {presentMetrics.map((metric) => {
            const value = readings[metric];
            if (value === undefined) return null;
            const meta = METRIC_META[metric];
            if (!meta) return null;
            const band = bandForMetric(metric, value);
            return (
              <div className="metric-cell" key={metric}>
                <p className="section-label">{meta.shortLabel}</p>
                <p className={styles.cellValue}>
                  <span className="num">{formatMetricValue(metric, value)}</span>
                </p>
                <p className={styles.bandLine}>
                  <span className={`status-dot status-dot--${band}`} aria-hidden="true" />
                  <span className={styles.bandWord}>{bandLevelLabel(band)}</span>
                </p>
              </div>
            );
          })}
        </div>
        {takenAt ? (
          <p className={styles.asOf}>Readings as of {formatKolkata(takenAt)} IST</p>
        ) : null}
      </section>

      <section aria-labelledby="last-24-hours-heading">
        <h2 id="last-24-hours-heading" className={styles.sectionTitle}>
          Last 24 hours
        </h2>
        {chartSeries.length === 0 ? (
          <p className={styles.empty}>No history is available for this zone yet.</p>
        ) : (
          <div className={styles.charts}>
            {chartSeries.map(({ metric, samples }) => {
              const meta = METRIC_META[metric];
              const threshold = THRESHOLDS[metric];
              if (!meta || !threshold) return null;
              return (
                <div className={`panel ${styles.chartPanel}`} key={metric}>
                  <div className={styles.chartHead}>
                    <h3 className={styles.chartTitle}>{meta.shortLabel}</h3>
                    <p className={styles.chartMeta}>
                      Threshold bands <span className="num">{threshold.goodMax}</span> /{" "}
                      <span className="num">{threshold.alertMin}</span> {threshold.unit}
                    </p>
                  </div>
                  <TimeSeriesChart
                    data={samples}
                    thresholds={[threshold.goodMax, threshold.alertMin]}
                    height={180}
                    ariaLabel={`${meta.label} in ${zone.name} over the last 24 hours`}
                    className={styles.chart}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="devices-heading">
        <h2 id="devices-heading" className={styles.sectionTitle}>
          Devices in this zone
        </h2>
        {devices.length === 0 ? (
          <p className={styles.empty}>No devices are registered in this zone yet.</p>
        ) : (
          <div className="table--scroll">
            <table className={`table ${styles.devicesTable}`}>
              <caption className="sr-only">Devices installed in {zone.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  <th scope="col">Ref</th>
                  <th scope="col">Metric</th>
                  <th scope="col">Model</th>
                  <th scope="col">Status</th>
                  <th scope="col">Battery</th>
                  <th scope="col">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const meta = METRIC_META[device.metric];
                  return (
                    <tr key={device.id}>
                      <th scope="row">{device.name}</th>
                      <td className="num">{device.ref}</td>
                      <td>{meta ? meta.shortLabel : device.metric}</td>
                      <td>{device.model}</td>
                      <td>
                        <StatusBadge tone={deviceTone(device.status)}>{deviceLabel(device.status)}</StatusBadge>
                      </td>
                      <td className="num">{device.batteryPercent}%</td>
                      <td>
                        <RelativeTime iso={device.lastSeenAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="zone-alerts-heading">
        <h2 id="zone-alerts-heading" className={styles.sectionTitle}>
          Alerts for this zone
        </h2>
        {sortedAlerts.length === 0 ? (
          <p className={styles.empty}>No alerts have been raised for this zone.</p>
        ) : (
          <ul className={styles.alerts}>
            {sortedAlerts.map((alert) => (
              <li key={alert.id} className={styles.alertItem}>
                <span className={`status-dot status-dot--${severityTone(alert.severity)}`} aria-hidden="true" />
                <div className={styles.alertBody}>
                  <p className={styles.alertTitle}>{alert.title}</p>
                  <p className={styles.alertMeta}>
                    {alert.ref} · raised {formatKolkata(alert.raisedAt, { format: "full" })}
                  </p>
                </div>
                <StatusBadge tone={alertStatusTone(alert.status)}>{alertStatusLabel(alert.status)}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
