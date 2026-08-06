import styles from "./UpcomingDates.module.css";

/** Fictional school calendar for the concept site. */
const DATES = [
  { day: "01", month: "Mar", label: "Admissions open", note: "Session 2027" },
  { day: "02", month: "Apr", label: "New session begins", note: "Classes 1–10" },
  { day: "21", month: "Sep", label: "Mid-term examinations", note: "All classes" },
  { day: "15", month: "Nov", label: "Annual day", note: "Evening programme" },
  { day: "21", month: "Dec", label: "Winter break begins", note: "School closed" },
] as const;

export default function UpcomingDates() {
  return (
    <section className={styles.section} aria-labelledby="dates-heading">
      <div className={styles.head}>
        <div>
          <p className="section-label">Upcoming dates</p>
          <h2 className={styles.heading} id="dates-heading">
            The school calendar.
          </h2>
        </div>
      </div>
      <ul className={styles.list}>
        {DATES.map((entry) => (
          <li className={styles.row} key={entry.day + entry.month}>
            <span className={styles.dateBlock}>
              <span className={`serif-num ${styles.day}`}>{entry.day}</span>
              <span className={styles.month}>{entry.month}</span>
            </span>
            <strong className={styles.label}>{entry.label}</strong>
            <span className={styles.note}>{entry.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
