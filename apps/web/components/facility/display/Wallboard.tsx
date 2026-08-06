"use client";

import { useEffect, useRef, useState } from "react";
import { AQI_BAND_LABELS, METRIC_META } from "@fass/contracts";
import type { AlertSeverity, WallboardSnapshot } from "@fass/contracts";
import Button from "@/components/ui/Button";
import { ChinarMark } from "@/components/ui/ChinarMark";
import { Crest } from "@/components/ui/Crest";
import { getWallboard } from "@/lib/iot/api";
import {
  ALERT_SEVERITY_LABELS,
  ZONE_STATUS_LABELS,
  formatKolkata,
  formatMetricValue,
  type ZoneStatus,
} from "@/modules/iot/domain";
import styles from "./Wallboard.module.css";

const ZONE_STATUS_TONE: Record<ZoneStatus, "good" | "watch" | "alert"> = {
  comfortable: "good",
  watch: "watch",
  action: "alert",
};

const SEVERITY_TONE: Record<AlertSeverity, "neutral" | "watch" | "alert"> = {
  info: "neutral",
  warning: "watch",
  critical: "alert",
};

export function Wallboard() {
  const [snapshot, setSnapshot] = useState<WallboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [reloadKey, setReloadKey] = useState(0);

  const formattersRef = useRef<{ time: Intl.DateTimeFormat; date: Intl.DateTimeFormat } | null>(null);
  if (!formattersRef.current) {
    formattersRef.current = {
      time: new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
      date: new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    };
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await getWallboard();
        if (!cancelled) {
          setSnapshot(next);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Could not reach the sensor service.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const refreshId = window.setInterval(() => void load(), 60_000);
    const clockId = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
      window.clearInterval(clockId);
    };
  }, [reloadKey]);

  const clockTime = formattersRef.current.time.format(now);
  const clockDate = formattersRef.current.date.format(now);

  const zoneNames = useRef(new Map<string, string>());
  if (snapshot) {
    zoneNames.current = new Map(snapshot.zones.map((z) => [z.zoneId, z.zoneName]));
  }

  return (
    <section className={styles.wallboard} aria-busy={loading}>
      <div className={styles.watermark} aria-hidden="true">
        <ChinarMark size={260} tone="chalk" />
      </div>
      {loading && !snapshot ? (
        <div className={styles.loading} role="status">
          <p className={styles.loadingNote}>Reading sensors…</p>
        </div>
      ) : error && !snapshot ? (
        <div className={styles.loading} role="alert">
          <p className={styles.stateTitle}>Sensors unreachable</p>
          <p className={styles.stateNote}>{error}</p>
          <Button variant="quiet" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </Button>
        </div>
      ) : snapshot ? (
        <>
          <header className={styles.head}>
            <div className={styles.brand}>
              <Crest size="lg" tone="chalk" />
              <div className={styles.brandCopy}>
                <span className={styles.brandName}>Faiz Aam</span>
                <span className={styles.brandSub}>Secondary School · Bandipora</span>
                <span className={`urdu urdu--lg ${styles.brandUrdu}`} dir="rtl" lang="ur">
                  فیض عام
                </span>
              </div>
            </div>
            <p className={styles.demoNote}>Demo data · fictional readings</p>
          </header>

          <div className={styles.hero}>
            <div className={styles.heroTemp}>
              <p className={styles.heroLabel}>Outdoor temperature</p>
              <p className={`num ${styles.heroTempValue}`}>{formatMetricValue("temp_c", snapshot.outdoor.tempC)}</p>
            </div>
            <div className={styles.heroAqi}>
              <p className={styles.heroLabel}>CPCB air quality index</p>
              <p className={`num ${styles.heroAqiValue}`}>{snapshot.outdoor.aqiIndex}</p>
              <p className={styles.heroAqiBand}>{AQI_BAND_LABELS[snapshot.outdoor.aqiBand]}</p>
            </div>
            <div className={styles.clock}>
              <p className={styles.heroLabel}>Bandipora time</p>
              <time className={`num ${styles.clockTime}`} dateTime={now.toISOString()}>
                {clockTime}
              </time>
              <p className={styles.clockDate}>{clockDate}</p>
            </div>
          </div>

          {snapshot.zones.length === 0 ? (
            <p className={styles.stateNote}>No zones configured.</p>
          ) : (
            <ul className={styles.tiles}>
              {snapshot.zones.map((zone) => {
                const temp = zone.readings.temp_c;
                const co2 = zone.readings.co2_ppm;
                const pm25 = zone.readings.pm25_ugm3;
                return (
                  <li key={zone.zoneId} className={styles.tile}>
                    <p className={styles.tileName}>{zone.zoneName}</p>
                    <p className={styles.tileStatus}>
                      <span className={styles.squareDot} data-tone={ZONE_STATUS_TONE[zone.status]} aria-hidden="true" />
                      {ZONE_STATUS_LABELS[zone.status]}
                    </p>
                    <dl className={styles.tileValues}>
                      <div>
                        <dt>{METRIC_META.temp_c.shortLabel}</dt>
                        <dd className={`num ${styles.tileValue}`}>
                          {temp != null ? formatMetricValue("temp_c", temp) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>{METRIC_META.co2_ppm.shortLabel}</dt>
                        <dd className={`num ${styles.tileValue}`}>
                          {co2 != null ? formatMetricValue("co2_ppm", co2) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>{METRIC_META.pm25_ugm3.shortLabel}</dt>
                        <dd className={`num ${styles.tileValue}`}>
                          {pm25 != null ? formatMetricValue("pm25_ugm3", pm25) : "—"}
                        </dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}

          <p className={styles.alertLine}>
            {snapshot.latestAlert ? (
              <>
                <span
                  className={styles.squareDot}
                  data-tone={SEVERITY_TONE[snapshot.latestAlert.severity]}
                  aria-hidden="true"
                />
                <strong>{ALERT_SEVERITY_LABELS[snapshot.latestAlert.severity]}</strong>
                <span>{snapshot.latestAlert.title}</span>
                <span className={styles.alertZone}>{zoneNames.current.get(snapshot.latestAlert.zoneId) ?? "Unknown zone"}</span>
              </>
            ) : (
              <span>No open alerts</span>
            )}
          </p>

          <p className={styles.updated}>Updated {formatKolkata(snapshot.takenAt, { format: "full" })}</p>
        </>
      ) : null}

      <footer className={styles.foot}>
        <p className="folio folio--chalk">Faiz Aam Secondary School · Bandipora</p>
        <p className={styles.footNote}>Fictional demo readings · not for public broadcast</p>
      </footer>
    </section>
  );
}
