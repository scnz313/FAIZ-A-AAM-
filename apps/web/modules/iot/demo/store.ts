/**
 * In-memory demo store for the campus-environment (IoT) slice.
 *
 * Module-level, client-safe (no Node APIs). Zones and devices come from the
 * fictional campus fixture; alerts are hand-written with fixed references.
 * All timestamps are UTC ISO-8601 strings; offsets are relative to module
 * load so "raised a few hours ago" stays stable within a session.
 *
 * All data is fictional demo data for interface development.
 */

import type { Alert, Device, MetricType, Zone, ZoneCurrent } from "@fass/contracts";
import { DEVICES, ZONES } from "./campus";
import { currentValue } from "./generator";

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const ZONE_6A = "3f1c8f2e-0001-4a2b-9c3d-000000000000";
const ZONE_8A = "3f1c8f2e-0003-4a2b-9c3d-000000000000";
const ZONE_10B = "3f1c8f2e-0005-4a2b-9c3d-000000000000";
const ZONE_LIBRARY = "3f1c8f2e-0006-4a2b-9c3d-000000000000";
const ZONE_LAB = "3f1c8f2e-0007-4a2b-9c3d-000000000000";
const ZONE_CORRIDOR = "3f1c8f2e-0008-4a2b-9c3d-000000000000";
const ZONE_COURTYARD = "3f1c8f2e-000b-4a2b-9c3d-000000000000";
const ZONE_PLAYGROUND = "3f1c8f2e-000c-4a2b-9c3d-000000000000";

const DEV_6A_TEMP = "7d2e9f41-0001-4a2b-9c3d-000000000001";
const DEV_8A_CO2 = "7d2e9f41-0006-4a2b-9c3d-000000000006";
const DEV_10B_CO2 = "7d2e9f41-0011-4a2b-9c3d-000000000011";
const DEV_LIBRARY_LIGHT = "7d2e9f41-0015-4a2b-9c3d-000000000015";
const DEV_LAB_NOISE = "7d2e9f41-0018-4a2b-9c3d-000000000018";
const DEV_CORRIDOR_PM = "7d2e9f41-0019-4a2b-9c3d-000000000019";
const DEV_COURTYARD = "7d2e9f41-0023-4a2b-9c3d-000000000023";
const DEV_PLAYGROUND_PM = "7d2e9f41-0024-4a2b-9c3d-000000000024";

const alertId = (n: number): string => `9f1c2e3d-00${String(n).padStart(2, "0")}-4a2b-9c3d-0000000000${String(n).padStart(2, "0")}`;

const ALERTS: readonly Alert[] = [
  {
    id: alertId(1),
    ref: "AL-1001",
    severity: "critical",
    metric: "co2_ppm",
    zoneId: ZONE_8A,
    deviceId: DEV_8A_CO2,
    title: "Class 8-A CO₂ above 1,400 ppm",
    detail: "CO₂ readings exceeded 1,400 ppm during second period. Open windows and check ventilation before next period.",
    raisedAt: ago(2 * HOUR),
    status: "open",
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  },
  {
    id: alertId(2),
    ref: "AL-1002",
    severity: "warning",
    metric: "pm25_ugm3",
    zoneId: ZONE_PLAYGROUND,
    deviceId: DEV_PLAYGROUND_PM,
    title: "Playground PM2.5 elevated — outdoor activity advisory",
    detail: "PM2.5 around 115 µg/m³. Consider keeping morning assembly indoors and advising masks for sensitive students.",
    raisedAt: ago(3 * HOUR),
    status: "open",
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  },
  {
    id: alertId(3),
    ref: "AL-1003",
    severity: "warning",
    metric: "noise_db",
    zoneId: ZONE_LAB,
    deviceId: DEV_LAB_NOISE,
    title: "Physics lab noise above comfort level",
    detail: "Sustained noise above 75 dB(A) during the practical class.",
    raisedAt: ago(5 * HOUR),
    status: "acknowledged",
    acknowledgedAt: ago(4 * HOUR),
    acknowledgedBy: "R. Kaul (facilities)",
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  },
  {
    id: alertId(4),
    ref: "AL-1004",
    severity: "info",
    metric: "light_lux",
    zoneId: ZONE_LIBRARY,
    deviceId: DEV_LIBRARY_LIGHT,
    title: "Library illuminance low — check tube lights",
    detail: "Illuminance below 50 lux in the evening session. Check tube lights in reading bays 2–3.",
    raisedAt: ago(6 * HOUR),
    status: "open",
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  },
  {
    id: alertId(5),
    ref: "AL-1005",
    severity: "info",
    metric: "temp_c",
    zoneId: ZONE_COURTYARD,
    deviceId: DEV_COURTYARD,
    title: "Courtyard sensor on low battery",
    detail: "Outdoor station battery at 20%. Schedule a battery replacement this week.",
    raisedAt: ago(9 * HOUR),
    status: "acknowledged",
    acknowledgedAt: ago(7 * HOUR),
    acknowledgedBy: "F. Manager (demo)",
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  },
  {
    id: alertId(6),
    ref: "AL-1006",
    severity: "warning",
    metric: "pm25_ugm3",
    zoneId: ZONE_CORRIDOR,
    deviceId: DEV_CORRIDOR_PM,
    title: "Corridor PM2.5 spike resolved",
    detail: "Short-lived PM2.5 spike during floor cleaning; cleared after ventilation.",
    raisedAt: ago(26 * HOUR),
    status: "resolved",
    acknowledgedAt: ago(25 * HOUR),
    acknowledgedBy: "R. Kaul (facilities)",
    resolvedAt: ago(20 * HOUR),
    resolvedBy: "R. Kaul (facilities)",
    resolutionNote: "Spike cleared after floor mopping and window ventilation; no repeat since.",
  },
  {
    id: alertId(7),
    ref: "AL-1007",
    severity: "critical",
    metric: "co2_ppm",
    zoneId: ZONE_10B,
    deviceId: DEV_10B_CO2,
    title: "Class 10-B CO₂ high during first period",
    detail: "CO₂ above 1,400 ppm for 40 minutes during first period.",
    raisedAt: ago(2 * DAY),
    status: "resolved",
    acknowledgedAt: ago(46 * HOUR),
    acknowledgedBy: "F. Manager (demo)",
    resolvedAt: ago(44 * HOUR),
    resolvedBy: "F. Manager (demo)",
    resolutionNote: "Windows opened and ventilator serviced; CO₂ back to normal.",
  },
  {
    id: alertId(8),
    ref: "AL-1008",
    severity: "warning",
    metric: "temp_c",
    zoneId: ZONE_6A,
    deviceId: DEV_6A_TEMP,
    title: "Class 6-A morning temperature low",
    detail: "Classroom below 16 °C at morning assembly. Check room heater.",
    raisedAt: ago(3 * DAY),
    status: "resolved",
    acknowledgedAt: ago(70 * HOUR),
    acknowledgedBy: "R. Kaul (facilities)",
    resolvedAt: ago(69 * HOUR),
    resolvedBy: "R. Kaul (facilities)",
    resolutionNote: "Heater serviced; morning temperature now within comfort band.",
  },
];

