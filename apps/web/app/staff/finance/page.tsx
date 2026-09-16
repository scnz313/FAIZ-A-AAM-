import type { Metadata } from "next";
import { FINANCE_DEMO_NOTE } from "@/modules/services/finance";
import { financeService } from "@/modules/services/finance";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerInvoices, loadServerReconciliationProjection } from "@/lib/supabase/server-loaders";
import { FinanceWorkspace } from "./FinanceWorkspace";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Finance",
};

/**
 * Staff finance workspace — V14 aligned. PageHead + FinanceWorkspace
 * with tab navigation. The server renders the fixture-based first paint;
 * the FinanceWorkspace island re-reads the same finance service on mount so
 * browser-session payments posted through the shared checkout appear here —
 * family and staff balances agree.
 */
export default async function FinancePage() {
  const supabaseMode = dataAdapter() === "supabase";
  const viewsPromise = supabaseMode ? loadServerInvoices() : financeService.listAllInvoices();
  const receiptsPromise = supabaseMode
    ? viewsPromise.then((views) => [...new Map(views.flatMap((view) => view.receipts).map((receipt) => [receipt.ref, receipt])).values()])
    : financeService.listReceipts();
  const [views, receipts, reconciliation] = await Promise.all([
    viewsPromise,
    receiptsPromise,
    supabaseMode ? loadServerReconciliationProjection() : Promise.resolve([]),
  ]);

  return (
    <div className={styles.page}>
      {/* V14 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Finance</h1>
          <p className="ph-sub">
            Invoices, payments and reconciliation for the whole school. Approvals respect finance_approver role and maker-checker separation.
          </p>
        </div>
      </div>

      <FinanceWorkspace initialViews={views} initialReceipts={receipts} initialReconciliation={reconciliation} mode={supabaseMode ? "supabase" : "demo"} />

      <div className={styles.ruleNote}>
        <p>Financial entries are append-only; corrections create new lines.</p>
        {!supabaseMode ? <p>{FINANCE_DEMO_NOTE}</p> : <p>Finance projections are sourced from the authoritative ledger; online payment attempts use the local sandbox provider.</p>}
      </div>
    </div>
  );
}
