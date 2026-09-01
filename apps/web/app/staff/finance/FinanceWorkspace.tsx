"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { FeeLedgerTable } from "@/components/staff/FeeLedgerTable";
import { FinanceActions } from "@/components/staff/FinanceActions";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { formatINR } from "@/modules/services/finance";
import { formatKolkata } from "@/modules/iot/domain";
import { financeService, type InvoiceView, type Receipt } from "@/modules/services/finance";
import type { FinanceReconciliationProjectionRow } from "@/lib/supabase/domain";

import styles from "./page.module.css";

/**
 * Client island for the staff finance workspace. The server renders the
 * initial first paint; demo mode re-reads the SAME finance service on mount
 * so browser-session payments appear here too. Supabase mode keeps the
 * authoritative server projection until a mutation explicitly refreshes it
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
  const { summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const [views, setViews] = useState<InvoiceView[]>(initialViews);
  const [receipts, setReceipts] = useState<Receipt[]>(initialReceipts);
  const [reconciliation] = useState<FinanceReconciliationProjectionRow[]>(initialReconciliation ?? []);

  const refreshLedger = useCallback(async () => {
    const [nextViews, nextReceipts] = await Promise.all([
      financeService.listAllInvoices(),
      financeService.listReceipts(),
    ]);
    setViews(nextViews);
    setReceipts(nextReceipts);
  }, []);

  useEffect(() => {
    if (mode !== "demo") return;
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
  }, [mode]);

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
      href: canonicalStaffUrl(profileCode, "/finance/invoices"),
    },
    {
      label: "Payments to reconcile",
      count: recentReceipts,
      href: canonicalStaffUrl(profileCode, "/finance/payments"),
    },
  ];

  return (
    <>
      <section aria-labelledby="ledger-summary-heading">
        <div className={styles.sectionHead}>
          <h2 id="ledger-summary-heading" className="section-label">
            Ledger summary
          </h2>
          <span className="demo-badge">{mode === "supabase" ? "Authoritative ledger" : "Demo data"}</span>
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
          <span className="demo-badge">{mode === "supabase" ? "Authoritative ledger" : "Demo data"}</span>
        </div>
        <ul className={styles.queue}>
          {queue.map((item) => (
            <li key={item.href}>
              <Link prefetch={false} className={styles.queueRow} href={item.href}>
                <p className={styles.queueCopy}>
                  {item.label} <strong className="num">{item.count}</strong>
                </p>
                <span className="link-arrow">Open →</span>
              </Link>
            </li>
          ))}
          <li>
            <Link prefetch={false} className={styles.queueRow} href={canonicalStaffUrl(profileCode, "/finance/reconciliation")}>
              <p className={styles.queueCopy}>
                Reconciliation run — {reconciliation[0]?.run_at ? <strong className="num">last {formatKolkata(reconciliation[0].run_at, { format: "day" })}</strong> : <strong>not run</strong>}
              </p>
              <span className="link-arrow">Open →</span>
            </Link>
          </li>
        </ul>
      </section>

      <FeeLedgerTable views={views} mode={mode} />

      <FinanceActions views={views} mode={mode} onLedgerChanged={refreshLedger} />
    </>
  );
}
