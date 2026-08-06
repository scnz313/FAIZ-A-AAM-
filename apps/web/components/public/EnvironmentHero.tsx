import { ChinarMark } from "@/components/ui/ChinarMark";
import { ChinarBranch } from "@/components/ui/art";
import styles from "./EnvironmentHero.module.css";

/** Paper-toned page header for the campus environment page. */
export default function EnvironmentHero() {
  return (
    <header className={styles.hero} aria-labelledby="environment-title">
      <div className={styles.headRow}>
        <div className={styles.headCol}>
          <p className="eyebrow">
            Campus environment <ChinarMark size={16} tone="saffron" />
          </p>
          <h1 className={styles.title} id="environment-title">
            The school, measured.
          </h1>
          <p className={styles.deck}>
            Fixed sensors across the campus track air, warmth, and light — so the
            school day can be adjusted to what children actually breathe and feel.
          </p>
          <p className={`folio ${styles.folio}`}>
            CAMPUS ENVIRONMENT · FAIZ AAM SECONDARY SCHOOL
          </p>
        </div>
        <ChinarBranch ariaHidden className={styles.branch} />
      </div>
    </header>
  );
}
