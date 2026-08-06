import type { Metadata } from "next";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { FINANCE_DEMO_NOTE } from "@/modules/finance/demo";
import { financeService } from "@/modules/services/finance";

import { FeeLedger, type LedgerFilter } from "./FeeLedger";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Fees · Portal",
  description: "Fee ledger for the linked student — invoices, payments, and balance.",
};

export default async function FeesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter: LedgerFilter = status === "unpaid" || status === "paid" ? status : "all";
  const initial = await financeService.listInvoices();

  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Portal · Fees</p>
        <h1 className={styles.title}>Fees</h1>
        <p className={styles.intro}>
          Term-wise invoices and payments for the linked student. Partial payments appear against each invoice as
          they are made.
        </p>
        <ActiveChildLine />
        <p className={styles.demoLine}>
          <span className="demo-badge">Demo data</span> {FINANCE_DEMO_NOTE}
        </p>
      </header>

      <FeeLedger initial={initial} initialFilter={filter} />
    </div>
  );
}
