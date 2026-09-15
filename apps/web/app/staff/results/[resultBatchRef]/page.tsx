import type { Metadata } from "next";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import RetryButton from "@/components/ui/RetryButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import ResultReleasePanel from "@/components/staff/ResultReleasePanel";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { mapServerStaffContext } from "@/modules/services/staff-context";
import { academicsService, ENTRY_BATCH_STATUS_META } from "@/modules/services/academics";
import type { BatchVersion, EntryBatchStatus } from "@/modules/services/academics";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerProfileCode, loadServerResultBatch, loadServerResultVersions, loadServerStaffContext } from "@/lib/supabase/server-loaders";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";

import styles from "./page.module.css";

export const metadata: Metadata = { title: "Result batch · Staff" };

/** Readable fallback for a version row whose note is empty. */
function versionStateLabel(state?: string): string {
  if (state === undefined || !(state in ENTRY_BATCH_STATUS_META)) return "";
  return ENTRY_BATCH_STATUS_META[state as EntryBatchStatus].label;
}

function VersionHistory({ versions }: { versions: BatchVersion[] }) {
  if (versions.length === 0) return <p className={styles.noVersions}>No corrections recorded.</p>;
  return (
    <ol className={styles.versionList}>
      {versions.map((version) => (
        <li key={version.version} className={styles.versionRow}>
          <strong className={`num ${styles.versionNum}`}>v{version.version}</strong>
          <span className={styles.versionCopy}>
            <span className={styles.versionNote}>{version.note || versionStateLabel(version.state)}</span>
            {version.atIso || version.by ? (
              <small>{[version.atIso ? formatKolkata(version.atIso, { format: "full" }) : "", version.by ?? ""].filter(Boolean).join(" · ")}</small>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default async function ResultBatchPage({ params }: { params: Promise<{ resultBatchRef: string }> }) {
  const { resultBatchRef } = await params;
  let profileCode;
  let canEnterEntry = true;
  let batch;
  let versions;
  try {
    profileCode = await loadServerProfileCode();
    if (dataAdapter() === "supabase") {
      /* The entry workspace requires results.enter; a viewer who can read the
         batch but not enter marks must not be offered a dead-end control. */
      const staffContext = await loadServerStaffContext().catch(() => null);
      canEnterEntry = staffContext === null
        || canAnyRole(mapServerStaffContext(staffContext).summary.roles, "results.enter");
    }
    batch = dataAdapter() === "supabase"
      ? await loadServerResultBatch(resultBatchRef)
      : await academicsService.getBatch(resultBatchRef);
    versions = dataAdapter() === "supabase"
      ? await loadServerResultVersions(resultBatchRef)
      : await academicsService.listVersions(resultBatchRef);
  } catch {
    return (
      <div className={styles.page}>
        <p className={styles.backLink}><Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/results")}>← Results</Link></p>
        <ErrorPanel
          title="This result batch could not be loaded."
          note="No mark or publication was changed. Try again."
        >
          <RetryButton />
        </ErrorPanel>
      </div>
    );
  }

  if (batch === null) {
    return <div className={styles.page}><Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/results")}>← Results</Link><h1 className="workspace-title">Batch not found</h1><p className="workspace-intro">No result entry sheet carries the reference <span className="num">{resultBatchRef}</span>.</p></div>;
  }
  if (batch === undefined) return <p className={styles.loading}>Result entry sheet unavailable.</p>;
  const status = ENTRY_BATCH_STATUS_META[batch.status];
  /* The detail read carries the full matrix; fall back to the queue counts
     only if a detail projection ever arrives without it. */
  const entered = batch.rows.length > 0 ? batch.rows.filter((row) => row.obtained !== null).length : (batch.enteredCount ?? 0);
  const total = batch.rows.length > 0 ? batch.rows.length : (batch.totalCount ?? 0);
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className={styles.backLink}><Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/results")}>← Results</Link></p>
        <p className="eyebrow">Staff · Results</p>
        <h1 className="workspace-title">{batch.exam} · {batch.className}</h1>
        <p className={`workspace-intro ${styles.meta}`}><span className="num">{batch.ref}</span> · {entered}/{total} marks entered · v{batch.version}</p>
        <div className={styles.badgeRow}>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {canEnterEntry ? (
            <Button variant="quiet" href={canonicalStaffUrl(profileCode, `/results/${batch.ref}/entry`)}>
              {batch.status === "draft" || batch.status === "returned" ? "Open entry workspace →" : "View marks sheet →"}
            </Button>
          ) : null}
        </div>
      </header>
      <section aria-labelledby="version-history-heading">
        <p className="section-label" id="version-history-heading">Version history</p>
        <VersionHistory versions={versions} />
      </section>
      <ResultReleasePanel batchRef={batch.ref} batchStatus={batch.status} />
      <div className={styles.ruleNote}><p>Published results are versioned; corrections never silently rewrite history.</p>{dataAdapter() !== "supabase" ? <p>{ACADEMICS_DEMO_NOTE}</p> : null}</div>
    </div>
  );
}
