"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
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
 * Demo reconciliation run. Reads the comparison table and reports a
 * result line; nothing is written — the ledger is untouched by design.
 */
export function ReconciliationRun({ matchedCount, discrepancyCount, pendingCount, mode = "demo" }: ReconciliationRunProps) {
  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function run() {
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
    window.setTimeout(() => setState("done"), 900);
  }

  const summary = `Run complete: ${matchedCount} matched, ${discrepancyCount} discrepancy, ${pendingCount} pending (demo)`;

  return (
    <div className={styles.runBar}>
      <Button variant="primary" disabled={state === "running"} onClick={() => void run()}>
        Run reconciliation
      </Button>
      <p className={styles.runResult} aria-live="polite">
        {error ?? (state === "running"
          ? "Comparing gateway events against posted ledger entries…"
          : state === "done"
            ? mode === "supabase" ? "Reconciliation run started; import evidence to compare the authoritative ledger." : summary
            : "")}
      </p>
    </div>
  );
}

export default ReconciliationRun;
