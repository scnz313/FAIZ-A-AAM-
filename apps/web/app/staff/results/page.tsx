import type { Metadata } from "next";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { ResultsBatches } from "@/components/staff/ResultsBatches";
import { academicsService } from "@/modules/services/academics";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Results · Staff",
};

export default async function ResultsPage() {
  const batches = await academicsService.listBatches();
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Results</p>
        <h1 className="workspace-title">Results</h1>
        <p className="workspace-intro">Entry → Moderation → Published; corrections create new versions.</p>
      </header>

      <ResultsBatches batches={batches} />

      <div className={styles.ruleNote}>
        <p>Published results are versioned; corrections never silently rewrite history.</p>
        <p>{ACADEMICS_DEMO_NOTE}</p>
      </div>
    </div>
  );
}
