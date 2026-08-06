import styles from "./page.module.css";

/** Minimal ruled skeleton for the campus environment page. */
export default function Loading() {
  return (
    <div
      className={styles.page}
      aria-busy="true"
      aria-label="Loading campus environment readings"
    >
      <div className={styles.skeletonHero}>
        <p className="eyebrow">Campus environment</p>
        <span className={`${styles.skeletonBar} ${styles.barWide}`} aria-hidden="true" />
        <span className={`${styles.skeletonBar} ${styles.barMedium}`} aria-hidden="true" />
      </div>
      <div className={`metric-grid ${styles.skeletonGrid}`} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div className="metric-cell" key={i}>
            <span className={`${styles.skeletonBar} ${styles.barLabel}`} />
            <span className={`${styles.skeletonBar} ${styles.barValue}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
