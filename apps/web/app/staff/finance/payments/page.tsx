import type { Metadata } from "next";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StatusTone } from "@/components/ui/StatusBadge";
import { FINANCE_DEMO_NOTE, formatINR } from "@/modules/finance/demo";
import type { PaymentMethod } from "@/modules/finance/demo";
import { financeService } from "@/modules/services/finance";
import { formatKolkata } from "@/modules/iot/domain";

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
  /** Fictional gateway attempt added for the demo queue. */
  demo?: boolean;
};

const STATUS_META: Record<PaymentStatus, { label: string; tone: StatusTone }> = {
  success: { label: "Success", tone: "good" },
  pending: { label: "Pending", tone: "watch" },
  failed: { label: "Failed", tone: "alert" },
};

export default async function PaymentsPage() {
  const views = await financeService.listAllInvoices();

  // Verified ledger payments derived from the service views, so the register
  // always agrees with the parent portal ledgers.
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
    })),
  );

  // Fictional gateway attempts awaiting review — clearly marked as demo.
  // A ref already posted to the ledger wins, so a session payment never
  // renders twice with contradictory states.
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

  const ledgerRefs = new Set(ledgerPayments.map((payment) => payment.ref));
  const paymentRows: PaymentRow[] = [
    ...ledgerPayments,
    ...demoAttempts.filter((row) => !ledgerRefs.has(row.ref)),
  ];
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
          <span className="demo-badge">Demo data</span>
        </div>
        <div className="table--scroll">
          <table className={`table ${styles.paymentsTable}`}>
            <thead>
              <tr>
                <th scope="col">Ref</th>
                <th scope="col">Student</th>
                <th scope="col">Method</th>
                <th scope="col">Amount</th>
                <th scope="col">Date</th>
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
                      <a className="link-arrow" href={`/portal/receipts/${payment.receiptRef}`}>
                        {payment.receiptRef}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.ruleNote}>
        <p>Browser redirects are never proof of payment — only verified events post to the ledger.</p>
        <p>{FINANCE_DEMO_NOTE}</p>
      </div>
    </div>
  );
}
