"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canRole } from "@/modules/services/staff-authorization";
import { formatINR } from "@/modules/services/finance";
import { financeService, type ReconciliationRun } from "@/modules/services/finance";
import { adapterCall } from "@/modules/services/adapter-client";

import styles from "./page.module.css";

type RunState = "idle" | "running" | "done";

type ReconciliationRunProps = {
  matchedCount: number;
  discrepancyCount: number;
  pendingCount: number;
  mode?: "demo" | "supabase";
};

/**
 * Reconciliation run (plan L1.2). In demo mode the run is recorded through
 * the finance service (append-only, with open exceptions the officer can
 * resolve); Supabase mode starts the school reconciliation command. The
 * ledger is never mutated by a run.
 */
export function ReconciliationRun({ matchedCount, discrepancyCount, pendingCount, mode = "demo" }: ReconciliationRunProps) {
  const { summary } = useStaffContext();
  const canOperate = canRole(summary?.role ?? "", "finance.operate");
  const actor = summary?.displayName ?? "Finance office";
  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ReconciliationRun | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveReason, setResolveReason] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);

  async function startRun() {
    setError(null);
    setState("running");
    if (mode === "supabase") {
      const result = await adapterCall<{ reference: string }>("finance.startReconciliation", { idempotencyKey: `reconciliation:${crypto.randomUUID()}` });
      if (!result.ok) {
        setError(result.errors[0]?.message ?? "Reconciliation could not be started.");
        setState("idle");
        return;
      }
      setState("done");
      return;
    }
    try {
      const recorded = await financeService.startReconciliation({ by: actor });
      setRun(recorded);
      setState("done");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Reconciliation could not be run.");
      setState("idle");
    }
  }

  async function resolve(exceptionId: string) {
    if (!run) return;
    setResolvingId(exceptionId);
    setResolveError(null);
    try {
      const updated = await financeService.resolveReconciliationException({
        runRef: run.ref,
        exceptionId,
        reason: resolveReason,
        by: actor,
      });
      setRun(updated);
      setResolveReason("");
    } catch (resolveFailure) {
      setResolveError(resolveFailure instanceof Error ? resolveFailure.message : "The exception could not be resolved.");
    } finally {
      setResolvingId(null);
    }
  }

  const summaryLine = run === null
    ? `Run complete: ${matchedCount} matched, ${discrepancyCount} discrepancy, ${pendingCount} pending (demo)`
    : `Run ${run.ref}: ${run.matchedCount} matched, ${run.discrepancyCount} discrepancy, ${run.pendingCount} pending`;

  return (
    <div className={styles.runBar}>
      <Button variant="primary" disabled={state === "running"} onClick={() => void startRun()}>
        Run reconciliation
      </Button>
      <p className={styles.runResult} aria-live="polite">
        {error ?? (state === "running"
          ? "Comparing gateway events against posted ledger entries…"
          : state === "done"
            ? mode === "supabase"
              ? "Reconciliation run started; import evidence to compare the authoritative ledger."
              : summaryLine
            : "")}
      </p>

      {run !== null && run.exceptions.length > 0 ? (
        <div className={styles.exceptions}>
          <h3 className="section-label">Open exceptions</h3>
          {run.exceptions.map((exception) => (
            <div key={exception.id} className={styles.exceptionRow}>
              <div className={styles.exceptionCopy}>
                <p>
                  <strong>{exception.payRef}</strong> · {exception.kind} · {formatINR(exception.amountPaise)}
                </p>
                <small>{exception.note}</small>
              </div>
              <StatusBadge tone={exception.status === "open" ? "alert" : "good"}>{exception.status}</StatusBadge>
              {exception.status === "open" && canOperate ? (
                resolvingId === exception.id ? (
                  <span className={styles.resolving}>Resolving…</span>
                ) : (
                  <div className={styles.resolveBox}>
                    <input
                      className="input"
                      type="text"
                      placeholder="Resolution reason"
                      value={resolvingId === exception.id ? resolveReason : ""}
                      onChange={(event) => {
                        setResolvingId(exception.id);
                        setResolveReason(event.target.value);
                        setResolveError(null);
                      }}
                      aria-label={`Resolution reason for ${exception.payRef}`}
                    />
                    <Button variant="quiet" disabled={resolveReason.trim().length < 3} onClick={() => void resolve(exception.id)}>
                      Resolve
                    </Button>
                  </div>
                )
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
