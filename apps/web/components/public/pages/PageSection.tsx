import type { ReactNode } from "react";

import styles from "./PageSection.module.css";

type PageSectionProps = {
  /** Small-caps label above the heading, e.g. "History". */
  label: string;
  heading: string;
  /** Stable id for the h2, used by aria-labelledby. */
  headingId: string;
  children: ReactNode;
};

/**
 * Labelled editorial section for public pages: small-caps label, serif h2
 * and body content, padded to match PageIntro's reading column.
 */
export default function PageSection({ label, heading, headingId, children }: PageSectionProps) {
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.head}>
        <p className="section-label">{label}</p>
        <h2 className={styles.heading} id={headingId}>
          {heading}
        </h2>
      </div>
      {children}
    </section>
  );
}
