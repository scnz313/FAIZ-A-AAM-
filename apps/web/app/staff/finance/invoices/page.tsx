import type { Metadata } from "next";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { InvoiceLines } from "@/components/staff/InvoiceLines";
import { FINANCE_DEMO_NOTE, formatINR, INVOICE_STATUS_META } from "@/modules/services/finance";
import { financeService } from "@/modules/services/finance";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerInvoices } from "@/lib/supabase/server-loaders";
import { formatKolkata } from "@/modules/iot/domain";
import { PrintButton } from "./PrintButton";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Invoices · Staff",
};

export default async function InvoicesPage() {
  const supabaseMode = dataAdapter() === "supabase";
  const views = supabaseMode ? await loadServerInvoices() : await financeService.listAllInvoices();
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Invoices</p>
        <h1 className="workspace-title">Invoices</h1>
        <p className="workspace-intro">Term invoices for session 2026-27.</p>
      </header>

      <section aria-labelledby="invoice-table-heading">
        <div className={styles.sectionHead}>
          <h2 id="invoice-table-heading" className="section-label">
            Invoice register
          </h2>
          <span className="demo-badge">{supabaseMode ? "Live projection" : "Demo data"}</span>
        </div>
        <div className="table--scroll">
          {views.length === 0 ? (
            <p className={styles.footNote}>No invoices in the register.</p>
          ) : (
          <table className={`table ${styles.invoiceTable}`}>
            <thead>
              <tr>
                <th scope="col">Ref</th>
                <th scope="col">Student</th>
                <th scope="col">Term</th>
                <th scope="col" className="num">Issued</th>
                <th scope="col" className="num">Due</th>
                <th scope="col" className="num">Total</th>
                <th scope="col" className="num">Balance</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {views.map((view) => (
                <tr key={view.invoice.ref}>
                  <td>
                    <InvoiceLines invoice={view.invoice} />
                  </td>
                  <td>{view.studentName}</td>
                  <td>{view.invoice.term}</td>
                  <td className="num">{formatKolkata(view.invoice.issuedAtIso, { format: "day" })}</td>
                  <td className="num">{formatKolkata(view.invoice.dueAtIso, { format: "day" })}</td>
                  <td className="num">{formatINR(view.totalPaise)}</td>
                  <td className="num">{formatINR(view.balancePaise)}</td>
                  <td>
                    <StatusBadge tone={INVOICE_STATUS_META[view.status].tone}>{INVOICE_STATUS_META[view.status].label}</StatusBadge>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <PrintButton />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
        {!supabaseMode ? (
          <p className={styles.footNote}>
            Print is a demo placeholder — printable invoice copies arrive with the finance backend.
          </p>
        ) : null}
      </section>

      <div className={styles.ruleNote}>
        {!supabaseMode ? <p>{FINANCE_DEMO_NOTE}</p> : <p>Invoice balances are derived from the authoritative ledger projection.</p>}
      </div>
    </div>
  );
}
