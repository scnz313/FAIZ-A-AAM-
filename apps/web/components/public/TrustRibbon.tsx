import styles from "./TrustRibbon.module.css";

/**
 * One quiet line of trust facts under the hero CTAs — admissions cycle,
 * then the honest affiliation status. Everything else was cut for
 * minimalism; the details live on /admissions and /disclosure.
 */
export default function TrustRibbon() {
  return (
    <p className={styles.ribbon}>
      Admissions open · Classes 6–10 ·{" "}
      <a className={styles.link} href="/disclosure">
        affiliation pending verification
      </a>
    </p>
  );
}
