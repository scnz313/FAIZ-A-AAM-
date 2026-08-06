"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { METRIC_META } from "@fass/contracts";
import type { HistorySeries, MetricType, SeriesSample, Zone } from "@fass/contracts";
import Button from "@/components/ui/Button";
import { TimeSeriesChart } from "@/components/ui/TimeSeriesChart";
import { getZoneHistory, getZones } from "@/lib/iot/api";
import { THRESHOLDS, formatMetricValue } from "@/modules/iot/domain";
import type { RangeKey } from "@/modules/iot/domain";
import styles from "./HistoryWorkspace.module.css";

const DEFAULT_METRIC: MetricType = "co2_ppm";
const DEFAULT_RANGE: RangeKey = "24h";

const METRIC_TABS: ReadonlyArray<{ key: MetricType; label: string }> = [
  { key: "co2_ppm", label: "CO₂" },
  { key: "pm25_ugm3", label: "PM2.5" },
  { key: "temp_c", label: "Temperature" },
  { key: "humidity_pct", label: "Humidity" },
  { key: "noise_db", label: "Noise" },
  { key: "light_lux", label: "Light" },
  { key: "pm10_ugm3", label: "PM10" },
];

const RANGE_TABS: ReadonlyArray<{ key: RangeKey; label: string }> = [
  { key: "6h", label: "6h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

type BandTone = "good" | "watch" | "alert";

type Band = { value: number; label: string; tone: BandTone };

/** Chart threshold bands from the domain THRESHOLDS record (goodMax / alertMin). */
function bandsFor(metric: MetricType): Band[] {
  const thresholds = THRESHOLDS[metric];
  return [
    { value: thresholds.goodMax, label: "Good", tone: "good" },
    { value: thresholds.alertMin, label: "Alert", tone: "alert" },
  ];
}

type Summary = { current: number; min: number; max: number; mean: number };

function summarize(samples: SeriesSample[]): Summary | null {
  const first = samples[0];
  if (!first) return null;
  let min = first.value;
  let max = first.value;
  let sum = first.value;
  for (let i = 1; i < samples.length; i += 1) {
    const sample = samples[i];
    if (!sample) continue;
    if (sample.value < min) min = sample.value;
    if (sample.value > max) max = sample.value;
    sum += sample.value;
  }
  const last = samples[samples.length - 1];
  return { current: last?.value ?? first.value, min, max, mean: sum / samples.length };
}

type HistoryWorkspaceProps = {
  zones: Zone[];
  defaultZoneId: string | null;
  initialSeries: HistorySeries | null;
  initialError: boolean;
};

export function HistoryWorkspace({ zones, defaultZoneId, initialSeries, initialError }: HistoryWorkspaceProps) {
  const [zonesState, setZonesState] = useState<Zone[]>(zones);
  const [zoneId, setZoneId] = useState<string | null>(defaultZoneId);
  const [metric, setMetric] = useState<MetricType>(DEFAULT_METRIC);
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const [series, setSeries] = useState<HistorySeries | null>(() =>
    initialSeries && initialSeries.zoneId === defaultZoneId && initialSeries.metric === DEFAULT_METRIC
      ? initialSeries
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ? "Could not load history." : null);

  const requestRef = useRef(0);
  const initialUsedRef = useRef(false);

  const load = useCallback(async (zone: string, m: MetricType, r: RangeKey) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getZoneHistory(zone, m, r);
      if (requestRef.current === requestId) {
        setSeries(next);
        setLoading(false);
      }
    } catch {
      if (requestRef.current === requestId) {
        setSeries(null);
        setError("Could not load history for this selection.");
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!zoneId) return;
    if (!initialUsedRef.current) {
      initialUsedRef.current = true;
      if (initialSeries && initialSeries.zoneId === zoneId && initialSeries.metric === metric && range === DEFAULT_RANGE) {
        return;
      }
    }
    void load(zoneId, metric, range);
  }, [zoneId, metric, range, load, initialSeries]);

  async function retry() {
    const requestId = ++requestRef.current;
    setError(null);
    setLoading(true);
    try {
      const zonesData = await getZones();
      const freshZones = zonesData.zones;
      const firstZone = freshZones[0]?.id ?? null;
      setZonesState(freshZones);
      setZoneId(firstZone);
      if (firstZone) {
        const next = await getZoneHistory(firstZone, metric, range);
        if (requestRef.current === requestId) {
          setSeries(next);
          setLoading(false);
        }
      } else if (requestRef.current === requestId) {
        setLoading(false);
      }
    } catch {
      if (requestRef.current === requestId) {
        setError("Could not load history. Check the sensor service and retry.");
        setLoading(false);
      }
    }
  }

  const zoneName = useMemo(() => zonesState.find((z) => z.id === zoneId)?.name ?? "Zone", [zonesState, zoneId]);
  const metricMeta = METRIC_META[metric];
  const rangeLabel = RANGE_TABS.find((t) => t.key === range)?.label ?? range;
  const stats = useMemo(() => summarize(series?.samples ?? []), [series]);

  if (zonesState.length === 0) {
    return (
      <div className="workspace-state">
        <p className="workspace-state-title">{initialError ? "Could not load history" : "No zones configured"}</p>
        <p className="workspace-state-note">
          {initialError
            ? "The sensor service did not respond. Retry to load the zone list and the default series."
            : "Zone records are needed before reading history can be shown."}
        </p>
        <Button variant="quiet" onClick={() => void retry()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.controls}>
        <div className={styles.zoneField}>
          <label htmlFor="history-zone">Zone</label>
          <select
            id="history-zone"
            className="select"
            value={zoneId ?? ""}
            onChange={(event) => setZoneId(event.target.value === "" ? null : event.target.value)}
          >
            {zonesState.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.tabBlock}>
          <p className={styles.tabLabel}>Metric</p>
          <div className="tabs" role="group" aria-label="Metric">
            {METRIC_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={metric === tab.key ? "active" : undefined}
                aria-pressed={metric === tab.key}
                onClick={() => setMetric(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.tabBlock}>
          <p className={styles.tabLabel}>Range</p>
          <div className="tabs" role="group" aria-label="Time range">
            {RANGE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={range === tab.key ? "active" : undefined}
                aria-pressed={range === tab.key}
                onClick={() => setRange(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="panel" aria-busy={loading} aria-label="History chart">
        <div className={styles.panelHead}>
          <div>
            <p className="section-label">Selected series</p>
            <h2 className={styles.panelTitle}>
              {metricMeta.shortLabel} · {zoneName} · {rangeLabel}
            </h2>
          </div>
          <span className="demo-badge">Fictional demo readings</span>
        </div>

        {loading ? (
          <div className={styles.skeletonWrap} role="status">
            <div className={styles.skeleton} aria-hidden="true" />
            <p className={styles.loadingNote}>Loading readings…</p>
          </div>
        ) : error ? (
          <div className="workspace-state">
            <p className="workspace-state-title">Could not load history</p>
            <p className="workspace-state-note">{error}</p>
            <Button variant="quiet" onClick={() => void retry()}>
              Retry
            </Button>
          </div>
        ) : series && series.samples.length > 0 ? (
          <>
            <div className={styles.chartWrap}>
              <TimeSeriesChart
                series={series.samples}
                metric={metric}
                height={260}
                thresholds={bandsFor(metric)}
                ariaLabel={`${metricMeta.label} history for ${zoneName}, last ${rangeLabel}`}
                formatValue={(value: number) => formatMetricValue(metric, value)}
              />
            </div>
            {stats && (
              <div className="metric-grid" role="group" aria-label="Summary statistics for the selected period">
                <div className="metric-cell">
                  <p className="section-label">Current</p>
                  <p className="num">{formatMetricValue(metric, stats.current)}</p>
                  <p className={styles.statNote}>Latest sample</p>
                </div>
                <div className="metric-cell">
                  <p className="section-label">Minimum</p>
                  <p className="num">{formatMetricValue(metric, stats.min)}</p>
                  <p className={styles.statNote}>Over the {rangeLabel} window</p>
                </div>
                <div className="metric-cell">
                  <p className="section-label">Maximum</p>
                  <p className="num">{formatMetricValue(metric, stats.max)}</p>
                  <p className={styles.statNote}>Over the {rangeLabel} window</p>
                </div>
                <div className="metric-cell">
                  <p className="section-label">Mean</p>
                  <p className="num">{formatMetricValue(metric, stats.mean)}</p>
                  <p className={styles.statNote}>Over the {rangeLabel} window</p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="workspace-state">
            <p className="workspace-state-title">No readings recorded</p>
            <p className="workspace-state-note">
              No {metricMeta.label.toLowerCase()} samples exist for {zoneName} over the last {rangeLabel}.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
