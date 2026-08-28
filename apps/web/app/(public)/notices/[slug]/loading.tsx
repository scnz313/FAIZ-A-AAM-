import styles from "./page.module.css";

/** Minimal ruled skeleton for the notice detail route. */
export default function Loading() {
  return (
    <div className={styles.body} aria-busy="true" aria-label="Loading notice">
      <span className="skeleton-rule" aria-hidden="true" />
      <span className={`skeleton-bar ${styles.skeletonTitle}`} aria-hidden="true" />
      <span className={`skeleton-bar ${styles.skeletonLine}`} aria-hidden="true" />
      <span className={`skeleton-bar ${styles.skeletonLine}`} aria-hidden="true" />
      <span className={`skeleton-bar ${styles.skeletonLineShort}`} aria-hidden="true" />
    </div>
  );
}
