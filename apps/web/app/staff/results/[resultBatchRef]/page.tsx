"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { academicsService, ENTRY_BATCH_STATUS_META } from "@/modules/services/academics";
import type { BatchVersion, EntryBatch } from "@/modules/services/academics";

import styles from "./page.module.css";

function BatchNotFound({ reference }: { reference: string }) {
  return (
    <div className={styles.page}>
      <a className="link-arrow" href="/staff/results">
        ← Results
      </a>
      <h1 className="workspace-title">Batch not found</h1>
      <p className="workspace-intro">
        No result batch carries the reference <span className="num">{reference}</span>. It may have been removed,
        or the link is incorrect.
      </p>
      <a className="link-arrow" href="/staff/results">
        Back to all batches →
      </a>
    </div>
  );
}

/**
 * Batch detail — reads the batch and its version history through the
 * academics service so the state matches the demo session (drafts,
 * approvals, publications, and corrections made in this browser tab).
 */
export default function ResultBatchPage() {
  const params = useParams<{ resultBatchRef: string }>();
  const resultBatchRef = params.resultBatchRef;
  const [batch, setBatch] = useState<EntryBatch | null | undefined>(undefined);
  const [versions, setVersions] = useState<BatchVersion[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([academicsService.getBatch(resultBatchRef), academicsService.listVersions(resultBatchRef)]).then(
      ([nextBatch, nextVersions]) => {
        if (cancelled) return;
        setBatch(nextBatch);
        setVersions(nextVersions);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [resultBatchRef]);

  useEffect(() => {
    if (batch) document.title = `${batch.exam} · ${batch.className} · Staff`;
  }, [batch]);

  if (batch === undefined) {
    return <p className={styles.loading}>Loading batch…</p>;
  }
  if (batch === null) return <BatchNotFound reference={resultBatchRef} />;

  const status = ENTRY_BATCH_STATUS_META[batch.status];
  const entered = batch.rows.filter((row) => row.obtained !== null).length;

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className={styles.backLink}>
          <a className="link-arrow" href="/staff/results">
            ← Results
          </a>
        </p>
        <p className="eyebrow">Staff · Results</p>
        <h1 className="workspace-title">
          {batch.exam} · {batch.className}
        </h1>
        <p className={`workspace-intro ${styles.meta}`}>
          <span className="num">{batch.ref}</span> · {entered}/{batch.rows.length} marks entered · v{batch.version}
        </p>
        <div className={styles.badgeRow}>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <Button variant="quiet" href={`/staff/results/${batch.ref}/entry`}>
            Open entry workspace →
          </Button>
          <span className="demo-badge">Demo data</span>
        </div>
      </header>

      <section aria-labelledby="version-history-heading">
        <p className="section-label" id="version-history-heading">
          Version history
        </p>
        {versions.length > 0 ? (
          <ol className={styles.versionList}>
            {versions.map((version) => (
              <li key={version.version} className={styles.versionRow}>
                <strong className={`num ${styles.versionNum}`}>v{version.version}</strong>
                <span className={styles.versionCopy}>
                  <span className={styles.versionNote}>{version.note}</span>
                  <small>
                    {formatKolkata(version.atIso, { format: "full" })} · {version.by}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.noVersions}>No corrections recorded.</p>
        )}
      </section>

      <div className={styles.ruleNote}>
        <p>Published results are versioned; corrections never silently rewrite history.</p>
        <p>{ACADEMICS_DEMO_NOTE}</p>
      </div>

      <p className={styles.backLink}>
        <a className="link-arrow" href="/staff/results">
          Back to all batches →
        </a>
      </p>
    </div>
  );
}
