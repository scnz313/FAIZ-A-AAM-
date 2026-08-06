/**
 * Client API facade for the campus-environment (IoT) slice.
 *
 * This is the ONE interface pages consume. It currently serves deterministic
 * fictional demo data from the in-memory store with simulated network latency
 * (200–350 ms), so UI work can proceed without a backend.
 *
 * Backend boundary: in the backend phase, server route handlers (see
 * `modules/iot/server/README.md`) will replace the demo store behind the exact
 * same signatures — no component should ever import the store or generator
 * directly.
 *
 * Conventions: all timestamps are UTC ISO-8601; every function returns a
 * Promise and never throws for a missing zone/device (returns null or empty
 * arrays); display formatting happens in `modules/iot/domain.ts`, not here.
 */

import type {
  Alert,
  Device,
  EnvironmentReport,
  HistorySeries,
  MetricType,
  OverviewSummary,
  WallboardSnapshot,
  Zone,
  ZoneCurrent,
} from "@fass/contracts";
import { METRIC_META } from "@fass/contracts";
import { RANGE_HOURS, bandForMetric, zoneStatus, type RangeKey } from "@/modules/iot/domain";
import { generateOutdoor, generateSeries, readingsFor, RANGE_STEP_MINUTES } from "@/modules/iot/demo/generator";
import * as store from "@/modules/iot/demo/store";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Simulated network latency — fixed so demo behavior stays deterministic. */
const latencyMs = (): number => 200;

async function respond<T>(compute: () => T): Promise<T> {
  await sleep(latencyMs());
  return compute();
}

const nowIso = (): string => new Date().toISOString();

/* ------------------------------------------------------------------ */
/* Overview / wallboard                                                */
/* ------------------------------------------------------------------ */

/**
 * Campus overview: outdoor conditions, indoor comfort counts by zone status,
 * open alert counts by severity, fleet status counts and the takenAt time.
 */
export async function getOverview(): Promise<OverviewSummary> {
  return respond((): OverviewSummary => {
    const zones = store.listZones();
    let comfortableZones = 0;
    let warnedZones = 0;
    for (const zone of zones) {
      const current = store.currentForZone(zone.id);
      if (!current) continue;
      if (zoneStatus(current.readings) === "comfortable") comfortableZones += 1;
      else warnedZones += 1;
    }
    const open = store.listAlerts().filter((a) => a.status === "open");
    const devices = store.getDevices();
    const fleet = {
      totalDevices: devices.length,
      online: devices.filter((d) => d.status === "online").length,
      offline: devices.filter((d) => d.status === "offline").length,
      lowBattery: devices.filter((d) => d.status === "low-battery").length,
      maintenance: devices.filter((d) => d.status === "maintenance").length,
    };
    return {
      outdoor: generateOutdoor(),
      indoorComfort: { totalZones: zones.length, comfortableZones, warnedZones },
      alerts: {
        openCritical: open.filter((a) => a.severity === "critical").length,
        openWarning: open.filter((a) => a.severity === "warning").length,
        openInfo: open.filter((a) => a.severity === "info").length,
      },
      fleet,
      takenAt: nowIso(),
    };
  });
}

/**
 * Hallway wallboard snapshot: outdoor conditions, per-zone status with the
 * latest readings, and the most recent actionable alert (open first, else
 * acknowledged, else null).
 */
export async function getWallboard(): Promise<WallboardSnapshot> {
  return respond((): WallboardSnapshot => {
    const zones = store.listZones().map((zone) => {
      const current = store.currentForZone(zone.id);
      const readings = current?.readings ?? {};
      return {
        zoneId: zone.id,
        zoneName: zone.name,
        kind: zone.kind,
        readings,
        status: zoneStatus(readings),
      };
    });
    const sortedAlerts = store.listAlerts();
    const latestAlert =
      sortedAlerts.find((a) => a.status === "open") ??
      sortedAlerts.find((a) => a.status === "acknowledged") ??
      null;
    return { takenAt: nowIso(), outdoor: generateOutdoor(), zones, latestAlert };
  });
}

/* ------------------------------------------------------------------ */
/* Zones                                                               */
/* ------------------------------------------------------------------ */

