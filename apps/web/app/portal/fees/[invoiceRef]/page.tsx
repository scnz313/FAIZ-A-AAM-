import type { Metadata } from "next";

import { financeService } from "@/modules/services/finance";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerActiveStudentInvoices } from "@/lib/supabase/server-loaders";

import { InvoiceDetail } from "./InvoiceDetail";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Invoice · Portal",
};

function InvoiceNotFound({ reference }: { reference: string }) {
  return (
    <div className={styles.notFound}>
      <p className="eyebrow">Portal · Invoice</p>
      <h1 className={styles.title}>Invoice not found</h1>
      <p className={styles.notFoundText}>
        No invoice with the reference <span className="num">{reference}</span> exists in this demo ledger. Check the
        reference in the address, or return to the fee ledger.
      </p>
      <a className="link-arrow" href="/portal/fees">
        ← Back to fees
      </a>
    </div>
  );
}

export default async function InvoicePage({ params }: { params: Promise<{ invoiceRef: string }> }) {
  const { invoiceRef } = await params;
  const initial =
    dataAdapter() === "supabase"
      ? (await loadServerActiveStudentInvoices()).find((view) => view.invoice.ref === invoiceRef) ?? null
      : await financeService.getInvoice(invoiceRef);
  if (!initial) return <InvoiceNotFound reference={invoiceRef} />;

  return (
    <div className={styles.page}>
      <InvoiceDetail invoiceRef={invoiceRef} initial={initial} />
    </div>
  );
}
