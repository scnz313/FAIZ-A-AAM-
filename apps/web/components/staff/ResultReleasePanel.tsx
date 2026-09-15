"use client";

import { useCallback, useEffect, useState } from "react";

import { useStaffContext } from "@/components/staff/StaffContextProvider";
import Button from "@/components/ui/Button";
import { ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { academicsService, type EntryBatchStatus, type ReportReleaseBatchSummary, type ReportReleaseCandidate } from "@/modules/services/academics";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./ResultReleasePanel.module.css";

function releaseTone(candidate: ReportReleaseCandidate): StatusTone {
  if (candidate.release === null) return "watch";
  if (candidate.release.status === "published") return "good";
  if (candidate.release.status === "withdrawn") return "alert";
  return "neutral";
}

function releaseLabel(candidate: ReportReleaseCandidate): string {
  if (candidate.release === null) return "Not released";
  if (candidate.release.status === "published") return `Released v${candidate.release.version}`;
  if (candidate.release.status === "withdrawn") return `Withdrawn v${candidate.release.version}`;
  return `Superseded v${candidate.release.version}`;
}

/**
 * Per-student report release assembly for a published result sheet. A sheet
 * publication is one subject snapshot; families read a report release, which
 * bundles every published subject for the term into one immutable manifest.
 * The server computes the manifest and supersedes prior versions; this panel
 * only names the students and confirms the action.
 */
export default function ResultReleasePanel({ batchRef, batchStatus }: { batchRef: string; batchStatus: EntryBatchStatus }) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const { summary } = useStaffContext();
  const canRelease = canAnyRole(summary?.roles ?? [], "results.publish");
  /* The candidate projection is scoped to moderation/publication roles; the
     entry officer reads the sheet itself but must not see a load error for a
     projection the server intentionally denies. */
  const canRead = canRelease || canAnyRole(summary?.roles ?? [], "results.approve");
  const [candidates, setCandidates] = useState<ReportReleaseCandidate[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [releasingAll, setReleasingAll] = useState(false);
  const [summaryLine, setSummaryLine] = useState<string | null>(null);
  const [failed, setFailed] = useState<ReportReleaseBatchSummary["failed"]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    if (!supabaseMode || !canRead) return;
    setLoadError(false);
    try {
      const result = await academicsService.listReleaseCandidates(batchRef);
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Release readiness is unavailable.");
      setCandidates(result.value);
    } catch {
      setLoadError(true);
    }
  }, [batchRef, supabaseMode, canRead]);

  useEffect(() => {
    if (batchStatus !== "published" || !canRead) return;
    void load();
  }, [batchStatus, canRead, load, reloadToken]);

  if (batchStatus !== "published" && batchStatus !== "withdrawn") {
    return (
      <section aria-labelledby="release-heading">
        <p className="section-label" id="release-heading">Report releases</p>
        <p className={styles.note}>
          Publish this batch first. Report releases are assembled from published subject snapshots.
        </p>
      </section>
    );
  }

  if (!supabaseMode) {
    return (
      <section aria-labelledby="release-heading">
        <p className="section-label" id="release-heading">Report releases</p>
        <p className={styles.note}>
          Demo mode publishes directly to the portal. In live mode the server assembles one immutable
          release per student from the published subject snapshots.
        </p>
      </section>
    );
  }

  if (!canRead) {
    return (
      <section aria-labelledby="release-heading">
        <p className="section-label" id="release-heading">Report releases</p>
        <p className={styles.note}>
          A result publisher assembles each student&apos;s report release from the published subject snapshots.
          Release readiness is limited to moderation and publication roles.
        </p>
      </section>
    );
  }

  const ready = candidates?.filter((candidate) => candidate.publicationIds.length > 0) ?? [];
  const released = candidates?.filter((candidate) => candidate.release?.status === "published") ?? [];

  async function release(studentIds?: string[]) {
    if (studentIds === undefined) setReleasingAll(true);
    else setBusyId(studentIds[0] ?? null);
    setSummaryLine(null);
    setFailed([]);
    try {
      const result = await academicsService.publishReportReleases(batchRef, studentIds === undefined ? {} : { studentIds });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The release could not be assembled.");
      const value = result.value;
      setSummaryLine(
        `Released ${value.released} report${value.released === 1 ? "" : "s"}` +
          (value.skipped > 0 ? ` · ${value.skipped} skipped (no published subjects)` : "") +
          (value.failed.length > 0 ? ` · ${value.failed.length} failed` : "") +
          ".",
      );
      setFailed(value.failed);
      setReloadToken((token) => token + 1);
    } catch (error) {
      setSummaryLine(error instanceof Error ? error.message : "The release could not be assembled.");
    } finally {
      setBusyId(null);
      setReleasingAll(false);
    }
  }

  function nameFor(studentId: string): string {
    return candidates?.find((candidate) => candidate.studentId === studentId)?.studentName ?? "Student";
  }

  return (
    <section className="panel" aria-labelledby="release-heading">
      <div className="pn-head">
        <h2 id="release-heading">Report releases</h2>
        {candidates !== null ? (
          <span className="chip">
            {ready.length} ready · {released.length} released
          </span>
        ) : null}
      </div>
      <div className="pn-body">
        <p className={styles.note}>
          A sheet publication is one subject. Families read a report release: one immutable manifest bundling every
          published subject for the term. Releasing again after a correction supersedes the previous version; the
          earlier version stays auditable.
        </p>

        {loadError ? (
          <ErrorPanel title="Release readiness could not be loaded" note="The results service did not respond. No release was changed.">
            <Button variant="quiet" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </ErrorPanel>
        ) : candidates === null ? (
          <LoadingSkeleton lines={3} label="Loading release readiness" />
        ) : candidates.length === 0 ? (
          <p className={styles.note}>No students are on this sheet&apos;s roster.</p>
        ) : (
          <div className="queue">
            <div className="q-head" aria-hidden="true">
              <span>Student</span>
              <span>Current release</span>
              <span>State</span>
              <span style={{ textAlign: "right" }}>Action</span>
            </div>
            {candidates.map((candidate) => (
              <div className="q-row" key={candidate.studentId}>
                <div>
                  <div className="q-t">{candidate.studentName}</div>
                  <div className="q-s">
                    {candidate.publicationIds.length} subject publication{candidate.publicationIds.length === 1 ? "" : "s"} for this term
                  </div>
                </div>
                <div className="q-m">
                  {candidate.release !== null ? `${candidate.release.reference} · ${candidate.release.status}` : "Not assembled yet"}
                </div>
                <div>
                  <StatusBadge tone={releaseTone(candidate)}>{releaseLabel(candidate)}</StatusBadge>
                </div>
                <div className="q-act">
                  {candidate.publicationIds.length === 0 ? (
                    <span className={styles.rowNote}>No published subjects</span>
                  ) : (
                    <Button
                      variant="quiet"
                      disabled={!canRelease || busyId !== null || releasingAll}
                      onClick={() => void release([candidate.studentId])}
                    >
                      {busyId === candidate.studentId ? "Releasing…" : candidate.release === null ? "Release" : "Release new version"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {candidates !== null && candidates.length > 0 ? (
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={!canRelease || releasingAll || busyId !== null || ready.length === 0}
              onClick={() => void release()}
            >
              {releasingAll ? "Releasing…" : `Release ready reports (${ready.length})`}
            </Button>
            {!canRelease ? (
              <p className={styles.note}>Only a result publisher can assemble report releases.</p>
            ) : ready.length === 0 ? (
              <p className={styles.note}>No student has a published subject for this term yet.</p>
            ) : null}
          </div>
        ) : null}

        {summaryLine !== null ? (
          <p className={styles.summary} role="status" aria-live="polite">
            {summaryLine}
          </p>
        ) : null}
        {failed.length > 0 ? (
          <ul className={styles.failed}>
            {failed.map((entry) => (
              <li key={entry.studentId}>
                <strong>{nameFor(entry.studentId)}</strong>: {entry.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