/** All zones plus a live snapshot per zone, keyed by zone id. */
export async function getZones(): Promise<{ zones: Zone[]; current: Record<string, ZoneCurrent> }> {
  return respond((): { zones: Zone[]; current: Record<string, ZoneCurrent> } => {
    const zones = store.listZones();
    const current: Record<string, ZoneCurrent> = {};
    for (const zone of zones) {
      const snapshot = store.currentForZone(zone.id);
      if (snapshot) current[zone.id] = snapshot;
    }
    return { zones, current };
  });
}

/** Live snapshot for one zone (null when the zone does not exist). */
export async function getZoneCurrent(zoneId: string): Promise<ZoneCurrent | null> {
  return respond((): ZoneCurrent | null => store.currentForZone(zoneId));
}

/** Zone detail: zone (null when missing), live snapshot, its devices and its alerts. */
export async function getZoneDetail(
  zoneId: string,
): Promise<{ zone: Zone | null; current: ZoneCurrent | null; devices: Device[]; alerts: Alert[] }> {
  return respond((): { zone: Zone | null; current: ZoneCurrent | null; devices: Device[]; alerts: Alert[] } => {
    const zone = store.getZone(zoneId);
    if (!zone) return { zone: null, current: null, devices: [], alerts: [] };
    const devices = store.getDevices().filter((d) => d.zoneId === zoneId);
    const alerts = store.listAlerts().filter((a) => a.zoneId === zoneId);
    return { zone, current: store.currentForZone(zoneId), devices, alerts };
  });
}

/** Devices in one zone (empty when the zone does not exist). */
export async function getZoneDevices(zoneId: string): Promise<Device[]> {
  return respond((): Device[] => {
    if (!store.getZone(zoneId)) return [];
    return store.getDevices().filter((d) => d.zoneId === zoneId);
  });
}

/** Alerts for one zone, newest first (empty when the zone does not exist). */
export async function getZoneAlerts(zoneId: string): Promise<Alert[]> {
  return respond((): Alert[] => {
    if (!store.getZone(zoneId)) return [];
    return store.listAlerts().filter((a) => a.zoneId === zoneId);
  });
}

