import styles from "./ServiceRail.module.css";

const ITEMS = [
  { num: "01", audience: "New families", title: "Apply for admission", href: "/admissions" },
  { num: "02", audience: "Parents", title: "Pay school fees", href: "/portal/fees" },
  { num: "03", audience: "Students", title: "Results & reports", href: "/portal/results" },
  { num: "04", audience: "School day", title: "Class timetable", href: "/portal/timetable" },
] as const;

/**
 * Minimal service index: four journeys as a hairline-separated row of
 * quiet links — no boxes, no fills. The arrow moves on hover.
 */
export default function ServiceRail() {
  return (
    <nav className={styles.rail} aria-label="School services">
      {ITEMS.map((item) => (
        <a key={item.num} className={styles.item} href={item.href}>
          <span className={`serif-num ${styles.num}`}>{item.num}</span>
          <span className={styles.copy}>
            <small className={styles.audience}>{item.audience}</small>
            <strong className={styles.title}>{item.title}</strong>
          </span>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
        </a>
      ))}
    </nav>
  );
}
