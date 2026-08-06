import type { AqiBand, OutdoorConditions, OverviewSummary } from "@fass/contracts";
import { aqiBandLabel, formatKolkata, formatMetricValue } from "@/modules/iot/domain";
import { StatusBadge } from "@/components/ui/StatusBadge";

import styles from "./HeadlineBand.module.css";

type StatusTone = "good" | "watch" | "alert" | "neutral" | "offline";

type Breakdown = {
  comfortable: number;
  watch: number;
  action: number;
};

type HeadlineBandProps = {
  outdoor: OutdoorConditions;
  indoor: OverviewSummary["indoorComfort"];
  fleet: OverviewSummary["fleet"];
  breakdown: Breakdown;
  takenAt: string;
};

function aqiTone(band: AqiBand): StatusTone {
  if (band === "good" || band === "satisfactory") return "good";
  if (band === "moderate") return "watch";
  return "alert";
}

/** Ruled three-column band: outdoor air, indoor comfort, device fleet. */
export function HeadlineBand({ outdoor, indoor, fleet, breakdown, takenAt }: HeadlineBandProps) {
  return (
    <section className={styles.band}>
      <span className={`demo-badge ${styles.badge}`}>Demo data · fictional readings</span>

      <div className={styles.grid}>
        <section className={styles.col}>
          <p className="section-label">Outdoor air</p>
          <p className={styles.bigNum}>
            <span className="num">{outdoor.aqiIndex}</span>
          </p>
          <p className={styles.aqiLine}>
            <StatusBadge tone={aqiTone(outdoor.aqiBand)}>{aqiBandLabel(outdoor.aqiBand)}</StatusBadge>
          </p>
          <p className={styles.detail}>
            PM2.5 <span className="num">{formatMetricValue("pm25_ugm3", outdoor.pm25Ugm3)}</span>
            {" · "}
            <span className="num">{formatMetricValue("temp_c", outdoor.tempC)}</span>
            {" · "}
            <span className="num">{formatMetricValue("humidity_pct", outdoor.humidityPct)}</span> humidity
          </p>
          <p className={styles.asOf}>as of {formatKolkata(takenAt)} IST</p>
        </section>

        <section className={styles.col}>
          <p className="section-label">Indoor comfort</p>
          <p className={styles.bigLine}>
            <span className={`num ${styles.bigNum}`}>{indoor.comfortableZones}</span>
            <span className={styles.bigSuffix}>of {indoor.totalZones} zones comfortable</span>
          </p>
          <ul className={styles.breakdown}>
            <li>
              <span className="status-dot status-dot--good" aria-hidden="true" />
              <span className="num">{breakdown.comfortable}</span> comfortable
            </li>
            <li>
              <span className="status-dot status-dot--watch" aria-hidden="true" />
              <span className="num">{breakdown.watch}</span> watch
            </li>
            <li>
              <span className="status-dot status-dot--alert" aria-hidden="true" />
              <span className="num">{breakdown.action}</span> action
            </li>
          </ul>
        </section>

        <section className={styles.col}>
          <p className="section-label">Device fleet</p>
          <p className={styles.bigLine}>
            <span className={`num ${styles.bigNum}`}>{fleet.online}</span>
            <span className={styles.bigSuffix}>of {fleet.totalDevices} devices online</span>
          </p>
          <ul className={styles.breakdown}>
            <li>
              <span className="status-dot status-dot--watch" aria-hidden="true" />
              <span className="num">{fleet.lowBattery}</span> low battery
            </li>
            <li>
              <span className="status-dot status-dot--offline" aria-hidden="true" />
              <span className="num">{fleet.offline}</span> offline
            </li>
            <li>
              <span className="status-dot status-dot--neutral" aria-hidden="true" />
              <span className="num">{fleet.maintenance}</span> maintenance
            </li>
          </ul>
        </section>
      </div>
    </section>
  );
}
