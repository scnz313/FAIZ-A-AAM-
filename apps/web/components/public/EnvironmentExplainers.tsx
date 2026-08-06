import { METRIC_META, type MetricType } from "@fass/contracts";
import styles from "./EnvironmentExplainers.module.css";

const ROWS: Array<{ metric: MetricType; meaning: string; why: string }> = [
  {
    metric: "temp_c",
    meaning:
      "How warm or cool the air is, indoors and out.",
    why: "In the heating season a cold classroom is a real complaint; an overheated one makes the afternoon sluggish.",
  },
  {
    metric: "humidity_pct",
    meaning:
      "Moisture in the air. Very dry air dries eyes and throats; very damp air feels colder than it is.",
    why: "Winter heating dries rooms out, while the monsoon weeks push the other way.",
  },
  {
    metric: "co2_ppm",
    meaning:
      "A measure of stale air. It climbs as people breathe in a closed room.",
    why: "Concentration drops as CO₂ rises; we open doors and windows at set thresholds.",
  },
  {
    metric: "pm25_ugm3",
    meaning:
      "Fine particles small enough to reach the lungs.",
    why: "Winter inversions trap smoke and dust in the valley — the main reason we watch outdoor air.",
  },
  {
    metric: "pm10_ugm3",
    meaning:
      "Larger dust particles from roads, construction, and open ground.",
    why: "Grounds and play areas are the exposure point; activities shift when it is high.",
  },
  {
    metric: "light_lux",
    meaning:
      "Brightness at desk and board height.",
    why: "Short winter afternoons make good classroom light a teaching matter, not a luxury.",
  },
];

export default function EnvironmentExplainers() {
  return (
    <section className={styles.section} aria-labelledby="explainers-heading">
      <div className={styles.head}>
        <p className="section-label">What we measure</p>
        <h2 className={styles.heading} id="explainers-heading">
          The metrics that matter here.
        </h2>
      </div>

      <div className={styles.rowHead} aria-hidden="true">
        <span className="kicker">What we measure</span>
        <span className="kicker">What it means</span>
        <span className="kicker">Why the school watches</span>
      </div>

      <ul className={styles.rows}>
        {ROWS.map((row) => (
          <li className={styles.row} key={row.metric}>
            <strong className={styles.metric} id={`explainer-${row.metric}`}>
              {METRIC_META[row.metric].label}
            </strong>
            <div aria-labelledby={`explainer-${row.metric}`}>
              <p className={styles.meaning}>{row.meaning}</p>
              <p className={styles.why}>{row.why}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
