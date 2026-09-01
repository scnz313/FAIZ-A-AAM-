"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { formatINR } from "@/modules/services/finance";
import { financeService, type ReconciliationRun } from "@/modules/services/finance";

import styles from "./page.module.css";

type RunState = "idle" | "running" | "done";

type ReconciliationRunProps = {
  matchedCount: number;
  discrepancyCount: number;
  pendingCount: number;
  initialRuns?: ReadonlyArray<ReconciliationRun>;
  mode?: "demo" | "supabase";
};

/**
 * Reconciliation run (plan L1.2). Both adapters expose the same run/exception
 * projection. Resolution uses the exception's current version, replaces local
 * state with the refreshed authoritative run, and revalidates the server page
 * so the comparison table and queue counts change together.
 */
export function ReconciliationRun({
  matchedCount,
  discrepancyCount,
  pendingCount,
  initialRuns = [],
  mode = "demo",
}: ReconciliationRunProps) {
  const router = useRouter();
  const { summary } = useStaffContext();
  const canOperate = canAnyRole(summary?.roles ?? [], "finance.operate");
  const actor = summary?.displayName ?? "Finance office";
  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ReconciliationRun | null>(() => initialRuns[0] ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveReason, setResolveReason] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "supabase") setRun(initialRuns[0] ?? null);
  }, [initialRuns, mode]);

  async function startRun() {
    setError(null);
    setState("running");
    try {
      const recorded = await financeService.startReconciliation({ by: actor });
      setRun(recorded);
      setState("done");
      if (mode === "supabase") router.refresh();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Reconciliation could not be run.");
      setState("idle");
    }
  }

  async function resolve(exceptionId: string) {
    if (!run) return;
    const reason = resolveReason.trim();
    if (reason.length < 3) return;
    setResolvingId(exceptionId);
    setResolveError(null);
    try {
      const updated = await financeService.resolveReconciliationException({
        runRef: run.ref,
        exceptionId,
        reason,
        by: actor,
      });
      setRun(updated);
      setEditingId(null);
      setResolveReason("");
      if (mode === "supabase") router.refresh();
    } catch (resolveFailure) {
      setResolveError(resolveFailure instanceof Error ? resolveFailure.message : "The exception could not be resolved.");
    } finally {
      setResolvingId(null);
    }
  }

  const summaryLine = run === null
    ? `Run complete: ${matchedCount} matched, ${discrepancyCount} discrepancy, ${pendingCount} pending${mode === "demo" ? " (demo)" : ""}`
    : `Run ${run.ref}: ${run.matchedCount} matched, ${run.discrepancyCount} discrepancy, ${run.pendingCount} pending`;

  return (
    <div className={styles.runBar}>
      <Button variant="primary" disabled={state === "running" || !canOperate} onClick={() => void startRun()}>
        Run reconciliation
      </Button>
      <p className={styles.runResult} aria-live="polite">
        {error ?? (state === "running"
          ? "Comparing gateway events against posted ledger entries…"
          : state === "done"
            ? summaryLine
            : "")}
      </p>

      {run !== null && run.exceptions.length > 0 ? (
        <div className={styles.exceptions}>
          <h3 className="section-label">Reconciliation exceptions</h3>
          {run.exceptions.map((exception) => (
            <div key={exception.id} className={styles.exceptionRow}>
              <div className={styles.exceptionCopy}>
                <p>
                  <strong>{exception.payRef}</strong> · {exception.kind} · {formatINR(exception.amountPaise)}
                </p>
                <small>{exception.note}</small>
                {exception.resolutionReason ? <small>Resolution: {exception.resolutionReason}</small> : null}
              </div>
              <StatusBadge tone={exception.status === "open" ? "alert" : "good"}>{exception.status}</StatusBadge>
              {exception.status === "open" && canOperate ? (
                <div className={styles.resolveBox}>
                  <input
                    className="input"
                    type="text"
                    placeholder="Resolution reason"
                    value={editingId === exception.id ? resolveReason : ""}
                    onFocus={() => {
                      if (editingId !== exception.id) {
                        setEditingId(exception.id);
                        setResolveReason("");
                      }
                    }}
                    onChange={(event) => {
                      setEditingId(exception.id);
                      setResolveReason(event.target.value);
                      setResolveError(null);
                    }}
                    disabled={resolvingId === exception.id}
                    aria-label={`Resolution reason for ${exception.payRef}`}
                  />
                  <Button
                    variant="quiet"
                    disabled={resolvingId === exception.id || editingId !== exception.id || resolveReason.trim().length < 3}
                    onClick={() => void resolve(exception.id)}
                  >
                    {resolvingId === exception.id ? "Resolving…" : "Resolve"}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {resolveError ? (
            <p className={styles.runResult} role="alert">
              {resolveError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ReconciliationRun;
