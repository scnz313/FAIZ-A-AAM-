/**
 * Pure domain logic for the campus-environment (IoT) slice.
 *
 * No React, no data access, no side effects: thresholds, AQI band math,
 * status classification and display formatting only. All timestamps in this
 * codebase are UTC ISO-8601 strings; the Asia/Kolkata time zone is applied
 * exclusively here at display time.
 *
 * Threshold values are school-campaign values for a winter session in
 * Kashmir (fictional demo data — no real students, staff, or buildings).
 */

import {
  AQI_BAND_LABELS,
  METRIC_META,
  METRIC_TYPES,
  type AqiBand,
  type AlertSeverity,
  type AlertStatus,
  type MetricType,
} from "@fass/contracts";

/* ------------------------------------------------------------------ */
/* History ranges                                                      */
/* ------------------------------------------------------------------ */

export type RangeKey = "6h" | "24h" | "7d" | "30d";

export const RANGE_HOURS: Record<RangeKey, number> = {
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

/* ------------------------------------------------------------------ */
/* Thresholds and band classification                                  */
/* ------------------------------------------------------------------ */

export type BandLevel = "good" | "watch" | "alert";

export interface MetricThreshold {
  /** Values ≤ goodMax are "good". */
  goodMax: number;
  /** Values ≥ alertMin are "alert" (for light_lux: values < alertMin are "alert" — too dark). */
  alertMin: number;
  unit: string;
  label: string;
  note: string;
}

export const THRESHOLDS: Record<MetricType, MetricThreshold> = {
  temp_c: {
    goodMax: 26,
    alertMin: 32,
    unit: "°C",
    label: "Temperature",
    note: "Comfort band 12–26 °C; below 12 °C is a cold alert, above 32 °C a heat alert.",
  },
  humidity_pct: {
    goodMax: 60,
    alertMin: 75,
    unit: "%",
    label: "Relative humidity",
    note: "Above 75% feels stuffy and promotes mould; winter heating keeps it low.",
  },
  co2_ppm: {
    goodMax: 900,
    alertMin: 1400,
    unit: "ppm",
    label: "Carbon dioxide",
    note: "Above 1,400 ppm signals poor ventilation; target under 900 ppm in occupied rooms.",
  },
  pm25_ugm3: {
    goodMax: 60,
    alertMin: 120,
    unit: "µg/m³",
    label: "PM2.5",
    note: "24-hour CPCB exposure guidance, simplified for live display.",
  },
  pm10_ugm3: {
    goodMax: 100,
    alertMin: 250,
    unit: "µg/m³",
    label: "PM10",
    note: "24-hour CPCB exposure guidance, simplified for live display.",
  },
  noise_db: {
    goodMax: 55,
    alertMin: 75,
    unit: "dB(A)",
    label: "Noise",
    note: "Above 75 dB(A) disrupts teaching; 55 dB(A) is the comfort ceiling.",
  },
  light_lux: {
    goodMax: 1500,
    alertMin: 50,
    unit: "lux",
    label: "Illuminance",
    note: "Below 50 lux is too dark to read; above 1,500 lux is glare.",
  },
};

/** Classify a single reading into good / watch / alert.
 * Special cases: temp_c below 12 °C is an alert (cold), and light_lux below
 * 50 lux is an alert (too dark) while above 1,500 lux is only "watch" (glare).
 */
export function bandForMetric(metric: MetricType, value: number): BandLevel {
  const t = THRESHOLDS[metric];
  if (metric === "temp_c") {
    if (value < 12) return "alert";
  } else if (metric === "light_lux") {
    if (value < t.alertMin) return "alert";
    if (value <= t.goodMax) return "good";
    return "watch";
  }
  if (value <= t.goodMax) return "good";
  if (value >= t.alertMin) return "alert";
  return "watch";
}

/* ------------------------------------------------------------------ */
/* Chart band layout                                                    */
/* ------------------------------------------------------------------ */

export interface ChartBandRect {
  /** Value-axis span: the band tints values between `from` and `to` (order irrelevant, infinities allowed). */
  from: number;
  to: number;
  tone: BandLevel;
}

/**
 * Explicit tinted-region layout for a metric's goodMax / alertMin pair.
 * Most metrics read "higher = worse", so the alert zone sits at the high
 * end; light_lux and temp_c invert (dark / cold alerts live at the low end),
 * and temp_c adds a second alert band at the hot end.
 */
export function bandRectsFor(metric: MetricType, goodMax: number, alertMin: number): ChartBandRect[] {
  if (metric === "light_lux") {
    return [
      { from: Number.NEGATIVE_INFINITY, to: alertMin, tone: "alert" },
      { from: alertMin, to: goodMax, tone: "good" },
    ];
  }
  if (metric === "temp_c") {
    return [
      { from: Number.NEGATIVE_INFINITY, to: 12, tone: "alert" },
      { from: 12, to: goodMax, tone: "good" },
      { from: goodMax, to: alertMin, tone: "watch" },
      { from: alertMin, to: Number.POSITIVE_INFINITY, tone: "alert" },
    ];
  }
  return [
    { from: Number.NEGATIVE_INFINITY, to: goodMax, tone: "good" },
    { from: goodMax, to: alertMin, tone: "watch" },
    { from: alertMin, to: Number.POSITIVE_INFINITY, tone: "alert" },
  ];
}

/* ------------------------------------------------------------------ */
/* CPCB AQI (India) from PM2.5 / PM10                                  */
/* ------------------------------------------------------------------ */

interface AqiSegment {
  lo: number;
  hi: number;
  idxLo: number;
  idxHi: number;
  band: AqiBand;
}

const PM25_SEGMENTS: readonly AqiSegment[] = [
  { lo: 0, hi: 30, idxLo: 0, idxHi: 50, band: "good" },
  { lo: 31, hi: 60, idxLo: 51, idxHi: 100, band: "satisfactory" },
  { lo: 61, hi: 90, idxLo: 101, idxHi: 200, band: "moderate" },
  { lo: 91, hi: 120, idxLo: 201, idxHi: 300, band: "poor" },
  { lo: 121, hi: 250, idxLo: 301, idxHi: 400, band: "very-poor" },
  { lo: 251, hi: 350, idxLo: 401, idxHi: 500, band: "severe" },
];

const PM10_SEGMENTS: readonly AqiSegment[] = [
  { lo: 0, hi: 50, idxLo: 0, idxHi: 50, band: "good" },
  { lo: 51, hi: 100, idxLo: 51, idxHi: 100, band: "satisfactory" },
  { lo: 101, hi: 250, idxLo: 101, idxHi: 200, band: "moderate" },
  { lo: 251, hi: 350, idxLo: 201, idxHi: 300, band: "poor" },
  { lo: 351, hi: 430, idxLo: 301, idxHi: 400, band: "very-poor" },
  { lo: 431, hi: 550, idxLo: 401, idxHi: 500, band: "severe" },
];

function aqiFromSegments(value: number, segments: readonly AqiSegment[]): { index: number; band: AqiBand } {
  const v = Math.max(0, value);
  for (const s of segments) {
    if (v <= s.hi) {
      const ratio = (v - s.lo) / (s.hi - s.lo);
      return { index: Math.round(s.idxLo + ratio * (s.idxHi - s.idxLo)), band: s.band };
    }
  }
  return { index: 500, band: "severe" };
}

/** CPCB AQI from PM2.5 (24-hour scale, linear within breakpoint segments). */
export function aqiFromPm25(pm25: number): { index: number; band: AqiBand } {
  return aqiFromSegments(pm25, PM25_SEGMENTS);
}

/** CPCB AQI from PM10 (24-hour scale, linear within breakpoint segments). */
export function aqiFromPm10(pm10: number): { index: number; band: AqiBand } {
  return aqiFromSegments(pm10, PM10_SEGMENTS);
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** Format a metric value with the canonical unit and decimals from METRIC_META. */
export function formatMetricValue(metric: MetricType, value: number): string {
  const meta = METRIC_META[metric];
  return `${value.toFixed(meta.decimals)} ${meta.unit}`;
}

export type KolkataFormat = "time" | "day" | "full" | "short";

const KOLKATA_TZ = "Asia/Kolkata";

function kolkataParts(iso: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-IN", {
    timeZone: KOLKATA_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(iso))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return parts;
}

/**
 * Format a UTC ISO timestamp in Asia/Kolkata.
 * Presets: "time" → 08:30 · "day" → Mon 03 Aug · "full" → Mon, 03 Aug 2026 · 08:30 IST · "short" → 03 Aug · 08:30
 */
export function formatKolkata(iso: string, opts: { format?: KolkataFormat } = {}): string {
  const p = kolkataParts(iso);
  const weekday = p.weekday ?? "";
  const day = p.day ?? "";
  const month = p.month ?? "";
  const year = p.year ?? "";
  const hour = p.hour ?? "00";
  const minute = p.minute ?? "00";
  switch (opts.format ?? "time") {
    case "time":
      return `${hour}:${minute}`;
    case "day":
      return `${weekday} ${day} ${month}`;
    case "full":
      return `${weekday}, ${day} ${month} ${year} · ${hour}:${minute} IST`;
    case "short":
      return `${day} ${month} · ${hour}:${minute}`;
  }
}

/** "just now" / "2 min ago" / "3 hr ago" / "1 day ago" / "2 weeks ago" — computed at render time. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(diffMs / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

/* ------------------------------------------------------------------ */
/* Zone status                                                         */
/* ------------------------------------------------------------------ */

export type ZoneStatus = "comfortable" | "watch" | "action";

/**
 * Worst band across all present metrics: "action" if any metric is in alert,
 * "watch" if any is in watch, otherwise "comfortable".
 * A zone with no monitored metrics reports "comfortable" (the wallboard
 * contract has no "unknown" state).
 */
export function zoneStatus(current: Partial<Record<MetricType, number>>): ZoneStatus {
  let hasWatch = false;
  for (const metric of METRIC_TYPES) {
    const value = current[metric];
    if (typeof value !== "number" || Number.isNaN(value)) continue;
    const band = bandForMetric(metric, value);
    if (band === "alert") return "action";
    if (band === "watch") hasWatch = true;
  }
  return hasWatch ? "watch" : "comfortable";
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/** Human label for a zone floor; null or 0 is the ground floor. */
export function floorLabel(floor: number | null): string {
  return floor === null || floor === 0 ? "Ground" : `Floor ${floor}`;
}

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
};

export const BAND_LABELS: Record<BandLevel, string> = {
  good: "Good",
  watch: "Watch",
  alert: "Alert",
};

export const ZONE_STATUS_LABELS: Record<ZoneStatus, string> = {
  comfortable: "Comfortable",
  watch: "Watch",
  action: "Action needed",
};

export function alertSeverityLabel(severity: AlertSeverity): string {
  return ALERT_SEVERITY_LABELS[severity];
}

export function alertStatusLabel(status: AlertStatus): string {
  return ALERT_STATUS_LABELS[status];
}

export function aqiBandLabel(band: AqiBand): string {
  return AQI_BAND_LABELS[band];
}

export function bandLevelLabel(band: BandLevel): string {
  return BAND_LABELS[band];
}

export function zoneStatusLabel(status: ZoneStatus): string {
  return ZONE_STATUS_LABELS[status];
}
