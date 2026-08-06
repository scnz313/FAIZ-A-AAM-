import { StatusBadge } from "@/components/ui/StatusBadge";
import styles from "./EnvironmentAdvisory.module.css";

/**
 * Plain-language guide to the air-quality bands, plus the honest note
 * that these are concept readings until the real fleet is installed.
 */
export default function EnvironmentAdvisory() {
  return (
    <section className={styles.section} aria-labelledby="advisory-heading">
      <div className={`panel ${styles.panel}`}>
        <h2 className={styles.heading} id="advisory-heading">
          Reading the numbers
        </h2>
        <p className={styles.intro}>
          The bands follow the national air-quality index used across India.
          In plain terms, for a parent:
        </p>
        <ul className={styles.bands}>
          <li className={styles.bandRow}>
            <StatusBadge tone="good">Good · Satisfactory</StatusBadge>
            <p>
              An ordinary outdoor day. Assembly, games, and PE run as usual.
            </p>
          </li>
          <li className={styles.bandRow}>
            <StatusBadge tone="watch">Moderate</StatusBadge>
            <p>
              Sensitive children may feel the air. Windows stay open where it
              helps, and staff watch for coughs and discomfort.
            </p>
          </li>
          <li className={styles.bandRow}>
            <StatusBadge tone="alert">Poor · Very poor · Severe</StatusBadge>
            <p>
              Assembly moves indoors, windows stay closed in peak hours, and
              PE is modified or moved. On severe days, outdoor time is
              cancelled.
            </p>
          </li>
        </ul>
        <p className={styles.note}>
          These readings are concept data shown for design review. Until the
          sensor fleet is installed, they describe how the school will report
          its environment — not the current campus air.
        </p>
      </div>
    </section>
  );
}
