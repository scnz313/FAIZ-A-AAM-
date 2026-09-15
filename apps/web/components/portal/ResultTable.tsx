"use client";

import { useState } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { Term } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import type { SnapshotMarkRow } from "@/modules/services/academics";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { documentsService } from "@/modules/services/documents";

import styles from "./ResultTable.module.css";

type ResultTableProps = {
  term: Term;
  /** The published per-student snapshot rows for this term. */
  marks: ReadonlyArray<SnapshotMarkRow>;
  /** The generated report-card PDF for this release, when it exists and is downloadable. */
  reportCardDocument?: { reference: string; filename: string } | null;
};

/**
 * Published report for one term: publication line, subject marks table,
 * aggregate summary (where policy allows), and the official PDF state.
 * Corrections publish as new versions and are labelled. The PDF control
 * reflects the real generated document when one exists for this release,
 * and otherwise states honestly that it is not available yet.
 */
export function ResultTable({ term, marks, reportCardDocument = null }: ResultTableProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  /* Only present marks contribute to the aggregate; absent/exempt/not-applicable
   * subjects are excluded from both numerator and denominator. */
  const presentMarks = marks.filter((mark) => mark.markStatus === undefined || mark.markStatus === "present");
  const totalObtained = presentMarks.reduce((sum, mark) => sum + (mark.obtained ?? 0), 0);
  const totalMax = presentMarks.reduce((sum, mark) => sum + mark.max, 0);
  const percentage = totalMax === 0 ? 0 : (totalObtained / totalMax) * 100;
  const published = term.publishedAtIso ? formatKolkata(term.publishedAtIso, { format: "day" }) : null;
  const isFinal = term.publicationStatus === "final";
  const supabaseMode = clientAdapterMode() === "supabase";
  const downloadable = supabaseMode && reportCardDocument !== null;

  /* The generated report card is a private document behind a short-lived
   * signed link: authorise through the document boundary, then open the
   * link. The same control in the documents register shares this contract. */
  async function downloadReportCard(): Promise<void> {
    if (reportCardDocument === null || downloading) return;
    setDownloading(true);
    setDownloadNote(null);
    try {
      const result = await documentsService.requestDownload(reportCardDocument.reference);
      if (result.state !== "ready") {
        setDownloadNote(result.message);
        return;
      }
      const expiresAt = new Date(result.expiresAtIso).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        setDownloadNote("The short-lived link expired before it could open. Request a fresh download.");
        return;
      }
      const link = window.document.createElement("a");
      link.href = result.url;
      link.download = result.filename;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloadNote("A short-lived download link was issued and opened in a new tab.");
    } catch {
      setDownloadNote("The download request failed. Check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className={`panel ${styles.panel}`} aria-labelledby={`result-heading-${term.id}`}>
      <div className={styles.publication}>
        <StatusBadge tone={isFinal ? "good" : "watch"}>
          {isFinal ? "Final report" : "Provisional report"}
          {published ? ` · published ${published}` : ""}
        </StatusBadge>
        {term.version !== undefined && term.version > 1 && (
          <p className={styles.versionNote}>
            v{term.version} is a corrected release · earlier versions remain on record.
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
            {marks.map((mark) => {
              const statusLabel = mark.markStatus === "absent" ? "Absent"
                : mark.markStatus === "exempt" ? "Exempt"
                : mark.markStatus === "not_applicable" ? "N/A"
                : null;
              return (
              <tr key={mark.subject}>
                <td className={styles.subjectCell}>
                  <strong>{mark.subject}</strong>
                </td>
                <td className={`num ${styles.numCol}`}>{mark.max}</td>
                <td className={`num ${styles.numCol}`}>
                  {statusLabel !== null ? <em className={styles.grade}>{statusLabel}</em> : mark.obtained}
                </td>
                <td>
                  <span className={styles.grade}>{mark.grade}</span>
                </td>
                <td className={styles.remarkCell}>{mark.remark}</td>
              </tr>
              );
            })}
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
          Computed from the released subject marks. Class ranks and comparisons are never published.
        </p>
      </div>

      <div className={styles.download}>
        {downloadable ? (
          <Button variant="quiet" onClick={() => void downloadReportCard()} disabled={downloading}>
            {downloading ? "Authorizing…" : "Download official report (PDF)"}
          </Button>
        ) : (
          <Button variant="quiet" disabled>
            {supabaseMode ? "Official report (PDF)" : "Official report (PDF) · demo"}
          </Button>
        )}
        <p className={styles.downloadNote} role={downloadNote !== null ? "status" : undefined}>
          {downloadNote ?? (supabaseMode
            ? downloadable
              ? "Locked PDF · the school's generated report card, delivered through a short-lived private link."
              : "The official report is being prepared. It will appear in the documents section once generated."
            : "PDF generation arrives with the results backend; this button is a placeholder for the official report.")}
        </p>
      </div>
    </section>
  );
}
