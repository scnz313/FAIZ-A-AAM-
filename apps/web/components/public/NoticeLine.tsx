import { AQI_BAND_LABELS, type OverviewSummary } from "@fass/contracts";
import { getOverview } from "@/lib/iot/api";
import { formatKolkata } from "@/modules/iot/domain";
import { BAND_TONE } from "./shared";
import styles from "./NoticeLine.module.css";

/**
 * Latest-notice strip. The reading line is a live-ish tie-in to the
 * campus environment slice; if the facade is unavailable, the strip
 * falls back to the static advisory copy alone.
 */
export default async function NoticeLine() {
  let overview: OverviewSummary | null = null;
  try {
    overview = await getOverview();
  } catch {
    overview = null;
  }
  const outdoor = overview?.outdoor ?? null;

  return (
    <aside className="alert-strip alert-strip--warning" aria-label="Latest notice">
      <div className={styles.inner}>
        <p className={styles.text}>
          {overview ? (
            <span className={styles.date}>{formatKolkata(overview.takenAt, { format: "day" })}</span>
          ) : null}
          <strong>Winter air-quality advisory — the school moves assembly indoors on poor-air days.</strong>
        </p>
        {outdoor ? (
          <p className={styles.reading}>
            <span
              className={`status-dot status-dot--${BAND_TONE[outdoor.aqiBand]}`}
              aria-hidden="true"
            />
            <span>
              Right now: {AQI_BAND_LABELS[outdoor.aqiBand]} air · AQI{" "}
              {outdoor.aqiIndex}
            </span>
            <span className={styles.demoTag}>demo reading</span>
          </p>
        ) : null}
        <a className="link-arrow" href="/environment">
          Campus environment →
        </a>
      </div>
    </aside>
  );
}
