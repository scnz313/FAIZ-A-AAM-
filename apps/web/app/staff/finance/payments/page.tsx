import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StatusTone } from "@/components/ui/StatusBadge";
import { FINANCE_DEMO_NOTE, formatINR, type PaymentMethod } from "@/modules/services/finance";
import { financeService } from "@/modules/services/finance";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerInvoices, loadServerPaymentAttempts } from "@/lib/supabase/server-loaders";
import { formatKolkata } from "@/modules/iot/domain";
import { mergePaymentRegisterRows } from "@/modules/services/finance-server-map";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Payments · Staff",
};

type PaymentStatus = "success" | "pending" | "failed";

type PaymentRow = {
  ref: string;
  studentName: string;
  method: PaymentMethod;
  amountPaise: number;
  paidAtIso: string;
  invoiceRef: string;
  status: PaymentStatus;
  receiptRef: string | null;
  /** Attempt identity used to merge the posted payment with its source attempt. */
  attemptId?: string | null;
  /** Safe provider transaction/order identity used only to merge projections. */
  providerTxnRef?: string | null;
  /** Demo-only marker; Supabase rows are always authoritative attempts. */
  demo?: boolean;
};

const STATUS_META: Record<PaymentStatus, { label: string; tone: StatusTone }> = {
  success: { label: "Success", tone: "good" },
  pending: { label: "Pending", tone: "watch" },
  failed: { label: "Failed", tone: "alert" },
};

export default async function PaymentsPage() {
  const supabaseMode = dataAdapter() === "supabase";
  const views = supabaseMode ? await loadServerInvoices() : await financeService.listAllInvoices();

  // Verified ledger payments derived from the service views, so the register
  // always agrees with the guardian portal ledgers.
  const ledgerPayments: PaymentRow[] = views.flatMap((view) =>
    view.invoice.payments.map((payment) => ({
      ref: payment.ref,
      studentName: view.studentName,
      method: payment.method,
      amountPaise: payment.amountPaise,
      paidAtIso: payment.paidAtIso,
      invoiceRef: view.invoice.ref,
      status: "success" as const,
      receiptRef: payment.receiptRef,
      attemptId: payment.attemptId,
      providerTxnRef: payment.providerTxnRef,
    })),
  );
  const invoiceByRef = new Map(views.map((view) => [view.invoice.ref, view] as const));

  const authoritativeAttempts: PaymentRow[] = supabaseMode
    ? (await loadServerPaymentAttempts()).map((attempt) => {
        const invoiceRef = attempt.invoices?.reference ?? "—";
        return {
          ref: attempt.reference,
          studentName: invoiceByRef.get(invoiceRef)?.studentName ?? "Linked student",
          method: attempt.method as PaymentMethod,
          amountPaise: attempt.amount_paise,
          paidAtIso: attempt.updated_at,
          invoiceRef,
          status: attempt.status === "succeeded" ? "success" : ["failed", "cancelled"].includes(attempt.status) ? "failed" : "pending",
          receiptRef: null,
          attemptId: attempt.id,
          providerTxnRef: attempt.provider_order_ref,
        };
      })
    : [];

  // Demo-only gateway attempts remain visible only in demo mode.
  const demoAttempts: PaymentRow[] = [
    {
      ref: "PAY-2026-0301",
      studentName: "Aarif Hussain",
      method: "UPI",
      amountPaise: 500000,
      paidAtIso: "2026-08-03T04:20:00Z",
      invoiceRef: "INV-2026-0103",
      status: "pending",
      receiptRef: null,
      demo: true,
    },
    {
      ref: "PAY-2026-0302",
      studentName: "Aarif Hussain",
      method: "Card",
      amountPaise: 100000,
      paidAtIso: "2026-08-03T05:10:00Z",
      invoiceRef: "INV-2026-0103",
      status: "failed",
      receiptRef: null,
      demo: true,
    },
  ];

  const paymentRows = mergePaymentRegisterRows(
    ledgerPayments,
    supabaseMode ? authoritativeAttempts : demoAttempts,
  );
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Payments</p>
        <h1 className="workspace-title">Payments</h1>
        <p className="workspace-intro">Payment attempts and receipts.</p>
      </header>

      <section aria-labelledby="payments-table-heading">
        <div className={styles.sectionHead}>
          <h2 id="payments-table-heading" className="section-label">
            Payment register
          </h2>
          <span className="demo-badge">{supabaseMode ? "Live projection" : "Demo data"}</span>
        </div>
        <div className="table--scroll">
          {paymentRows.length === 0 ? (
            <p className={styles.ruleNote}>No payments in the register.</p>
          ) : (
          <table className={`table ${styles.paymentsTable}`}>
            <thead>
              <tr>
                <th scope="col">Ref</th>
                <th scope="col">Student</th>
                <th scope="col">Method</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col" className="num">Date</th>
                <th scope="col">Invoice ref</th>
                <th scope="col">Status</th>
                <th scope="col">Receipt ref</th>
              </tr>
            </thead>
            <tbody>
              {paymentRows.map((payment) => (
                <tr key={payment.ref}>
                  <td className={styles.refCell}>
                    <span className="num">{payment.ref}</span>
                    {payment.demo && <span className="demo-badge">Demo</span>}
                  </td>
                  <td>{payment.studentName}</td>
                  <td>{payment.method}</td>
                  <td className="num">{formatINR(payment.amountPaise)}</td>
                  <td className="num">{formatKolkata(payment.paidAtIso, { format: "day" })}</td>
                  <td>
                    <span className="num">{payment.invoiceRef}</span>
                  </td>
                  <td>
                    <StatusBadge tone={STATUS_META[payment.status].tone}>{STATUS_META[payment.status].label}</StatusBadge>
                  </td>
                  <td>
                    {payment.receiptRef ? (
                      <Link prefetch={false} className="link-arrow" href={`/portal/receipts/${payment.receiptRef}`}>
                        {payment.receiptRef}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </section>

      <div className={styles.ruleNote}>
        <p>Browser redirects are never proof of payment — only verified events post to the ledger.</p>
        {!supabaseMode ? <p>{FINANCE_DEMO_NOTE}</p> : <p>Payment attempts are the local sandbox projection; no browser return is treated as settlement.</p>}
      </div>
    </div>
  );
}