/** History series for one zone + metric over a named range (empty samples for unknown zones). */
export async function getZoneHistory(zoneId: string, metric: MetricType, range: RangeKey): Promise<HistorySeries> {
  return respond((): HistorySeries => {
    if (!store.getZone(zoneId)) return { metric, zoneId, samples: [] };
    return readingsFor(zoneId, metric, range);
  });
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

/** All alerts, newest first. */
export async function getAlerts(): Promise<Alert[]> {
  return respond((): Alert[] => store.listAlerts());
}

/**
 * Acknowledge an alert. The default actor is the demo facilities manager.
 * Never throws: an unknown id yields a null-shaped result (callers pass ids
 * obtained from getAlerts(), so this is unreachable in practice).
 */
export async function acknowledgeAlert(alertId: string, by: string = "F. Manager (demo)"): Promise<Alert> {
  return respond((): Alert => store.acknowledgeAlert(alertId, by) ?? (null as unknown as Alert));
}

/**
 * Resolve an alert with a resolution note. The default actor is the demo
 * facilities manager. Never throws (see acknowledgeAlert).
 */
export async function resolveAlert(alertId: string, note: string, by: string = "F. Manager (demo)"): Promise<Alert> {
  return respond((): Alert => store.resolveAlert(alertId, note, by) ?? (null as unknown as Alert));
}

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

/** The full device registry, sorted by reference. */
export async function getDevices(): Promise<Device[]> {
  return respond((): Device[] => store.getDevices());
}

/**
 * History for a single device. A device lives in one zone, so the series is
 * the zone series seeded with the device id (slight per-device variation).
 * Empty samples for unknown devices.
 */
export async function getDeviceHistory(deviceId: string, metric: MetricType, range: RangeKey): Promise<HistorySeries> {
  return respond((): HistorySeries => {
    const device = store.getDevices().find((d) => d.id === deviceId);
    if (!device) return { metric, zoneId: "", samples: [] };
    return {
      metric,
      zoneId: device.zoneId,
      samples: generateSeries(metric, device.zoneId, {
        hours: RANGE_HOURS[range],
        stepMinutes: RANGE_STEP_MINUTES[range],
        deviceId,
      }),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

/** Deterministic report reference derived from the period start day (UTC). */
function reportRef(startMs: number): string {
  const d = new Date(startMs);
  const dayOfYear = Math.floor((startMs - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
  return `ER-${d.getUTCFullYear()}-${String(dayOfYear).padStart(3, "0")}`;
}

function reportId(startMs: number, metrics: readonly MetricType[]): string {
  let h = 0;
  const s = `report|${startMs}|${metrics.join(",")}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return `9f1c2e3d-0a1b-4a2b-9c3d-${h.toString(16).padStart(12, "0").slice(0, 12)}`;
}

const p95 = (sortedValues: readonly number[]): number => {
  const idx = Math.max(0, Math.ceil(sortedValues.length * 0.95) - 1);
  return sortedValues[idx] ?? 0;
};

/**
 * Generate an environment report over a period (capped at 30 days) for the
 * requested metrics. Zone stats are computed from the deterministic generator
 * and cover only zone × metric combinations that have a device. The summary
 * highlights the peak reading and total out-of-range hours.
 */
export async function generateReport(
  period: { from: string; to: string },
  metrics: MetricType[],
): Promise<EnvironmentReport> {
  return respond((): EnvironmentReport => {
    let start = Math.min(new Date(period.from).getTime(), new Date(period.to).getTime());
    const end = Math.max(new Date(period.from).getTime(), new Date(period.to).getTime());
    const MAX_PERIOD_MS = 30 * 24 * 3_600_000;
    if (end - start > MAX_PERIOD_MS) start = end - MAX_PERIOD_MS;
    const hours = Math.max(1, Math.round((end - start) / 3_600_000));
    const stepMinutes = RANGE_STEP_MINUTES[hours <= 24 ? "24h" : hours <= 24 * 7 ? "7d" : "30d"];

    const devices = store.getDevices();
    const zoneStats: EnvironmentReport["zoneStats"] = [];
    for (const zone of store.listZones()) {
      for (const metric of metrics) {
        const hasDevice = devices.some((d) => d.zoneId === zone.id && d.metric === metric);
        if (!hasDevice) continue;
        const series = generateSeries(metric, zone.id, { hours, stepMinutes });
        if (series.length === 0) continue;
        const values = series.map((s) => s.value);
        const sorted = [...values].sort((a, b) => a - b);
        const outOfRangeHours = (values.filter((v) => bandForMetric(metric, v) !== "good").length * stepMinutes) / 60;
        zoneStats.push({
          zoneId: zone.id,
          zoneName: zone.name,
          metric,
          avg: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)),
          min: Number(sorted[0]?.toFixed(1)),
          max: Number(sorted[sorted.length - 1]?.toFixed(1)),
          p95: Number(p95(sorted).toFixed(1)),
          hoursOutOfRange: Number(outOfRangeHours.toFixed(1)),
        });
      }
    }

    let summary: string;
    if (zoneStats.length === 0) {
      summary = "No monitored metrics in the selected period.";
    } else {
      // zoneStats.length > 0, so the initial reduce value is defined.
      const worst = zoneStats.reduce((a, b) => (b.max > a.max ? b : a), zoneStats[0]!);
      const meta = METRIC_META[worst.metric];
      const totalOutOfRange = zoneStats.reduce((a, s) => a + s.hoursOutOfRange, 0);
      const zoneCount = new Set(zoneStats.map((s) => s.zoneId)).size;
      summary = `Report covers ${zoneCount} zones × ${metrics.length} metrics. Peak: ${meta.shortLabel} ${worst.max}${meta.unit} in ${worst.zoneName}. Out-of-range hours: ${Math.round(totalOutOfRange)}.`;
    }

    return {
      id: reportId(start, metrics),
      ref: reportRef(start),
      periodStart: new Date(start).toISOString(),
      periodEnd: new Date(end).toISOString(),
      generatedAt: nowIso(),
      generatedBy: "F. Manager (demo)",
      summary,
      zoneStats,
    };
  });
}
