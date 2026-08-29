import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Term } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import type { SnapshotMarkRow } from "@/modules/services/academics";

import styles from "./ResultTable.module.css";

type ResultTableProps = {
  term: Term;
  /** The published per-student snapshot rows for this term. */
  marks: ReadonlyArray<SnapshotMarkRow>;
};

/**
 * Published report for one term: publication line, subject marks table,
 * aggregate summary (where policy allows), and the placeholder official
 * PDF download. Corrections publish as new versions and are labelled.
 */
export function ResultTable({ term, marks }: ResultTableProps) {
  const totalObtained = marks.reduce((sum, mark) => sum + (mark.obtained ?? 0), 0);
  const totalMax = marks.reduce((sum, mark) => sum + mark.max, 0);
  const percentage = totalMax === 0 ? 0 : (totalObtained / totalMax) * 100;
  const published = term.publishedAtIso ? formatKolkata(term.publishedAtIso, { format: "day" }) : null;
  const isFinal = term.publicationStatus === "final";

  return (
    <section className={`panel ${styles.panel}`} aria-labelledby={`result-heading-${term.id}`}>
      <div className={styles.publication}>
        <StatusBadge tone={isFinal ? "good" : "watch"}>
          {isFinal ? "Final report" : "Provisional report"}
          {published ? ` · published ${published}` : ""}
        </StatusBadge>
        {term.version !== undefined && term.version > 1 && (
          <p className={styles.versionNote}>
            v{term.version} corrects the {term.label} Urdu grade — earlier versions remain on record.
          </p>
        )}
      </div>

      <h2 id={`result-heading-${term.id}`} className={styles.reportTitle}>
        {term.label} report
      </h2>

      <div className="table--scroll">
        <table className={`table ${styles.subjectTable}`}>
          <caption className="sr-only">Subject marks for {term.label}</caption>
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col" className={`num ${styles.numCol}`}>Max</th>
              <th scope="col" className={`num ${styles.numCol}`}>Obtained</th>
              <th scope="col">Grade</th>
              <th scope="col">Teacher remark</th>
            </tr>
          </thead>
          <tbody>
            {marks.map((mark) => (
              <tr key={mark.subject}>
                <td className={styles.subjectCell}>
                  <strong>{mark.subject}</strong>
                </td>
                <td className={`num ${styles.numCol}`}>{mark.max}</td>
                <td className={`num ${styles.numCol}`}>{mark.obtained}</td>
                <td>
                  <span className={styles.grade}>{mark.grade}</span>
                </td>
                <td className={styles.remarkCell}>{mark.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.summary}>
        <p className="section-label">Overall</p>
        <p className={styles.summaryLine}>
          <strong className="num">{totalObtained}</strong> of <strong className="num">{totalMax}</strong> ·{" "}
          <strong className="num">{percentage.toFixed(1)}%</strong>
        </p>
        <p className={styles.summaryNote}>
          The school publishes the aggregate where policy allows, but never class ranks or comparisons.
        </p>
      </div>

      <div className={styles.download}>
        <Button variant="quiet" disabled>
          Official report (PDF) — demo
        </Button>
        <p className={styles.downloadNote}>
          PDF generation arrives with the results backend; this button is a placeholder for the official report.
        </p>
      </div>
    </section>
  );
}
