import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

export const METRIC_TYPES = [
  "temp_c",
  "humidity_pct",
  "co2_ppm",
  "pm25_ugm3",
  "pm10_ugm3",
  "noise_db",
  "light_lux",
] as const;

export type MetricType = (typeof METRIC_TYPES)[number];

/** Canonical display metadata for each metric. Units follow ISO 80000 where applicable. */
export const METRIC_META: Record<MetricType, { label: string; shortLabel: string; unit: string; decimals: number }> = {
  temp_c: { label: "Temperature", shortLabel: "Temp", unit: "°C", decimals: 1 },
  humidity_pct: { label: "Relative humidity", shortLabel: "Humidity", unit: "%", decimals: 0 },
  co2_ppm: { label: "Carbon dioxide", shortLabel: "CO₂", unit: "ppm", decimals: 0 },
  pm25_ugm3: { label: "Fine particulate matter", shortLabel: "PM2.5", unit: "µg/m³", decimals: 1 },
  pm10_ugm3: { label: "Coarse particulate matter", shortLabel: "PM10", unit: "µg/m³", decimals: 1 },
  noise_db: { label: "Noise level", shortLabel: "Noise", unit: "dB(A)", decimals: 1 },
  light_lux: { label: "Illuminance", shortLabel: "Light", unit: "lux", decimals: 0 },
};

export const metricSchema = z.enum(METRIC_TYPES);
export type Metric = z.infer<typeof metricSchema>;

/* ------------------------------------------------------------------ */
/* Zones                                                               */
/* ------------------------------------------------------------------ */

export const ZONE_KINDS = [
  "classroom",
  "library",
  "laboratory",
  "corridor",
  "assembly-hall",
  "office",
  "outdoor",
  "grounds",
] as const;

export type ZoneKind = (typeof ZONE_KINDS)[number];

export const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  classroom: "Classroom",
  library: "Library",
  laboratory: "Laboratory",
  corridor: "Corridor",
  "assembly-hall": "Assembly hall",
  office: "Office",
  outdoor: "Outdoor",
  grounds: "Grounds",
};

export const zoneSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(ZONE_KINDS),
  building: z.string(),
  floor: z.number().int().nullable(),
  /** Nominal occupancy used for ventilation context, not identity tracking. */
  capacity: z.number().int().positive(),
});

export type Zone = z.infer<typeof zoneSchema>;

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

