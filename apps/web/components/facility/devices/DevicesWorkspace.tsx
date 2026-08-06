"use client";

import { useMemo, useState } from "react";
import { DEVICE_STATUSES, METRIC_META, METRIC_TYPES } from "@fass/contracts";
import type { Device, DeviceStatus, MetricType, SeriesSample, Zone } from "@fass/contracts";
import Button from "@/components/ui/Button";
import RelativeTime from "@/components/ui/RelativeTime";
import { Sparkline } from "@/components/ui/Sparkline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getDeviceHistory, getDevices } from "@/lib/iot/api";
import { BAND_LABELS, bandForMetric, formatKolkata, formatMetricValue } from "@/modules/iot/domain";
import styles from "./DevicesWorkspace.module.css";

type MetricFilter = "all" | MetricType;
type StatusFilter = "all" | DeviceStatus;

const DEVICE_TONE: Record<DeviceStatus, "good" | "watch" | "neutral" | "offline"> = {
  online: "good",
  offline: "offline",
  "low-battery": "watch",
  maintenance: "neutral",
};

const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  online: "Online",
  offline: "Offline",
  "low-battery": "Low battery",
  maintenance: "Maintenance",
};

type DetailState = {
  device: Device;
  samples: SeriesSample[] | null;
  loading: boolean;
  error: string | null;
};

type DevicesWorkspaceProps = {
  zones: Zone[];
  initialDevices: Device[] | null;
};

