import type { ReactNode } from "react";

import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import styles from "./ConceptNote.module.css";

type ConceptNoteProps = {
  /** Page-specific sentence appended to the shared demo note. */
  children?: ReactNode;
};

/**
 * Closing chalk panel on every public page: the shared demo-data note plus
 * a page-specific line, marked with the dashed "Demo data" chip.
 */
export default function ConceptNote({ children }: ConceptNoteProps) {
  return (
    <aside className={styles.wrap}>
      <div className={`panel ${styles.note}`}>
        <p className={styles.head}>
          <span className="kicker">Concept note</span>
          <span className="demo-badge">Demo data</span>
        </p>
        <p className={styles.text}>
          {CONTENT_DEMO_NOTE}
          {children ? <span className={styles.extra}> {children}</span> : null}
        </p>
      </div>
    </aside>
  );
}
