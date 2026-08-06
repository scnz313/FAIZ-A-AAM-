import type { Metadata } from "next";

import { AdmissionsQueue } from "@/components/staff/AdmissionsQueue";
import { admissionsQueueCounts } from "@/modules/admissions/demo";
import { admissionsService } from "@/modules/services/admissions";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Admissions · Staff",
};

export default async function StaffAdmissionsPage() {
  /* Fixture-derived rows server-side; the queue component refreshes from
     the demo session on mount so live decisions and new submissions show. */
  const rows = await admissionsService.listStaffRecords();
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Admissions</p>
        <h1 className="workspace-title">Admissions</h1>
        <p className="workspace-intro">Session 2026-27 · applications by status.</p>
      </header>

      <div className={styles.metrics}>
        <p className={styles.metric}>
          <span className="section-label">Submitted</span>
          <strong className={`num ${styles.metricNum}`}>{admissionsQueueCounts.pendingReview}</strong>
        </p>
        <p className={styles.metric}>
          <span className="section-label">Assessment</span>
          <strong className={`num ${styles.metricNum}`}>{admissionsQueueCounts.awaitingAssessment}</strong>
        </p>
        <p className={styles.metric}>
          <span className="section-label">Offers</span>
          <strong className={`num ${styles.metricNum}`}>{admissionsQueueCounts.offersOutstanding}</strong>
        </p>
        <p className={styles.metric}>
          <span className="section-label">Flagged</span>
          <strong className={`num ${styles.metricNum}`}>{admissionsQueueCounts.flagged}</strong>
        </p>
      </div>

      <AdmissionsQueue rows={rows} />

      <p className="demo-note">Demo session — every application above is fictional concept data.</p>
    </div>
  );
}
