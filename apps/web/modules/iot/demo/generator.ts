/**
 * Deterministic time-series generator for the campus-environment demo.
 *
 * Values are pure functions of (metric, zone, time): diurnal and seasonal
 * shape curves composed with seeded smooth "wander" noise and occasional
 * episodes (PM spikes, noise bursts). There is no module state, so the server
 * and the client always agree on the same instant's value, and every range
 * (6h/24h/7d/30d) is consistent at overlapping timestamps.
 *
 * The scenario is a fictional winter session in Kashmir (cold outdoor air,
 * heated classrooms, elevated winter PM). All data is fictional.
 */

import {
  METRIC_META,
  type HistorySeries,
  type MetricType,
  type OutdoorConditions,
  type SeriesSample,
  type Zone,
} from "@fass/contracts";
import { RANGE_HOURS, aqiFromPm25, type RangeKey } from "../domain";
import { INDOOR_TEMP_BASE, COURTYARD_ZONE_ID, findZoneById, isOutdoorKind } from "./campus";
import { hashStr, mulberry32 } from "./prng";

/* ------------------------------------------------------------------ */
/* Range configuration                                                 */
/* ------------------------------------------------------------------ */

/** Default sampling step per history range. */
export const RANGE_STEP_MINUTES: Record<RangeKey, number> = {
  "6h": 15,
  "24h": 15,
  "7d": 60,
  "30d": 180,
};

export function defaultStepMinutes(hours: number): number {
  if (hours <= 24) return 15;
  if (hours <= 24 * 7) return 60;
  return 180;
}

/* ------------------------------------------------------------------ */
/* Time helpers (all in UTC; IST = UTC + 5:30, no DST in India)        */
/* ------------------------------------------------------------------ */

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
const QUARTER_HOUR_MS = 900_000;