/* ------------------------------------------------------------------ */
/* Mutable store state                                                 */
/* ------------------------------------------------------------------ */

let alerts: Alert[] = [...ALERTS];

/* ------------------------------------------------------------------ */
/* Zones                                                               */
/* ------------------------------------------------------------------ */

export function listZones(): Zone[] {
  return [...ZONES];
}

export function getZone(zoneId: string): Zone | null {
  return ZONES.find((z) => z.id === zoneId) ?? null;
}

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

export function getDevices(): Device[] {
  return [...DEVICES].sort((a, b) => a.ref.localeCompare(b.ref));
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

/** Alerts sorted newest-first. */
export function listAlerts(): Alert[] {
  return [...alerts].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
}

export function getAlert(alertIdToFind: string): Alert | null {
  return alerts.find((a) => a.id === alertIdToFind) ?? null;
}

export function acknowledgeAlert(alertIdToFind: string, by: string): Alert | null {
  const alert = alerts.find((a) => a.id === alertIdToFind);
  if (!alert || alert.status === "resolved") return null;
  alert.status = "acknowledged";
  alert.acknowledgedAt = new Date().toISOString();
  alert.acknowledgedBy = by;
  return alert;
}

export function resolveAlert(alertIdToFind: string, note: string, by: string): Alert | null {
  const alert = alerts.find((a) => a.id === alertIdToFind);
  if (!alert || alert.status === "resolved") return null;
  const now = new Date().toISOString();
  alert.status = "resolved";
  alert.resolvedAt = now;
  alert.resolvedBy = by;
  alert.resolutionNote = note;
  if (!alert.acknowledgedAt) {
    alert.acknowledgedAt = now;
    alert.acknowledgedBy = by;
  }
  return alert;
}

/* ------------------------------------------------------------------ */
/* Current readings                                                    */
/* ------------------------------------------------------------------ */

/**
 * Latest snapshot for a zone: one value per metric that has a device in the
 * zone. Offline and maintenance devices do not contribute readings; a
 * low-battery device still reads. takenAt matches the generator's 15-minute
 * grid so charts and the "live" card agree.
 */
export function currentForZone(zoneId: string): ZoneCurrent | null {
  if (!getZone(zoneId)) return null;
  const metrics = new Set<MetricType>(
    DEVICES.filter((d) => d.zoneId === zoneId && (d.status === "online" || d.status === "low-battery")).map((d) => d.metric),
  );
  const readings = {} as Record<MetricType, number>;
  for (const metric of metrics) {
    readings[metric] = currentValue(zoneId, metric);
  }
  const takenAt = new Date(Math.floor(Date.now() / 900_000) * 900_000).toISOString();
  return { zoneId, readings, takenAt };
}
