/**
 * Fictional campus fixture for the campus-environment (IoT) slice.
 *
 * Deterministic: fixed UUIDs, references and timestamps (relative offsets from
 * module load). All data is fictional — no real students, staff, or buildings.
 * Displayed readings are demo data for interface development.
 */

import {
  METRIC_META,
  type Device,
  type DeviceStatus,
  type MetricType,
  type Zone,
  type ZoneKind,
} from "@fass/contracts";

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ago = (ms: number): string => new Date(NOW - ms).toISOString();

/* ------------------------------------------------------------------ */
/* Zones                                                               */
/* ------------------------------------------------------------------ */

export const ZONES: readonly Zone[] = [
  {
    id: "3f1c8f2e-0001-4a2b-9c3d-000000000000",
    name: "Class 6-A",
    kind: "classroom",
    building: "Main block",
    floor: 1,
    capacity: 36,
  },
  {
    id: "3f1c8f2e-0002-4a2b-9c3d-000000000000",
    name: "Class 7-B",
    kind: "classroom",
    building: "Main block",
    floor: 1,
    capacity: 36,
  },
  {
    id: "3f1c8f2e-0003-4a2b-9c3d-000000000000",
    name: "Class 8-A",
    kind: "classroom",
    building: "Main block",
    floor: 2,
    capacity: 34,
  },
  {
    id: "3f1c8f2e-0004-4a2b-9c3d-000000000000",
    name: "Class 9-A",
    kind: "classroom",
    building: "Main block",
    floor: 2,
    capacity: 38,
  },
  {
    id: "3f1c8f2e-0005-4a2b-9c3d-000000000000",
    name: "Class 10-B",
    kind: "classroom",
    building: "Main block",
    floor: 2,
    capacity: 40,
  },
  {
    id: "3f1c8f2e-0006-4a2b-9c3d-000000000000",
    name: "Library",
    kind: "library",
    building: "Main block",
    floor: 1,
    capacity: 48,
  },
  {
    id: "3f1c8f2e-0007-4a2b-9c3d-000000000000",
    name: "Physics laboratory",
    kind: "laboratory",
    building: "Science block",
    floor: 1,
    capacity: 30,
  },
  {
    id: "3f1c8f2e-0008-4a2b-9c3d-000000000000",
    name: "Corridor — first floor",
    kind: "corridor",
    building: "Main block",
    floor: 1,
    capacity: 80,
  },
  {
    id: "3f1c8f2e-0009-4a2b-9c3d-000000000000",
    name: "Assembly hall",
    kind: "assembly-hall",
    building: "Main block",
    floor: 0,
    capacity: 400,
  },
  {
    id: "3f1c8f2e-000a-4a2b-9c3d-000000000000",
    name: "Staff office",
    kind: "office",
    building: "Main block",
    floor: 1,
    capacity: 20,
  },
  {
    id: "3f1c8f2e-000b-4a2b-9c3d-000000000000",
    name: "Courtyard",
    kind: "outdoor",
    building: "Main block",
    floor: null,
    capacity: 150,
  },
  {
    id: "3f1c8f2e-000c-4a2b-9c3d-000000000000",
    name: "Playground",
    kind: "grounds",
    building: "Grounds",
    floor: null,
    capacity: 300,
  },
];

export const COURTYARD_ZONE_ID = "3f1c8f2e-000b-4a2b-9c3d-000000000000";

export function findZoneById(zoneId: string): Zone | null {
  return ZONES.find((z) => z.id === zoneId) ?? null;
}

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

/** Fictional sensor models per metric (no real vendor hardware). */
const DEVICE_MODELS: Record<MetricType, string> = {
  temp_c: "FASS-Sense T1",
  humidity_pct: "FASS-Sense H1",
  co2_ppm: "FASS-Sense C1",
  pm25_ugm3: "FASS-Sense P2",
  pm10_ugm3: "FASS-Sense P2",
  noise_db: "FASS-Sense N1",
  light_lux: "FASS-Sense L1",
};

interface DeviceSeed {
  ref: string;
  zoneId: string;
  metric: MetricType;
  status: DeviceStatus;
  batteryPercent: number;
  installedAt: string;
  calibratedAt: string;
}

const deviceId = (n: number): string =>
  `7d2e9f41-${String(n).padStart(4, "0")}-4a2b-9c3d-${String(n).padStart(12, "0")}`;

