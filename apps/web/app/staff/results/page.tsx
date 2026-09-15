import type { Metadata } from "next";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { ResultsBatches } from "@/components/staff/ResultsBatches";
import { academicsService } from "@/modules/services/academics";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerResultsBatches } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Results · Staff",
};

export default async function ResultsPage() {
  const batches = dataAdapter() === "supabase"
    ? await loadServerResultsBatches()
    : await academicsService.listBatches();
  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Results</h1>
          <p className="ph-sub">Entry → Moderation → Published; corrections create new versions.</p>
        </div>
      </div>

      <ResultsBatches batches={batches} />

      <div className={styles.ruleNote}>
        <p>Published results are versioned; corrections never silently rewrite history.</p>
        {dataAdapter() !== "supabase" ? <p>{ACADEMICS_DEMO_NOTE}</p> : null}
      </div>
    </div>
  );
}
