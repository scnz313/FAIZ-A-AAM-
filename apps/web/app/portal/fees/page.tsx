import type { Metadata } from "next";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { FINANCE_DEMO_NOTE } from "@/modules/services/finance";
import { financeService } from "@/modules/services/finance";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerActiveStudentInvoices } from "@/lib/supabase/server-loaders";

import { FeeLedger, type LedgerFilter } from "./FeeLedger";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Fees · Portal",
  description: "Fee ledger for the linked student · invoices, payments, and balance.",
};

export default async function FeesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter: LedgerFilter = status === "unpaid" || status === "paid" ? status : "all";
  const supabaseMode = dataAdapter() === "supabase";
  const initial = supabaseMode ? await loadServerActiveStudentInvoices() : await financeService.listInvoices();

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Fees</h1>
          <p className="ph-sub">
            Invoices and payments for the active child.
          </p>
          <ActiveChildLine />
          <p className={styles.demoLine}>
            <span className="demo-badge">{supabaseMode ? "Live ledger projection" : "Demo data"}</span>{supabaseMode ? " Authoritative invoice and payment records." : ` ${FINANCE_DEMO_NOTE}`}
          </p>
        </div>
      </div>

      <FeeLedger initial={initial} initialFilter={filter} />
    </div>
  );
}
