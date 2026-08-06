import { AQI_BAND_LABELS, METRIC_META, type OutdoorConditions } from "@fass/contracts";
import DemoNotice from "@/components/layouts/DemoNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatKolkata } from "@/modules/iot/domain";
import { BAND_TONE } from "./shared";
import styles from "./EnvironmentConditions.module.css";

export default function EnvironmentConditions({
  outdoor,
}: {
  outdoor: OutdoorConditions | null;
}) {
  return (
    <section className={styles.section} aria-labelledby="conditions-heading">
      <div className={styles.head}>
        <p className="section-label">Outdoor conditions</p>
        <h2 className={styles.heading} id="conditions-heading">
          The air outside, now.
        </h2>
      </div>

      <DemoNotice />

      {outdoor ? (
        <>
          <div className="metric-grid">
            <div className="metric-cell">
              <span className={styles.label}>{METRIC_META.temp_c.shortLabel}</span>
              <strong className={`num ${styles.value}`}>
                {outdoor.tempC.toFixed(METRIC_META.temp_c.decimals)}
                <small className={styles.unit}>{METRIC_META.temp_c.unit}</small>
              </strong>
            </div>
            <div className="metric-cell">
              <span className={styles.label}>
                {METRIC_META.humidity_pct.shortLabel}
              </span>
              <strong className={`num ${styles.value}`}>
                {outdoor.humidityPct.toFixed(METRIC_META.humidity_pct.decimals)}
                <small className={styles.unit}>
                  {METRIC_META.humidity_pct.unit}
                </small>
              </strong>
            </div>
            <div className="metric-cell">
              <span className={styles.label}>
                {METRIC_META.pm25_ugm3.shortLabel}
              </span>
              <strong className={`num ${styles.value}`}>
                {outdoor.pm25Ugm3.toFixed(METRIC_META.pm25_ugm3.decimals)}
                <small className={styles.unit}>
                  {METRIC_META.pm25_ugm3.unit}
                </small>
              </strong>
            </div>
            <div className="metric-cell">
              <span className={styles.label}>CPCB AQI</span>
              <strong className={`num ${styles.value}`}>
                {outdoor.aqiIndex}
                <small className={styles.unit}>AQI</small>
              </strong>
              <span className={styles.band}>
                <StatusBadge tone={BAND_TONE[outdoor.aqiBand]}>
                  {AQI_BAND_LABELS[outdoor.aqiBand]}
                </StatusBadge>
              </span>
            </div>
          </div>
          <p className={styles.caption}>
            Readings as of {formatKolkata(outdoor.takenAt)} IST · Bandipora
          </p>
        </>
      ) : (
        <div className="panel">
          <p className={styles.fallback}>
            Readings are temporarily unavailable. Please check back shortly.
          </p>
        </div>
      )}
    </section>
  );
}
