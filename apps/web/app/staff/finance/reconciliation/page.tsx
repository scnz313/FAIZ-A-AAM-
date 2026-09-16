import type { Metadata } from "next";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StatusTone } from "@/components/ui/StatusBadge";
import { FINANCE_DEMO_NOTE, formatINR } from "@/modules/services/finance";
import { financeService } from "@/modules/services/finance";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerInvoices, loadServerReconciliationProjection } from "@/lib/supabase/server-loaders";
import { mapServerReconciliationRun } from "@/modules/services/finance-server-map";
import { ReconciliationRun } from "./ReconciliationRun";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Reconciliation",
};

type ReconRow = {
  payRef: string;
  /** Display-only method label; authoritative evidence carries no method, rendered as Unknown. */
  method: string;
  amountPaise: number;
  gateway: string;
  ledger: string;
  /** Muted note under the ledger state, e.g. what the discrepancy is. */
  ledgerNote?: string;
  matchLabel: string;
  matchTone: StatusTone;
};

/** Fictional gateway events kept for the demo comparison (never in the ledger). */
const demoGatewayEvents: ReconRow[] = [
  {
    payRef: "PAY-2026-0301",
    method: "UPI",
    amountPaise: 500000,
    gateway: "Pending",
    ledger: "Missing",
    matchLabel: "Pending",
    matchTone: "watch",
  },
  {
    payRef: "PAY-2026-0303",
    method: "Card",
    amountPaise: 200000,
    gateway: "Captured",
    ledger: "Missing",
    ledgerNote: "Gateway captured but not posted",
    matchLabel: "Discrepancy",
    matchTone: "alert",
  },
  {
    payRef: "PAY-2026-0292",
    method: "Net banking",
    amountPaise: 120000,
    gateway: "Refunded",
    ledger: "Refund entry appended",
    matchLabel: "Refunded · appended",
    matchTone: "good",
  },
];

export default async function ReconciliationPage() {
  const supabaseMode = dataAdapter() === "supabase";
  // Matched rows come from the service ledger so the comparison always
  // reflects posted state; a demo event whose ref has since posted is dropped.
  const views = supabaseMode ? await loadServerInvoices() : await financeService.listAllInvoices();
  const projection = supabaseMode ? await loadServerReconciliationProjection() : [];
  const ledgerRefs = new Set<string>();
  const matchedRows: ReconRow[] = [];
  for (const view of views) {
    for (const payment of view.invoice.payments) {
      ledgerRefs.add(payment.ref);
      matchedRows.push({
        payRef: payment.ref,
        method: payment.method,
        amountPaise: payment.amountPaise,
        gateway: "Captured",
        ledger: "Posted",
        matchLabel: "Matched",
        matchTone: "good",
      });
    }
  }
  const authoritativeRows: ReconRow[] = [];
  const seenEvidence = new Set<string>();
  for (const run of projection) {
    for (const evidence of run.reconciliation_evidence) {
      const payRef = evidence.provider_txn_id ?? evidence.reference;
      if (seenEvidence.has(payRef)) continue;
      seenEvidence.add(payRef);
      const matched = evidence.provider_txn_id !== null && ledgerRefs.has(evidence.provider_txn_id);
      const exception = run.reconciliation_exceptions.find((candidate) => candidate.evidence_id === evidence.id);
      const resolved = exception?.status === "resolved";
      authoritativeRows.push({
        payRef,
        /* The reconciliation evidence carries no payment-method field: render
           Unknown rather than fabricating one. */
        method: "Unknown",
        amountPaise: evidence.amount_paise,
        gateway: evidence.state,
        ledger: matched ? "Posted" : resolved ? "Exception resolved" : "Exception",
        ledgerNote: matched ? undefined : exception?.resolution_reason ?? exception?.kind,
        matchLabel: matched ? "Matched" : resolved ? "Resolved" : "Discrepancy",
        matchTone: matched || resolved ? "good" : "alert",
      });
    }
  }
  const reconRows: ReconRow[] = supabaseMode
    ? authoritativeRows
    : [...matchedRows, ...demoGatewayEvents.filter((row) => !ledgerRefs.has(row.payRef))];
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Reconciliation</p>
        <h1 className="workspace-title">Reconciliation</h1>
        <p className="workspace-intro">Gateway vs ledger comparison.</p>
      </header>

      <section aria-labelledby="recon-compare-heading">
        <div className={styles.sectionHead}>
          <h2 id="recon-compare-heading" className="section-label">
            Comparison
          </h2>
          <span className="demo-badge">{supabaseMode ? "Live projection" : "Demo data"}</span>
        </div>
        <div className="table--scroll" role="region" aria-label="Gateway and ledger comparison table" tabIndex={0}>
          {reconRows.length === 0 ? (
            <p className={styles.ruleNote}>No reconciliation rows · the ledger and gateway are in sync.</p>
          ) : (
          <table className={`table ${styles.reconTable}`}>
            <thead>
              <tr>
                <th scope="col">Payment ref</th>
                <th scope="col">Method</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Gateway state</th>
                <th scope="col">Ledger state</th>
                <th scope="col">Match status</th>
              </tr>
            </thead>
            <tbody>
              {reconRows.map((row) => (
                <tr key={row.payRef}>
                  <td>
                    <span className="num">{row.payRef}</span>
                  </td>
                  <td>{row.method}</td>
                  <td className="num">{formatINR(row.amountPaise)}</td>
                  <td>{row.gateway}</td>
                  <td>
                    {row.ledger}
                    {row.ledgerNote && <small className={styles.cellNote}>{row.ledgerNote}</small>}
                  </td>
                  <td>
                    <StatusBadge tone={row.matchTone}>{row.matchLabel}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </section>

      <ReconciliationRun
        mode={supabaseMode ? "supabase" : "demo"}
        initialRuns={projection.map(mapServerReconciliationRun)}
        matchedCount={reconRows.filter((r) => r.matchLabel === "Matched").length}
        discrepancyCount={reconRows.filter((r) => r.matchLabel === "Discrepancy").length}
        pendingCount={reconRows.filter((r) => r.matchLabel === "Pending" || r.matchLabel === "Refunded · appended").length}
      />

      <div className={styles.ruleNote}>
        <p>Reconciliation never mutates posted entries; discrepancies are flagged for the finance officer.</p>
        {!supabaseMode ? <p>{FINANCE_DEMO_NOTE}</p> : <p>Reconciliation evidence and exceptions are loaded from the authoritative local sandbox projection.</p>}
      </div>
    </div>
  );
}