function buildDevices(seeds: readonly DeviceSeed[]): Device[] {
  return seeds.map((s) => {
    const zone = findZoneById(s.zoneId);
    const zoneName = zone?.name ?? "Unknown zone";
    const shortLabel = METRIC_META[s.metric].shortLabel;
    const model = zone?.kind === "outdoor" ? "FASS-Sense OS1" : DEVICE_MODELS[s.metric];
    const lastSeenAt =
      s.status === "offline"
        ? ago(3 * HOUR + 12 * MIN)
        : s.status === "maintenance"
          ? ago(27 * HOUR)
          : ago(2 * MIN + (s.ref.charCodeAt(s.ref.length - 1) % 7) * MIN);
    return {
      id: deviceId(Number(s.ref.slice(3))),
      ref: s.ref,
      name: `${zoneName} — ${shortLabel}`,
      zoneId: s.zoneId,
      metric: s.metric,
      model,
      status: s.status,
      batteryPercent: s.batteryPercent,
      installedAt: s.installedAt,
      lastSeenAt,
      calibratedAt: s.calibratedAt,
    };
  });
}

const SEEDS: readonly DeviceSeed[] = [
  // Classrooms — temp + CO₂ everywhere, PM2.5 on Class 8-A
  { ref: "SE-1001", zoneId: "3f1c8f2e-0001-4a2b-9c3d-000000000000", metric: "temp_c", status: "online", batteryPercent: 88, installedAt: "2025-06-12T05:00:00.000Z", calibratedAt: "2026-01-05T04:30:00.000Z" },
  { ref: "SE-1002", zoneId: "3f1c8f2e-0001-4a2b-9c3d-000000000000", metric: "co2_ppm", status: "online", batteryPercent: 64, installedAt: "2025-06-12T05:30:00.000Z", calibratedAt: "2026-01-05T05:00:00.000Z" },
  { ref: "SE-1003", zoneId: "3f1c8f2e-0002-4a2b-9c3d-000000000000", metric: "temp_c", status: "online", batteryPercent: 91, installedAt: "2025-07-02T04:45:00.000Z", calibratedAt: "2026-01-06T04:15:00.000Z" },
  { ref: "SE-1004", zoneId: "3f1c8f2e-0002-4a2b-9c3d-000000000000", metric: "co2_ppm", status: "offline", batteryPercent: 34, installedAt: "2025-07-02T05:15:00.000Z", calibratedAt: "2026-01-06T04:45:00.000Z" },
  { ref: "SE-1005", zoneId: "3f1c8f2e-0003-4a2b-9c3d-000000000000", metric: "temp_c", status: "online", batteryPercent: 76, installedAt: "2025-07-18T04:30:00.000Z", calibratedAt: "2026-01-07T05:00:00.000Z" },
  { ref: "SE-1006", zoneId: "3f1c8f2e-0003-4a2b-9c3d-000000000000", metric: "co2_ppm", status: "online", batteryPercent: 58, installedAt: "2025-07-18T05:00:00.000Z", calibratedAt: "2026-01-07T05:30:00.000Z" },
  { ref: "SE-1007", zoneId: "3f1c8f2e-0003-4a2b-9c3d-000000000000", metric: "pm25_ugm3", status: "online", batteryPercent: 82, installedAt: "2025-08-05T04:45:00.000Z", calibratedAt: "2026-01-08T04:30:00.000Z" },
  { ref: "SE-1008", zoneId: "3f1c8f2e-0004-4a2b-9c3d-000000000000", metric: "temp_c", status: "online", batteryPercent: 70, installedAt: "2025-08-21T05:00:00.000Z", calibratedAt: "2026-01-08T05:00:00.000Z" },
  { ref: "SE-1009", zoneId: "3f1c8f2e-0004-4a2b-9c3d-000000000000", metric: "co2_ppm", status: "online", batteryPercent: 55, installedAt: "2025-08-21T05:30:00.000Z", calibratedAt: "2026-01-09T04:45:00.000Z" },
  { ref: "SE-1010", zoneId: "3f1c8f2e-0005-4a2b-9c3d-000000000000", metric: "temp_c", status: "online", batteryPercent: 93, installedAt: "2025-09-04T04:30:00.000Z", calibratedAt: "2026-01-09T05:15:00.000Z" },
  { ref: "SE-1011", zoneId: "3f1c8f2e-0005-4a2b-9c3d-000000000000", metric: "co2_ppm", status: "online", batteryPercent: 61, installedAt: "2025-09-04T05:00:00.000Z", calibratedAt: "2026-01-10T04:30:00.000Z" },
  // Library — temp, humidity, CO₂, light
  { ref: "SE-1012", zoneId: "3f1c8f2e-0006-4a2b-9c3d-000000000000", metric: "temp_c", status: "online", batteryPercent: 84, installedAt: "2025-04-15T04:45:00.000Z", calibratedAt: "2025-12-18T05:00:00.000Z" },
  { ref: "SE-1013", zoneId: "3f1c8f2e-0006-4a2b-9c3d-000000000000", metric: "humidity_pct", status: "online", batteryPercent: 47, installedAt: "2025-04-15T05:15:00.000Z", calibratedAt: "2025-12-18T05:30:00.000Z" },
  { ref: "SE-1014", zoneId: "3f1c8f2e-0006-4a2b-9c3d-000000000000", metric: "co2_ppm", status: "online", batteryPercent: 52, installedAt: "2025-04-16T04:30:00.000Z", calibratedAt: "2025-12-19T04:45:00.000Z" },
  { ref: "SE-1015", zoneId: "3f1c8f2e-0006-4a2b-9c3d-000000000000", metric: "light_lux", status: "online", batteryPercent: 66, installedAt: "2025-04-16T05:00:00.000Z", calibratedAt: "2025-12-19T05:15:00.000Z" },
  // Physics laboratory — temp, CO₂, noise
  { ref: "SE-1016", zoneId: "3f1c8f2e-0007-4a2b-9c3d-000000000000", metric: "temp_c", status: "online", batteryPercent: 79, installedAt: "2025-05-09T04:45:00.000Z", calibratedAt: "2025-12-22T04:30:00.000Z" },
  { ref: "SE-1017", zoneId: "3f1c8f2e-0007-4a2b-9c3d-000000000000", metric: "co2_ppm", status: "online", batteryPercent: 57, installedAt: "2025-05-09T05:15:00.000Z", calibratedAt: "2025-12-22T05:00:00.000Z" },
  { ref: "SE-1018", zoneId: "3f1c8f2e-0007-4a2b-9c3d-000000000000", metric: "noise_db", status: "online", batteryPercent: 73, installedAt: "2025-05-10T04:30:00.000Z", calibratedAt: "2025-12-23T04:45:00.000Z" },
  // Corridor — PM2.5
  { ref: "SE-1019", zoneId: "3f1c8f2e-0008-4a2b-9c3d-000000000000", metric: "pm25_ugm3", status: "online", batteryPercent: 68, installedAt: "2025-09-20T05:00:00.000Z", calibratedAt: "2026-01-12T04:30:00.000Z" },
  // Assembly hall — CO₂
  { ref: "SE-1020", zoneId: "3f1c8f2e-0009-4a2b-9c3d-000000000000", metric: "co2_ppm", status: "online", batteryPercent: 42, installedAt: "2025-10-02T04:45:00.000Z", calibratedAt: "2026-01-13T05:00:00.000Z" },
  // Staff office — temp (online) + CO₂ (maintenance)
  { ref: "SE-1021", zoneId: "3f1c8f2e-000a-4a2b-9c3d-000000000000", metric: "temp_c", status: "online", batteryPercent: 86, installedAt: "2025-10-15T05:00:00.000Z", calibratedAt: "2026-01-14T04:45:00.000Z" },
  { ref: "SE-1022", zoneId: "3f1c8f2e-000a-4a2b-9c3d-000000000000", metric: "co2_ppm", status: "maintenance", batteryPercent: 71, installedAt: "2025-10-15T05:30:00.000Z", calibratedAt: "2026-01-14T05:15:00.000Z" },
  // Courtyard — outdoor station (temp; supplies outdoor conditions), low battery
  { ref: "SE-1023", zoneId: "3f1c8f2e-000b-4a2b-9c3d-000000000000", metric: "temp_c", status: "low-battery", batteryPercent: 20, installedAt: "2025-11-06T04:30:00.000Z", calibratedAt: "2026-01-15T05:00:00.000Z" },
  // Playground — PM2.5
  { ref: "SE-1024", zoneId: "3f1c8f2e-000c-4a2b-9c3d-000000000000", metric: "pm25_ugm3", status: "online", batteryPercent: 49, installedAt: "2025-09-25T04:45:00.000Z", calibratedAt: "2026-01-16T04:30:00.000Z" },
];

export const DEVICES: readonly Device[] = buildDevices(SEEDS);

/* ------------------------------------------------------------------ */
/* Zone-kind metadata used by the generator                            */
/* ------------------------------------------------------------------ */

export const INDOOR_TEMP_BASE: Record<ZoneKind, number> = {
  classroom: 21,
  library: 20.5,
  laboratory: 21,
  corridor: 18.5,
  "assembly-hall": 19.5,
  office: 21.5,
  outdoor: 9.5,
  grounds: 9.5,
};

export function isOutdoorKind(kind: ZoneKind): boolean {
  return kind === "outdoor" || kind === "grounds";
}
