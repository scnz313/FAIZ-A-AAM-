import type { Metadata } from "next";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StatusTone } from "@/components/ui/StatusBadge";
import { FINANCE_DEMO_NOTE, formatINR } from "@/modules/finance/demo";
import type { PaymentMethod } from "@/modules/finance/demo";
import { financeService } from "@/modules/services/finance";
import { ReconciliationRun } from "./ReconciliationRun";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Reconciliation · Staff",
};

type ReconRow = {
  payRef: string;
  method: PaymentMethod;
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
    matchLabel: "Refunded — appended",
    matchTone: "good",
  },
];

export default async function ReconciliationPage() {
  // Matched rows come from the service ledger so the comparison always
  // reflects posted state; a demo event whose ref has since posted is dropped.
  const views = await financeService.listAllInvoices();
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
  const reconRows: ReconRow[] = [
    ...matchedRows,
    ...demoGatewayEvents.filter((row) => !ledgerRefs.has(row.payRef)),
  ];
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
          <span className="demo-badge">Demo data</span>
        </div>
        <div className="table--scroll">
          <table className={`table ${styles.reconTable}`}>
            <thead>
              <tr>
                <th scope="col">Payment ref</th>
                <th scope="col">Method</th>
                <th scope="col">Amount</th>
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
        </div>
      </section>

      <ReconciliationRun />

      <div className={styles.ruleNote}>
        <p>Reconciliation never mutates posted entries; discrepancies are flagged for the finance officer.</p>
        <p>{FINANCE_DEMO_NOTE}</p>
      </div>
    </div>
  );
}