export const DEVICE_STATUSES = ["online", "offline", "low-battery", "maintenance"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const deviceSchema = z.object({
  id: z.string().uuid(),
  /** Non-sequential public reference, e.g. "SE-2037". */
  ref: z.string(),
  name: z.string(),
  zoneId: z.string().uuid(),
  metric: metricSchema,
  model: z.string(),
  status: z.enum(DEVICE_STATUSES),
  batteryPercent: z.number().int().min(0).max(100),
  installedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  calibratedAt: z.string().datetime(),
});

export type Device = z.infer<typeof deviceSchema>;

/* ------------------------------------------------------------------ */
/* Readings                                                            */
/* ------------------------------------------------------------------ */

export const readingSchema = z.object({
  deviceId: z.string().uuid(),
  zoneId: z.string().uuid(),
  metric: metricSchema,
  value: z.number(),
  unit: z.string(),
  takenAt: z.string().datetime(),
});

export type Reading = z.infer<typeof readingSchema>;

/** One point of an aggregated history series. */
export const seriesSampleSchema = z.object({
  takenAt: z.string().datetime(),
  value: z.number(),
});

export type SeriesSample = z.infer<typeof seriesSampleSchema>;

export const historySeriesSchema = z.object({
  metric: metricSchema,
  zoneId: z.string().uuid(),
  samples: z.array(seriesSampleSchema),
});

export type HistorySeries = z.infer<typeof historySeriesSchema>;

/** Latest snapshot for a zone: one value per metric present in that zone. */
export const zoneCurrentSchema = z.object({
  zoneId: z.string().uuid(),
  readings: z.record(metricSchema, z.number()),
  takenAt: z.string().datetime(),
});

export type ZoneCurrent = z.infer<typeof zoneCurrentSchema>;

/* ------------------------------------------------------------------ */
/* Air quality                                                         */
/* ------------------------------------------------------------------ */

/** CPCB AQI bands (India). Computed from PM2.5/PM10 via domain logic, not stored. */
export const AQI_BANDS = ["good", "satisfactory", "moderate", "poor", "very-poor", "severe"] as const;
export type AqiBand = (typeof AQI_BANDS)[number];

export const AQI_BAND_LABELS: Record<AqiBand, string> = {
  good: "Good",
  satisfactory: "Satisfactory",
  moderate: "Moderate",
  poor: "Poor",
  "very-poor": "Very poor",
  severe: "Severe",
};

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const alertSchema = z.object({
  id: z.string().uuid(),
  /** Non-sequential public reference, e.g. "AL-1042". */
  ref: z.string(),
  severity: z.enum(ALERT_SEVERITIES),
  metric: metricSchema,
  zoneId: z.string().uuid(),
  deviceId: z.string().uuid(),
  title: z.string(),
  detail: z.string(),
  raisedAt: z.string().datetime(),
  status: z.enum(ALERT_STATUSES),
  acknowledgedAt: z.string().datetime().nullable(),
  acknowledgedBy: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: z.string().nullable(),
  resolutionNote: z.string().nullable(),
});

export type Alert = z.infer<typeof alertSchema>;

/* ------------------------------------------------------------------ */
/* Overview / reports                                                  */
/* ------------------------------------------------------------------ */

export const outdoorConditionsSchema = z.object({
  tempC: z.number(),
  humidityPct: z.number(),
  pm25Ugm3: z.number(),
  pm10Ugm3: z.number(),
  aqiIndex: z.number().int(),
  aqiBand: z.enum(AQI_BANDS),
  windKmh: z.number(),
  rainMmLast24h: z.number(),
  takenAt: z.string().datetime(),
});

export type OutdoorConditions = z.infer<typeof outdoorConditionsSchema>;

export const overviewSummarySchema = z.object({
  outdoor: outdoorConditionsSchema,
  indoorComfort: z.object({
    totalZones: z.number().int(),
    comfortableZones: z.number().int(),
    warnedZones: z.number().int(),
  }),
  alerts: z.object({
    openCritical: z.number().int(),
    openWarning: z.number().int(),
    openInfo: z.number().int(),
  }),
  fleet: z.object({
    totalDevices: z.number().int(),
    online: z.number().int(),
    offline: z.number().int(),
    lowBattery: z.number().int(),
    maintenance: z.number().int(),
  }),
  takenAt: z.string().datetime(),
});

export type OverviewSummary = z.infer<typeof overviewSummarySchema>;

export const zoneReportStatsSchema = z.object({
  zoneId: z.string().uuid(),
  zoneName: z.string(),
  metric: metricSchema,
  avg: z.number(),
  min: z.number(),
  max: z.number(),
  p95: z.number(),
  hoursOutOfRange: z.number(),
});

export type ZoneReportStats = z.infer<typeof zoneReportStatsSchema>;

export const environmentReportSchema = z.object({
  id: z.string().uuid(),
  ref: z.string(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  generatedAt: z.string().datetime(),
  generatedBy: z.string(),
  summary: z.string(),
  zoneStats: z.array(zoneReportStatsSchema),
});

export type EnvironmentReport = z.infer<typeof environmentReportSchema>;

/* ------------------------------------------------------------------ */
/* Wallboard                                                           */
/* ------------------------------------------------------------------ */

export const wallboardSnapshotSchema = z.object({
  takenAt: z.string().datetime(),
  outdoor: outdoorConditionsSchema,
  zones: z.array(
    z.object({
      zoneId: z.string().uuid(),
      zoneName: z.string(),
      kind: z.enum(ZONE_KINDS),
      readings: z.record(metricSchema, z.number()),
      status: z.enum(["comfortable", "watch", "action"]),
    }),
  ),
  latestAlert: alertSchema.nullable(),
});

export type WallboardSnapshot = z.infer<typeof wallboardSnapshotSchema>;