const floorToQuarterHour = (tMs: number): number => Math.floor(tMs / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;

const istDayIndex = (tMs: number): number => Math.floor((tMs + IST_OFFSET_MS) / DAY_MS);
const istMinutesOfDay = (tMs: number): number => ((tMs + IST_OFFSET_MS) % DAY_MS) / 60_000;
const istHour = (tMs: number): number => istMinutesOfDay(tMs) / 60;

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
const istWeekday = (tMs: number): number => (istDayIndex(tMs) + 4) % 7;

const isSchoolDay = (tMs: number): boolean => {
  const wd = istWeekday(tMs);
  return wd >= 1 && wd <= 5;
};

/** Occupancy-style factor 0..1 across a school day (Mon–Fri). */
function schoolActivity(tMs: number): number {
  if (!isSchoolDay(tMs)) return 0;
  const h = istHour(tMs);
  if (h >= 8.5 && h < 13) return 1; // first half: classes
  if (h >= 13 && h < 14) return 0.15; // lunch
  if (h >= 14 && h < 15.5) return 0.8; // second half
  if (h >= 7.5 && h < 8.5) return 0.4; // morning assembly
  if (h >= 15.5 && h < 17) return 0.2; // extracurricular
  return 0;
}

/* ------------------------------------------------------------------ */
/* Seeded smooth noise                                                 */
/* ------------------------------------------------------------------ */

/**
 * Smooth deterministic wander: control values are drawn per absolute 6-hour
 * block and interpolated with smoothstep, so the value at any instant is a
 * pure function of time (order- and range-independent).
 */
function wander(parts: readonly string[], tMs: number, amplitude: number, periodHours = 6): number {
  const blockMs = periodHours * 3_600_000;
  const block = Math.floor(tMs / blockMs);
  const frac = (tMs - block * blockMs) / blockMs;
  const v0 = controlValue(parts, block);
  const v1 = controlValue(parts, block + 1);
  const s = frac * frac * (3 - 2 * frac);
  return (v0 + (v1 - v0) * s) * amplitude;
}

function controlValue(parts: readonly string[], block: number): number {
  const rng = mulberry32(hashStr([...parts, "b", String(block)].join("|")));
  return rng() * 2 - 1;
}

/** Per-sample sensor jitter, seeded by the 15-minute grid so any step size agrees at the same instant. */
function jitter(parts: readonly string[], tMs: number, amplitude: number): number {
  const grid = Math.round(tMs / QUARTER_HOUR_MS);
  const rng = mulberry32(hashStr([...parts, "j", String(grid)].join("|")));
  return (rng() * 2 - 1) * amplitude;
}

/** Smooth sin-bump for episodes (PM spikes, noise bursts). */
function bump(tMs: number, dayStartLocal: number, durationMs: number, strength: number): number {
  if (tMs < dayStartLocal || tMs > dayStartLocal + durationMs) return 0;
  const f = Math.sin((Math.PI * (tMs - dayStartLocal)) / durationMs);
  return strength * f;
}

function pmEpisode(tMs: number, parts: readonly string[]): number {
  const day = istDayIndex(tMs);
  const rng = mulberry32(hashStr([...parts, "ep", String(day)].join("|")));
  if (rng() > 0.35) return 0;
  const startLocal = istDayIndex(tMs) * DAY_MS - IST_OFFSET_MS + (6 + rng() * 10) * 3_600_000;
  const duration = (2 + rng() * 2) * 3_600_000;
  const strength = 30 + rng() * 30;
  return bump(tMs, startLocal, duration, strength);
}

function noiseBurst(tMs: number, parts: readonly string[]): number {
  const day = istDayIndex(tMs);
  const rng = mulberry32(hashStr([...parts, "nb", String(day)].join("|")));
  if (rng() > 0.35) return 0;
  const startLocal = istDayIndex(tMs) * DAY_MS - IST_OFFSET_MS + (9 + rng() * 6.5) * 3_600_000;
  const duration = (0.5 + rng()) * 3_600_000;
  const strength = 7 + rng() * 7;
  return bump(tMs, startLocal, duration, strength);
}

function rainForDay(tMs: number): number {
  const day = istDayIndex(tMs);
  const rng = mulberry32(hashStr("rain|" + String(day)));
  if (rng() > 0.25) return 0;
  return round(0.5 + rng() * 1.5, 1);
}

/* ------------------------------------------------------------------ */
/* Per-metric shape functions                                          */
/* ------------------------------------------------------------------ */

const round = (v: number, d: number): number => Number(v.toFixed(d));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const partsFor = (metric: MetricType, zoneId: string, deviceId?: string): string[] => [metric, zoneId, deviceId ?? "-"];

function tempAt(zone: Zone, tMs: number, deviceId?: string): number {
  const parts = partsFor("temp_c", zone.id, deviceId);
  const diurnal = Math.cos((2 * Math.PI * (istHour(tMs) - 15.5)) / 24); // peak ~15:30 IST, trough ~03:30
  if (isOutdoorKind(zone.kind)) {
    const v = 9.5 + diurnal * 4.2 + wander(parts, tMs, 0.9);
    return clamp(v + jitter(parts, tMs, 0.15), 0, 18);
  }
  const base = INDOOR_TEMP_BASE[zone.kind];
  const heating = 1.6 * schoolActivity(tMs);
  const v = base + diurnal * 1.5 + heating + wander(parts, tMs, 0.35);
  return clamp(v + jitter(parts, tMs, 0.15), 14, 30);
}

function humidityAt(zone: Zone, tMs: number, deviceId?: string): number {
  const parts = partsFor("humidity_pct", zone.id, deviceId);
  const outdoor = isOutdoorKind(zone.kind);
  const base = outdoor ? 41 : 47;
  const tempBase = outdoor ? 9.5 : INDOOR_TEMP_BASE[zone.kind];
  const v = base - (tempAt(zone, tMs, deviceId) - tempBase) * 2.2 + wander(parts, tMs, 2.0);
  return clamp(v + jitter(parts, tMs, 0.8), 25, 75);
}

function co2At(zone: Zone, tMs: number, deviceId?: string): number {
  const parts = partsFor("co2_ppm", zone.id, deviceId);
  if (isOutdoorKind(zone.kind)) {
    return clamp(420 + wander(parts, tMs, 25), 410, 500);
  }
  const h = istHour(tMs);
  const act = schoolActivity(tMs);
  let occ = 0;
  if (act > 0) {
    if (h < 8.5) occ = 0;
    else if (h < 11.5) occ = (h - 8.5) / 3; // ramps up through the morning
    else if (h < 13) occ = 1; // peak hold
    else if (h < 14) occ = Math.max(0, 0.15 - (h - 13) * 0.15); // lunch decay
    else if (h < 15.5) occ = Math.min(0.8, ((h - 14) / 1.5) * 0.8); // afternoon rise
    else occ = Math.max(0, 0.8 * (1 - (h - 15.5) / 1.5)); // after-school decay
  }
  const peak = Math.min(1600, 950 + zone.capacity * 15); // scales with class size
  const v = 420 + occ * (peak - 420) + wander(parts, tMs, 35) * occ;
  return Math.round(clamp(v + jitter(parts, tMs, 8), 410, 1700));
}

/** Shared outdoor PM2.5 stream (ambient winter air), so indoor = 0.7 × outdoor. */
function pm25OutdoorBase(tMs: number): number {
  return 78 + wander(["pm25o", "ambient"], tMs, 25) + pmEpisode(tMs, ["pm25o", "ambient"]);
}

function pm25At(zone: Zone, tMs: number, deviceId?: string): number {
  const parts = partsFor("pm25_ugm3", zone.id, deviceId);
  const base = pm25OutdoorBase(tMs);
  if (isOutdoorKind(zone.kind)) {
    return clamp(base + jitter(parts, tMs, 1.5), 40, 190);
  }
  const v = base * 0.7 + wander(parts, tMs, 5);
  return clamp(v + jitter(parts, tMs, 1), 25, 140);
}

function pm10At(zone: Zone, tMs: number, deviceId?: string): number {
  const parts = partsFor("pm10_ugm3", zone.id, deviceId);
  const base = pm25OutdoorBase(tMs);
  const mult = clamp(1.85 + wander(parts, tMs, 0.3), 1.5, 2.2); // 1.5–2.2 × PM2.5
  return clamp(base * mult + jitter(parts, tMs, 2), 60, 420);
}

function noiseAt(zone: Zone, tMs: number, deviceId?: string): number {
  const parts = partsFor("noise_db", zone.id, deviceId);
  const h = istHour(tMs);
  const act = schoolActivity(tMs);
  const lunch = isSchoolDay(tMs) && h >= 13 && h < 14;
  const boost = zone.kind === "laboratory" ? 8 : zone.kind === "corridor" ? 3 : 0;
  let v: number;
  if (zone.kind === "grounds" && act >= 0.05) {
    v = 60 + 10 * act + wander(parts, tMs, 4); // PE on the playground
  } else if (isOutdoorKind(zone.kind) || act < 0.05) {
    v = 41 + wander(parts, tMs, 4); // quiet hours
  } else if (lunch) {
    v = 72 + wander(parts, tMs, 5); // lunch crowd
  } else {
    v = 57 + 11 * act + boost + wander(parts, tMs, 4); // classes
  }
  v += noiseBurst(tMs, parts);
  return clamp(v + jitter(parts, tMs, 1), 35, 90);
}

/** Daylight curve: 0 at 07:00/18:00 IST, peak 1 at 12:30. */
const dayFactor = (h: number): number => clamp(Math.sin((Math.PI * (h - 7)) / 11), 0, 1);

function lightAt(zone: Zone, tMs: number, deviceId?: string): number {
  const parts = partsFor("light_lux", zone.id, deviceId);
  const h = istHour(tMs);
  if (isOutdoorKind(zone.kind)) {
    const v = dayFactor(h) * (1000 + wander(parts, tMs, 120));
    return clamp(v + jitter(parts, tMs, 20), 0, 1400);
  }
  if (h >= 7.5 && h < 17) {
    const v = 180 + 220 * dayFactor(h) + wander(parts, tMs, 45); // daylight 180–420 lux
    return clamp(v + jitter(parts, tMs, 10), 0, 480);
  }
  if (h >= 17 && h < 19) {
    return clamp(55 + wander(parts, tMs, 25) + jitter(parts, tMs, 6), 0, 120); // dim evening
  }
  return clamp(5 + wander(parts, tMs, 4) + jitter(parts, tMs, 2), 0, 20); // night
}

function sampleAt(metric: MetricType, zone: Zone, tMs: number, deviceId?: string): number {
  switch (metric) {
    case "temp_c":
      return tempAt(zone, tMs, deviceId);
    case "humidity_pct":
      return humidityAt(zone, tMs, deviceId);
    case "co2_ppm":
      return co2At(zone, tMs, deviceId);
    case "pm25_ugm3":
      return pm25At(zone, tMs, deviceId);
    case "pm10_ugm3":
      return pm10At(zone, tMs, deviceId);
    case "noise_db":
      return noiseAt(zone, tMs, deviceId);
    case "light_lux":
      return lightAt(zone, tMs, deviceId);
  }
}

/* ------------------------------------------------------------------ */
/* Public generator API                                                */
/* ------------------------------------------------------------------ */

export interface GenerateSeriesOptions {
  hours: number;
  stepMinutes?: number;
  deviceId?: string;
}

/**
 * Generate a deterministic series for one metric in one zone, ending at the
 * current time (floored to the 15-minute grid). Unknown zones yield an empty
 * array. Values are rounded to the metric's canonical decimals.
 */
export function generateSeries(metric: MetricType, zoneId: string, opts: GenerateSeriesOptions): SeriesSample[] {
  const zone = findZoneById(zoneId);
  if (!zone) return [];
  const stepMinutes = opts.stepMinutes ?? defaultStepMinutes(opts.hours);
  const end = floorToQuarterHour(Date.now());
  const count = Math.max(1, Math.floor((opts.hours * 60) / stepMinutes));
  const decimals = METRIC_META[metric].decimals;
  const samples: SeriesSample[] = [];
  for (let k = count - 1; k >= 0; k--) {
    const tMs = end - k * stepMinutes * 60_000;
    samples.push({
      takenAt: new Date(tMs).toISOString(),
      value: round(sampleAt(metric, zone, tMs, opts.deviceId), decimals),
    });
  }
  return samples;
}

/** History series for a zone + metric over a named range (chronological). */
export function readingsFor(zoneId: string, metric: MetricType, range: RangeKey): HistorySeries {
  const hours = RANGE_HOURS[range];
  return {
    metric,
    zoneId,
    samples: generateSeries(metric, zoneId, { hours, stepMinutes: RANGE_STEP_MINUTES[range] }),
  };
}

/**
 * Latest value for a zone + metric (the last sample of any range, so charts
 * and "live" cards always agree). Returns NaN for unknown zones — callers
 * should resolve the zone first.
 */
export function currentValue(zoneId: string, metric: MetricType): number {
  const zone = findZoneById(zoneId);
  if (!zone) return Number.NaN;
  const tMs = floorToQuarterHour(Date.now());
  return round(sampleAt(metric, zone, tMs), METRIC_META[metric].decimals);
}

/**
 * Current outdoor conditions from the courtyard station: temperature,
 * humidity, PM2.5/PM10 with the CPCB AQI computed from PM2.5, plus wind and
 * 24-hour rain. The optional range argument is accepted for signature
 * symmetry with the history API and does not affect the values.
 */
export function generateOutdoor(_range?: RangeKey): OutdoorConditions {
  const zone = findZoneById(COURTYARD_ZONE_ID);
  if (!zone) throw new Error("Courtyard zone missing from campus fixture");
  const tMs = floorToQuarterHour(Date.now());
  const tempC = round(tempAt(zone, tMs), 1);
  const humidityPct = round(humidityAt(zone, tMs), 0);
  const pm25Ugm3 = round(pm25At(zone, tMs), 1);
  const pm10Ugm3 = round(pm10At(zone, tMs), 1);
  const aqi = aqiFromPm25(pm25Ugm3);
  const windKmh = round(clamp(10 + wander(["wind", "ambient"], tMs, 6), 4, 16), 0);
  const rainMmLast24h = rainForDay(tMs);
  return {
    tempC,
    humidityPct,
    pm25Ugm3,
    pm10Ugm3,
    aqiIndex: aqi.index,
    aqiBand: aqi.band,
    windKmh,
    rainMmLast24h,
    takenAt: new Date(tMs).toISOString(),
  };
}
