import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarksEntry } from "@/components/staff/MarksEntry";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { academicsService } from "@/modules/services/academics";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerResultBatch } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export async function generateMetadata({ params }: { params: Promise<{ resultBatchRef: string }> }): Promise<Metadata> {
  const { resultBatchRef } = await params;
  const batch = dataAdapter() === "supabase"
    ? await loadServerResultBatch(resultBatchRef) as Awaited<ReturnType<typeof academicsService.getBatch>>
    : await academicsService.getBatch(resultBatchRef);
  return {
    title: batch ? `Marks entry · ${batch.exam} · ${batch.className}` : "Marks entry · Staff",
  };
}

/**
 * The working marks-entry workspace route. The batch is resolved through
 * the academics service; unknown references get the editorial not-found.
 */
export default async function MarksEntryPage({ params }: { params: Promise<{ resultBatchRef: string }> }) {
  const { resultBatchRef } = await params;
  const batch = dataAdapter() === "supabase"
    ? await loadServerResultBatch(resultBatchRef) as Awaited<ReturnType<typeof academicsService.getBatch>>
    : await academicsService.getBatch(resultBatchRef);
  if (!batch) notFound();

  return (
    <div className={styles.page}>
      <MarksEntry batchRef={resultBatchRef} initialBatch={batch} />

      <div className={styles.ruleNote}>
        <p>Published results are versioned; corrections never silently rewrite history.</p>
        {dataAdapter() !== "supabase" ? <p>{ACADEMICS_DEMO_NOTE}</p> : null}
      </div>
    </div>
  );
}
