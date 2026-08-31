import type { Metadata } from "next";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { academicsService, ENTRY_BATCH_STATUS_META } from "@/modules/services/academics";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerResultBatch, loadServerResultVersions } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = { title: "Result batch · Staff" };

export default async function ResultBatchPage({ params }: { params: Promise<{ resultBatchRef: string }> }) {
  const { resultBatchRef } = await params;
  const batch = dataAdapter() === "supabase"
    ? await loadServerResultBatch(resultBatchRef) as Awaited<ReturnType<typeof academicsService.getBatch>>
    : await academicsService.getBatch(resultBatchRef);
  const versions = dataAdapter() === "supabase"
    ? await loadServerResultVersions(resultBatchRef) as Awaited<ReturnType<typeof academicsService.listVersions>>
    : await academicsService.listVersions(resultBatchRef);

  if (batch === null) {
    return <div className={styles.page}><Link prefetch={false} className="link-arrow" href="/staff/results">← Results</Link><h1 className="workspace-title">Batch not found</h1><p className="workspace-intro">No result entry sheet carries the reference <span className="num">{resultBatchRef}</span>.</p></div>;
  }
  if (batch === undefined) return <p className={styles.loading}>Result entry sheet unavailable.</p>;
  const status = ENTRY_BATCH_STATUS_META[batch.status];
  const entered = batch.rows.filter((row) => row.obtained !== null).length;
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className={styles.backLink}><Link prefetch={false} className="link-arrow" href="/staff/results">← Results</Link></p>
        <p className="eyebrow">Staff · Results</p>
        <h1 className="workspace-title">{batch.exam} · {batch.className}</h1>
        <p className={`workspace-intro ${styles.meta}`}><span className="num">{batch.ref}</span> · {entered}/{batch.rows.length} marks entered · v{batch.version}</p>
        <div className={styles.badgeRow}><StatusBadge tone={status.tone}>{status.label}</StatusBadge><Button variant="quiet" href={`/staff/results/${batch.ref}/entry`}>Open entry workspace →</Button></div>
      </header>
      <section aria-labelledby="version-history-heading">
        <p className="section-label" id="version-history-heading">Version history</p>
        {versions.length > 0 ? <ol className={styles.versionList}>{versions.map((version) => <li key={version.version} className={styles.versionRow}><strong className={`num ${styles.versionNum}`}>v{version.version}</strong><span className={styles.versionCopy}><span className={styles.versionNote}>{version.note}</span><small>{formatKolkata(version.atIso, { format: "full" })} · {version.by}</small></span></li>)}</ol> : <p className={styles.noVersions}>No corrections recorded.</p>}
      </section>
      <div className={styles.ruleNote}><p>Published results are versioned; corrections never silently rewrite history.</p>{dataAdapter() !== "supabase" ? <p>{ACADEMICS_DEMO_NOTE}</p> : null}</div>
    </div>
  );
}