export function DevicesWorkspace({ zones, initialDevices }: DevicesWorkspaceProps) {
  const [devices, setDevices] = useState<Device[] | null>(initialDevices);
  const [search, setSearch] = useState("");
  const [metricFilter, setMetricFilter] = useState<MetricFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const zoneNames = useMemo(() => new Map(zones.map((z) => [z.id, z.name])), [zones]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (devices ?? []).filter((device) => {
      if (metricFilter !== "all" && device.metric !== metricFilter) return false;
      if (statusFilter !== "all" && device.status !== statusFilter) return false;
      if (query && !`${device.name} ${device.ref} ${device.model}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [devices, search, metricFilter, statusFilter]);

  const onlineCount = useMemo(() => visible.filter((d) => d.status === "online").length, [visible]);

  async function reload() {
    try {
      setDevices(await getDevices());
    } catch {
      setDevices(null);
    }
  }

  function resetFilters() {
    setSearch("");
    setMetricFilter("all");
    setStatusFilter("all");
  }

  async function selectDevice(device: Device) {
    setSelectedId(device.id);
    setDetail({ device, samples: null, loading: true, error: null });
    try {
      const history = await getDeviceHistory(device.id, device.metric, "24h");
      setDetail((prev) =>
        prev && prev.device.id === device.id ? { ...prev, samples: history.samples, loading: false } : prev,
      );
    } catch {
      setDetail((prev) =>
        prev && prev.device.id === device.id
          ? { ...prev, loading: false, error: "Could not load readings for this device." }
          : prev,
      );
    }
  }

  const detailLatest = detail?.samples && detail.samples.length > 0 ? detail.samples[detail.samples.length - 1] : null;
  const detailBand = detail && detailLatest ? bandForMetric(detail.device.metric, detailLatest.value) : null;

  if (devices === null) {
    return (
      <div className="workspace-state" role="alert">
        <p className="workspace-state-title">Could not load devices</p>
        <p className="workspace-state-note">The device registry did not respond. Retry to load the sensor fleet.</p>
        <Button variant="quiet" onClick={() => void reload()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.controls}>
        <div className={styles.field}>
          <label htmlFor="device-search">Search</label>
          <input
            id="device-search"
            className="input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, ref or model"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="device-metric">Metric</label>
          <select
            id="device-metric"
            className="select"
            value={metricFilter}
            onChange={(event) => setMetricFilter(event.target.value as MetricFilter)}
          >
            <option value="all">All metrics</option>
            {METRIC_TYPES.map((m) => (
              <option key={m} value={m}>
                {METRIC_META[m].shortLabel}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="device-status">Status</label>
          <select
            id="device-status"
            className="select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="all">All statuses</option>
            {DEVICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DEVICE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.tableMeta}>
        <p className={styles.countLine}>
          {visible.length} device{visible.length === 1 ? "" : "s"} · {onlineCount} online
        </p>
        <span className="demo-badge">Fictional demo devices</span>
      </div>

      {visible.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No devices match your filters</p>
          <p className="workspace-state-note">Try a different search term, or clear the metric and status filters.</p>
          <Button variant="quiet" onClick={resetFilters}>
            Reset filters
          </Button>
        </div>
      ) : (
        <div className="table table--scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">Ref</th>
                <th scope="col">Zone</th>
                <th scope="col">Metric</th>
                <th scope="col">Model</th>
                <th scope="col">Status</th>
                <th scope="col">Battery</th>
                <th scope="col">Last seen</th>
                <th scope="col">Installed</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((device) => {
                const selected = device.id === selectedId;
                return (
                  <tr
                    key={device.id}
                    className={`${styles.rowSelectable}${selected ? ` ${styles.rowSelected}` : ""}`}
                    onClick={() => void selectDevice(device)}
                  >
                    <td>
                      <button
                        type="button"
                        className={styles.rowButton}
                        aria-pressed={selected}
                        onClick={(event) => {
                          event.stopPropagation();
                          void selectDevice(device);
                        }}
                      >
                        {device.name}
                      </button>
                    </td>
                    <td className="num">{device.ref}</td>
                    <td>{zoneNames.get(device.zoneId) ?? "Unknown zone"}</td>
                    <td>{METRIC_META[device.metric].shortLabel}</td>
                    <td>{device.model}</td>
                    <td>
                      <StatusBadge tone={DEVICE_TONE[device.status]}>{DEVICE_STATUS_LABELS[device.status]}</StatusBadge>
                    </td>
                    <td className="num">
                      {device.batteryPercent < 25 && <span className={styles.batteryDot} aria-hidden="true" />}
                      {device.batteryPercent}%
                    </td>
                    <td>
                      <RelativeTime iso={device.lastSeenAt} />
                    </td>
                    <td>{formatKolkata(device.installedAt, { format: "short" })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <section className="panel" aria-label={`${detail.device.name} detail`}>
          <div className={styles.detailHead}>
            <div>
              <p className="section-label">Device detail</p>
              <h2 className={styles.detailTitle}>
                {detail.device.name} <span className={styles.detailRef}>· {detail.device.ref}</span>
              </h2>
            </div>
            <span className="demo-badge">Fictional demo device</span>
          </div>

          <dl className={styles.detailGrid}>
            <div className={styles.detailCell}>
              <dt>Model</dt>
              <dd>{detail.device.model}</dd>
            </div>
            <div className={styles.detailCell}>
              <dt>Zone</dt>
              <dd>{zoneNames.get(detail.device.zoneId) ?? "Unknown zone"}</dd>
            </div>
            <div className={styles.detailCell}>
              <dt>Metric</dt>
              <dd>{METRIC_META[detail.device.metric].label}</dd>
            </div>
            <div className={styles.detailCell}>
              <dt>Status</dt>
              <dd>
                <StatusBadge tone={DEVICE_TONE[detail.device.status]}>
                  {DEVICE_STATUS_LABELS[detail.device.status]}
                </StatusBadge>
              </dd>
            </div>
            <div className={styles.detailCell}>
              <dt>Battery</dt>
              <dd className="num">{detail.device.batteryPercent}%</dd>
            </div>
            <div className={styles.detailCell}>
              <dt>Installed</dt>
              <dd>{formatKolkata(detail.device.installedAt, { format: "short" })}</dd>
            </div>
            <div className={styles.detailCell}>
              <dt>Calibrated</dt>
              <dd>{formatKolkata(detail.device.calibratedAt, { format: "short" })}</dd>
            </div>
            <div className={styles.detailCell}>
              <dt>Last seen</dt>
              <dd>
                <RelativeTime iso={detail.device.lastSeenAt} />
              </dd>
            </div>
          </dl>

          <div className={styles.currentLine}>
            {detail.loading ? (
              <p className={styles.loadingNote} role="status">
                Loading readings…
              </p>
            ) : detail.error ? (
              <p className="workspace-state-note" role="alert">
                {detail.error}{" "}
                <Button variant="quiet" onClick={() => void selectDevice(detail.device)}>
                  Retry
                </Button>
              </p>
            ) : detailLatest && detailBand ? (
              <>
                <span className={`status-dot status-dot--${detailBand}`} aria-hidden="true" />
                <p className={`num ${styles.currentValue}`}>
                  {formatMetricValue(detail.device.metric, detailLatest.value)}
                </p>
                <p className={styles.currentBand}>{BAND_LABELS[detailBand]} · latest sample</p>
              </>
            ) : (
              <p className="workspace-state-note">No readings recorded in the last 24 hours.</p>
            )}
          </div>

          {!detail.loading && !detail.error && detail.samples && (
            <div className={styles.sparkWrap}>
              <p className="section-label">24-hour trend</p>
              {detail.samples.length > 0 ? (
                <Sparkline
                  data={detail.samples.map((sample) => sample.value)}
                  ariaLabel={`${detail.device.name} ${METRIC_META[detail.device.metric].shortLabel} trend, last 24 hours`}
                  className={styles.spark}
                />
              ) : (
                <p className="workspace-state-note">No samples in the last 24 hours.</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
