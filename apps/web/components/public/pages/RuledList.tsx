import type { ReactNode } from "react";

import styles from "./RuledList.module.css";

export type RuledRow = {
  /** Serif numeral prefix, e.g. "01". */
  num?: string;
  /** Row title, set in the serif. */
  term: ReactNode;
  /** Small-caps line under the title, e.g. "Classes 1–5". */
  sub?: ReactNode;
  /** Detail column: prose, a badge, or a link. */
  detail: ReactNode;
};

type RuledListProps = {
  rows: readonly RuledRow[];
  /** Optional accessible name for the list. */
  label?: string;
};

/** Hairline-ruled two-column list — the standard editorial row. */
export default function RuledList({ rows, label }: RuledListProps) {
  return (
    <ul className={styles.list} aria-label={label}>
      {rows.map((row, index) => (
        <li className={styles.row} key={index}>
          <div className={styles.termCol}>
            {row.num ? (
              <span className={`serif-num ${styles.num}`}>{row.num}</span>
            ) : null}
            <p className={styles.term}>{row.term}</p>
            {row.sub ? <p className={styles.sub}>{row.sub}</p> : null}
          </div>
          <div className={styles.detail}>{row.detail}</div>
        </li>
      ))}
    </ul>
  );
}
