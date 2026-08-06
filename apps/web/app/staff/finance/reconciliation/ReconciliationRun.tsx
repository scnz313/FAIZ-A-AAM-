"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";

import styles from "./page.module.css";

type RunState = "idle" | "running" | "done";

/**
 * Demo reconciliation run. Reads the comparison table and reports a
 * result line; nothing is written — the ledger is untouched by design.
 */
export function ReconciliationRun() {
  const [state, setState] = useState<RunState>("idle");

  function run() {
    setState("running");
    window.setTimeout(() => setState("done"), 900);
  }

  return (
    <div className={styles.runBar}>
      <Button variant="primary" disabled={state === "running"} onClick={run}>
        Run reconciliation
      </Button>
      <p className={styles.runResult} aria-live="polite">
        {state === "running"
          ? "Comparing gateway events against posted ledger entries…"
          : state === "done"
            ? "Run complete: 4 matched, 1 discrepancy (demo)"
            : ""}
      </p>
    </div>
  );
}

export default ReconciliationRun;
