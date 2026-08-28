import type { Metadata } from "next";
import { FINANCE_DEMO_NOTE } from "@/modules/services/finance";
import { financeService } from "@/modules/services/finance";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerInvoices, loadServerReceipts, loadServerReconciliationProjection } from "@/lib/supabase/server-loaders";
import { FinanceWorkspace } from "./FinanceWorkspace";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Finance · Staff",
};

/**
 * Staff finance workspace. The server renders the fixture-based first paint;
 * the FinanceWorkspace island re-reads the same finance service on mount so
 * browser-session payments posted through the shared checkout appear here —
 * family and staff balances agree.
 */
export default async function FinancePage() {
  const supabaseMode = dataAdapter() === "supabase";
  const [views, receipts] =
    supabaseMode
      ? await Promise.all([loadServerInvoices(), loadServerReceipts()])
      : await Promise.all([financeService.listAllInvoices(), financeService.listReceipts()]);
  const reconciliation = supabaseMode ? await loadServerReconciliationProjection() : [];

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Finance</p>
        <h1 className="workspace-title">Finance</h1>
        <p className="workspace-intro">Term ledger, payments, and reconciliation.</p>
      </header>

      <FinanceWorkspace initialViews={views} initialReceipts={receipts} initialReconciliation={reconciliation} mode={supabaseMode ? "supabase" : "demo"} />

      <div className={styles.ruleNote}>
        <p>Financial entries are append-only; corrections create new lines.</p>
        {!supabaseMode ? <p>{FINANCE_DEMO_NOTE}</p> : <p>Finance projections are sourced from the local sandbox ledger and database attempts.</p>}
      </div>
    </div>
  );
}
