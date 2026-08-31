"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { assignmentsCoverBatch, teacherAssignmentScope } from "@/components/staff/MarksEntry";
import type { AssignmentScope } from "@/components/staff/MarksEntry";
import { formatKolkata } from "@/modules/iot/domain";
import { canRole } from "@/modules/services/staff-authorization";
import { academicsService, ENTRY_BATCH_STATUS_META } from "@/modules/services/academics";
import type { EntryBatch, EntryBatchStatus } from "@/modules/services/academics";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./ResultsBatches.module.css";

const DEFAULT_ACTOR = "M. Wani (exam office)";

const STATUS_FILTERS: ReadonlyArray<{ key: "all" | EntryBatchStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "moderation", label: "Moderation" },
  { key: "returned", label: "Returned" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
  { key: "withdrawn", label: "Withdrawn" },
];

/**
 * Result batch queue: Entry → Moderation → Approved → Published, driven by
 * the academics service. "Open entry" navigates to the working marks-entry
 * workspace; Approve/Publish/Correct call the adapter and refresh the queue
 * from it, so the visible status always matches the session state.
 */
export function ResultsBatches({ batches: initial }: { batches?: EntryBatch[] | null }) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const [batches, setBatches] = useState<EntryBatch[] | null>(initial ?? null);
  const [filter, setFilter] = useState<"all" | EntryBatchStatus>("all");
  const [live, setLive] = useState("");
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [correctingRef, setCorrectingRef] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [withdrawingRef, setWithdrawingRef] = useState<string | null>(null);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [returningRef, setReturningRef] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  /* Teacher entry scope (class + subject); null while resolving. Non-teacher
     roles ignore it. */
  const [assignmentScope, setAssignmentScope] = useState<AssignmentScope[] | null>(null);
  const { summary } = useStaffContext();
  const canEnter = canRole(summary?.role ?? "", "results.enter");
  /* Maker/checker split: moderation/approval belongs to exam reviewers
     (results.approve), publication and correction to result publishers
     (results.publish). Return-with-reason is part of moderation so a
     reviewer can send a sheet back without entering the teacher workspace. */
  const canApprove = canRole(summary?.role ?? "", "results.approve");
  const canPublish = canRole(summary?.role ?? "", "results.publish");

  useEffect(() => {
    if (summary === null || summary.role !== "teacher") {
      setAssignmentScope([]);
      return;
    }
    let cancelled = false;
    void teacherAssignmentScope(summary.accountId)
      .then((scope) => {
        if (!cancelled) setAssignmentScope(scope);
      })
      .catch(() => {
        if (!cancelled) setAssignmentScope([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- summary is intentionally sampled once per identity/workspace change
  }, [summary?.accountId, summary?.role]);

  useEffect(() => {
    if (supabaseMode && initial !== undefined) {
      setBatches(initial);
      return;
    }
    let cancelled = false;
    void academicsService
      .listBatches()
      .then((items) => {
        if (!cancelled) setBatches(items);
      })
      .catch(() => {
        if (!cancelled) setBatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initial, supabaseMode]);

  async function refresh() {
    setBatches(await academicsService.listBatches());
  }

  function reportErrors(errors: ReadonlyArray<{ message: string }>) {
    setLive(errors.map((error) => error.message).join(" "));
  }

  async function approve(ref: string) {
    setBusyRef(ref);
    const result = await academicsService.approve(ref);
    setBusyRef(null);
    if (!result.ok) return reportErrors(result.errors);
    setLive(`${ref} approved${supabaseMode ? "" : " (demo)"}`);
    await refresh();
  }

  async function publish(ref: string) {
    setBusyRef(ref);
    const result = await academicsService.publish(ref, DEFAULT_ACTOR);
    setBusyRef(null);
    if (!result.ok) return reportErrors(result.errors);
    setLive(`Published as ${result.value.ref}${supabaseMode ? "" : " (demo)"} — the portal report is live`);
    await refresh();
  }

  async function startCorrection(ref: string) {
    if (correctionReason.trim() === "") {
      setLive("Enter a reason for the correction.");
      return;
    }
    setBusyRef(ref);
    const result = await academicsService.startCorrection(ref, correctionReason.trim(), DEFAULT_ACTOR);
    setBusyRef(null);
    setCorrectingRef(null);
    setCorrectionReason("");
    if (!result.ok) return reportErrors(result.errors);
    setLive(`${ref} correction v${result.value.version} started${supabaseMode ? "" : " (demo)"}`);
    await refresh();
  }

  async function withdraw(ref: string) {
    if (withdrawalReason.trim() === "") {
      setLive("Enter a reason for the withdrawal.");
      return;
    }
    setBusyRef(ref);
    const result = await academicsService.withdrawPublication(ref, withdrawalReason.trim(), DEFAULT_ACTOR);
    setBusyRef(null);
    setWithdrawingRef(null);
    setWithdrawalReason("");
    if (!result.ok) return reportErrors(result.errors);
    setLive(`${ref} withdrawn — the live portal publication was removed${supabaseMode ? "" : " (demo)"}`);
    await refresh();
  }

  async function returnForCorrection(ref: string) {
    if (returnReason.trim() === "") {
      setLive("Enter a reason for the return.");
      return;
    }
    setBusyRef(ref);
    const result = await academicsService.returnWithReason(ref, returnReason.trim());
    setBusyRef(null);
    setReturningRef(null);
    setReturnReason("");
    if (!result.ok) return reportErrors(result.errors);
    setLive(`${ref} returned to entry with a reason${supabaseMode ? "" : " (demo)"}`);
    await refresh();
  }

  const visible = batches === null ? null : filter === "all" ? batches : batches.filter((b) => b.status === filter);

  return (
    <section aria-labelledby="batch-queue-heading">
      <div className={styles.sectionHead}>
        <h2 id="batch-queue-heading" className="section-label">
          Batch queue
        </h2>
        {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
      </div>

      {batches !== null && (
        <div className="tabs" role="group" aria-label="Filter batches by status">
          {STATUS_FILTERS.map((tab) => {
            const count = tab.key === "all" ? batches.length : batches.filter((b) => b.status === tab.key).length;
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={filter === tab.key}
                className={filter === tab.key ? "active" : undefined}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label}
                <span className={`num ${styles.tabCount}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="table--scroll">
        {visible === null ? (
          <p className={styles.live}>Loading batch queue…</p>
        ) : visible.length === 0 ? (
          <p className={styles.live}>No batches in this view.</p>
        ) : (
          <table className={`table ${styles.batchTable}`}>
            <thead>
              <tr>
                <th scope="col">Batch ref</th>
                <th scope="col">Exam</th>
                <th scope="col">Class</th>
                <th scope="col">Subject</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Marks entered</th>
                <th scope="col" className="num">Published at</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((batch) => (
                <BatchRow
                  key={batch.ref}
                  batch={batch}
                  busy={busyRef === batch.ref}
                  correcting={correctingRef === batch.ref}
                  correctionReason={correctionReason}
                  canEnter={canEnter}
                  canApprove={canApprove}
                  canPublish={canPublish}
                  entryVisible={
                    summary?.role === "teacher"
                      ? assignmentScope !== null && assignmentsCoverBatch(assignmentScope, batch.className, batch.subject)
                      : true
                  }
                  onCorrectionReasonChange={setCorrectionReason}
                  onApprove={approve}
                  onPublish={publish}
                  onStartCorrection={startCorrection}
                  onOpenCorrection={(ref) => {
                    setCorrectingRef(ref);
                    setCorrectionReason("");
                  }}
                  onCancelCorrection={() => {
                    setCorrectingRef(null);
                    setCorrectionReason("");
                  }}
                  withdrawing={withdrawingRef === batch.ref}
                  withdrawalReason={withdrawalReason}
                  onWithdrawalReasonChange={setWithdrawalReason}
                  onWithdraw={withdraw}
                  onOpenWithdraw={(ref) => {
                    setWithdrawingRef(ref);
                    setWithdrawalReason("");
                  }}
                  onCancelWithdraw={() => {
                    setWithdrawingRef(null);
                    setWithdrawalReason("");
                  }}
                  returning={returningRef === batch.ref}
                  returnReason={returnReason}
                  onReturnReasonChange={setReturnReason}
                  onReturn={returnForCorrection}
                  onOpenReturn={(ref) => {
                    setReturningRef(ref);
                    setReturnReason("");
                  }}
                  onCancelReturn={() => {
                    setReturningRef(null);
                    setReturnReason("");
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className={styles.live} aria-live="polite">
        {live}
      </p>
    </section>
  );
}

function BatchRow({
  batch,
  busy,
  correcting,
  correctionReason,
  canEnter,
  canApprove,
  canPublish,
  entryVisible,
  onCorrectionReasonChange,
  onApprove,
  onPublish,
  onStartCorrection,
  onOpenCorrection,
  onCancelCorrection,
  withdrawing,
  withdrawalReason,
  onWithdrawalReasonChange,
  onWithdraw,
  onOpenWithdraw,
  onCancelWithdraw,
  returning,
  returnReason,
  onReturnReasonChange,
  onReturn,
  onOpenReturn,
  onCancelReturn,
}: {
  batch: EntryBatch;
  busy: boolean;
  correcting: boolean;
  correctionReason: string;
  canEnter: boolean;
  canApprove: boolean;
  canPublish: boolean;
  /** Teacher rows: false hides "Open entry" for batches outside class+subject scope. */
  entryVisible: boolean;
  onCorrectionReasonChange: (reason: string) => void;
  onApprove: (ref: string) => void;
  onPublish: (ref: string) => void;
  onStartCorrection: (ref: string) => void;
  onOpenCorrection: (ref: string) => void;
  onCancelCorrection: () => void;
  withdrawing: boolean;
  withdrawalReason: string;
  onWithdrawalReasonChange: (reason: string) => void;
  onWithdraw: (ref: string) => void;
  onOpenWithdraw: (ref: string) => void;
  onCancelWithdraw: () => void;
  returning: boolean;
  returnReason: string;
  onReturnReasonChange: (reason: string) => void;
  onReturn: (ref: string) => void;
  onOpenReturn: (ref: string) => void;
  onCancelReturn: () => void;
}) {
  const meta = ENTRY_BATCH_STATUS_META[batch.status];
  const entered = batch.rows.filter((row) => row.obtained !== null).length;
  const nextVersion = batch.version + 1;

  return (
    <>
      <tr>
        <td>
          <Link prefetch={false} className={styles.rowLink} href={`/staff/results/${batch.ref}`}>
            <strong className="num">{batch.ref}</strong>
          </Link>
        </td>
        <td>{batch.exam}</td>
        <td>{batch.className}</td>
        <td>{batch.subject}</td>
        <td>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </td>
        <td className="num">
          {entered}/{batch.rows.length}
        </td>
        <td className="num">{batch.publishedAtIso ? formatKolkata(batch.publishedAtIso, { format: "day" }) : "—"}</td>
        <td>
          <div className={styles.actions}>
            {canEnter && entryVisible ? (
              <Button variant="quiet" href={`/staff/results/${batch.ref}/entry`}>
                Open entry
              </Button>
            ) : null}
            {canApprove && (batch.status === "submitted" || batch.status === "moderation") && (
              <Button variant="primary" onClick={() => onApprove(batch.ref)} disabled={busy}>
                Approve
              </Button>
            )}
            {canApprove && (batch.status === "submitted" || batch.status === "moderation") && (
              <Button
                variant="quiet"
                onClick={() => (returning ? onCancelReturn() : onOpenReturn(batch.ref))}
                disabled={busy}
              >
                Return
              </Button>
            )}
            {canPublish && batch.status === "approved" && (
              <Button variant="saffron" onClick={() => onPublish(batch.ref)} disabled={busy}>
                Publish
              </Button>
            )}
            {canPublish && batch.status === "published" && (
              <Button
                variant="quiet"
                onClick={() => (correcting ? onCancelCorrection() : onOpenCorrection(batch.ref))}
                disabled={busy}
              >
                Correct
              </Button>
            )}
            {canPublish && batch.status === "published" && (
              <Button
                variant="quiet"
                onClick={() => (withdrawing ? onCancelWithdraw() : onOpenWithdraw(batch.ref))}
                disabled={busy}
              >
                Withdraw
              </Button>
            )}
          </div>
        </td>
      </tr>
      {batch.note && !correcting && !withdrawing && !returning && (
        <tr className={styles.noteRow}>
          <td colSpan={8} className={styles.noteCell}>
            {batch.note}
          </td>
        </tr>
      )}
      {correcting && (
        <tr className={styles.noteRow}>
          <td colSpan={8}>
            <div className="panel">
              <label className="sr-only" htmlFor={`correction-reason-${batch.ref}`}>
                Reason for correction v{nextVersion} (required)
              </label>
              <input
                id={`correction-reason-${batch.ref}`}
                className="input"
                type="text"
                value={correctionReason}
                onChange={(event) => onCorrectionReasonChange(event.target.value)}
                placeholder={`Reason for correction v${nextVersion} (required) — shown on the report`}
                aria-required="true"
              />
              <div className={styles.actions}>
                <Button variant="primary" onClick={() => onStartCorrection(batch.ref)} disabled={busy}>
                  Start correction v{nextVersion}
                </Button>
                <Button variant="quiet" onClick={onCancelCorrection} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
      {withdrawing && (
        <tr className={styles.noteRow}>
          <td colSpan={8}>
            <div className="panel">
              <label className="sr-only" htmlFor={`withdraw-reason-${batch.ref}`}>
                Reason for withdrawing v{batch.version} (required)
              </label>
              <input
                id={`withdraw-reason-${batch.ref}`}
                className="input"
                type="text"
                value={withdrawalReason}
                onChange={(event) => onWithdrawalReasonChange(event.target.value)}
                placeholder={`Reason for withdrawing v${batch.version} (required) — the live report is removed`}
                aria-required="true"
              />
              <div className={styles.actions}>
                <Button variant="danger" onClick={() => onWithdraw(batch.ref)} disabled={busy}>
                  Withdraw publication
                </Button>
                <Button variant="quiet" onClick={onCancelWithdraw} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
      {returning && (
        <tr className={styles.noteRow}>
          <td colSpan={8}>
            <div className="panel">
              <label className="sr-only" htmlFor={`return-reason-${batch.ref}`}>
                Reason for returning {batch.ref} (required)
              </label>
              <input
                id={`return-reason-${batch.ref}`}
                className="input"
                type="text"
                value={returnReason}
                onChange={(event) => onReturnReasonChange(event.target.value)}
                placeholder="Why is the sheet back with the teacher? This reason is recorded on the batch."
                aria-required="true"
              />
              <div className={styles.actions}>
                <Button variant="primary" onClick={() => onReturn(batch.ref)} disabled={busy}>
                  Confirm return
                </Button>
                <Button variant="quiet" onClick={onCancelReturn} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
