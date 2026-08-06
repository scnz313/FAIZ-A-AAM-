import type { Metadata } from "next";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { InvoiceLines } from "@/components/staff/InvoiceLines";
import { FINANCE_DEMO_NOTE, formatINR, INVOICE_STATUS_META } from "@/modules/finance/demo";
import { financeService } from "@/modules/services/finance";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Invoices · Staff",
};

export default async function InvoicesPage() {
  const views = await financeService.listAllInvoices();
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
          <span className="demo-badge">Demo data</span>
        </div>
        <div className="table--scroll">
          <table className={`table ${styles.invoiceTable}`}>
            <thead>
              <tr>
                <th scope="col">Ref</th>
                <th scope="col">Student</th>
                <th scope="col">Term</th>
                <th scope="col">Issued</th>
                <th scope="col">Due</th>
                <th scope="col">Total</th>
                <th scope="col">Balance</th>
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
                      <Button variant="quiet">Print</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.footNote}>
          Print is a demo placeholder — printable invoice copies arrive with the finance backend.
        </p>
      </section>

      <div className={styles.ruleNote}>
        <p>{FINANCE_DEMO_NOTE}</p>
      </div>
    </div>
  );
}
