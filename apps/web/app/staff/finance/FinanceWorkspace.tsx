"use client";

import { useEffect, useState } from "react";

import { FeeLedgerTable } from "@/components/staff/FeeLedgerTable";
import { FinanceActions } from "@/components/staff/FinanceActions";
import { formatINR } from "@/modules/services/finance";
import { formatKolkata } from "@/modules/iot/domain";
import { financeService, type InvoiceView, type Receipt } from "@/modules/services/finance";
import type { FinanceReconciliationProjectionRow } from "@/lib/supabase/domain";

import styles from "./page.module.css";

/**
 * Client island for the staff finance workspace. The server renders the
 * fixture-based first paint; on mount this re-reads the SAME finance service
 * the family portal uses, so payments posted in the browser session (by the
 * shared checkout) appear here too — family and staff balances agree
 * (§6.5 / UI-COMPLETION-PLAN §5.4 invalidation contract).
 */
export function FinanceWorkspace({
  initialViews,
  initialReceipts,
  initialReconciliation,
  mode = "demo",
}: {
  initialViews: InvoiceView[];
  initialReceipts: Receipt[];
  initialReconciliation?: FinanceReconciliationProjectionRow[];
  mode?: "demo" | "supabase";
}) {
  const [views, setViews] = useState<InvoiceView[]>(initialViews);
  const [receipts, setReceipts] = useState<Receipt[]>(initialReceipts);
  const [reconciliation] = useState<FinanceReconciliationProjectionRow[]>(initialReconciliation ?? []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([financeService.listAllInvoices(), financeService.listReceipts()])
      .then(([nextViews, nextReceipts]) => {
        if (cancelled) return;
        setViews(nextViews);
        setReceipts(nextReceipts);
      })
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const collected = views.reduce((sum, view) => sum + view.paidPaise, 0);
  const outstanding = views.reduce((sum, view) => sum + Math.max(0, view.balancePaise), 0);
  const lastReceiptRef = receipts[receipts.length - 1]?.ref ?? "—";
  const studentsOnLedger = new Set(views.map((view) => view.studentId)).size;
  /* Count invoices with unpaid balances that need follow-up. */
  const unpaidCount = views.filter((view) => view.status === "unpaid" || view.status === "overdue").length;
  const recentReceipts = mode === "supabase"
    ? reconciliation.reduce((sum, run) => sum + run.reconciliation_exceptions.filter((exception) => exception.status === "open").length, 0)
    : receipts.length;

  const queue = [
    {
      label: "Invoices due soon",
      count: unpaidCount,
      href: "/staff/finance/invoices",
    },
    {
      label: "Payments to reconcile",
      count: recentReceipts,
      href: "/staff/finance/payments",
    },
  ];

  return (
    <>
      <section aria-labelledby="ledger-summary-heading">
        <div className={styles.sectionHead}>
          <h2 id="ledger-summary-heading" className="section-label">
            Ledger summary
          </h2>
          <span className="demo-badge">{mode === "supabase" ? "Live projection" : "Demo data"}</span>
        </div>
        <div className="metric-grid">
          <div className="metric-cell">
            <p className="section-label">Collected this term</p>
            <p className={`num ${styles.metricValue}`}>{formatINR(collected)}</p>
            <p className={styles.metricSub}>
              Across {views.length} term invoice{views.length === 1 ? "" : "s"} · {studentsOnLedger} student
              {studentsOnLedger === 1 ? "" : "s"}
            </p>
          </div>
          <div className="metric-cell">
            <p className="section-label">Outstanding</p>
            <p className={`num ${styles.metricValue}`}>{formatINR(outstanding)}</p>
            <p className={styles.metricSub}>Net of concessions and payments</p>
          </div>
          <div className="metric-cell">
            <p className="section-label">Receipts issued</p>
            <p className={`num ${styles.metricValue}`}>{receipts.length}</p>
            <p className={styles.metricSub}>Last {lastReceiptRef}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="finance-queue-heading">
        <div className={styles.sectionHead}>
          <h2 id="finance-queue-heading" className="section-label">
            Queue
          </h2>
          <span className="demo-badge">{mode === "supabase" ? "Live projection" : "Demo data"}</span>
        </div>
        <ul className={styles.queue}>
          {queue.map((item) => (
            <li key={item.href}>
              <a className={styles.queueRow} href={item.href}>
                <p className={styles.queueCopy}>
                  {item.label} <strong className="num">{item.count}</strong>
                </p>
                <span className="link-arrow">Open →</span>
              </a>
            </li>
          ))}
          <li>
            <a className={styles.queueRow} href="/staff/finance/reconciliation">
              <p className={styles.queueCopy}>
                Reconciliation run — {reconciliation[0]?.run_at ? <strong className="num">last {formatKolkata(reconciliation[0].run_at, { format: "day" })}</strong> : <strong>not run</strong>}
              </p>
              <span className="link-arrow">Open →</span>
            </a>
          </li>
        </ul>
      </section>

      <FeeLedgerTable views={views} />

      <FinanceActions views={views} />
    </>
  );
}
