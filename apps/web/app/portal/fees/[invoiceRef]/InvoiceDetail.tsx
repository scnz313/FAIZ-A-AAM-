"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { PayFlow } from "@/components/portal/PayFlow";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { FINANCE_DEMO_NOTE, formatINR, INVOICE_STATUS_META } from "@/modules/services/finance";
import { familyContextService, gradeSectionLabel, type StudentAccessScope } from "@/modules/services/family-context";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  ATTEMPT_STATUS_META,
  financeService,
  type InvoiceView,
  type PaymentAttempt,
} from "@/modules/services/finance";

import styles from "./page.module.css";

type InvoiceDetailProps = {
  invoiceRef: string;
  /** Ledger view read through the adapter on the server (fixtures by default). */
  initial: InvoiceView;
};

/**
 * Client island for one invoice. Demo mode re-reads the ledger through
 * financeService on mount so session payments survive route changes; both
 * modes refresh after PayFlow posts a payment. Payment attempts render
 * alongside the payments. The "Pay {balance}" CTA uses the adapter's live
 * balance.
 *
 * Access scope (plan.md Phase 2): the owning student is classified against
 * the family account once the context resolves — "current" renders as
 * before, "other" (a linked sibling) renders the record under a child-switch
 * panel, and "none" (unlinked owner) renders a neutral denial with no record
 * details. While the classification is pending the existing content stays
 * visible so the denial never flashes before it is earned.
 */
export function InvoiceDetail({ invoiceRef, initial }: InvoiceDetailProps) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const [view, setView] = useState<InvoiceView>(initial);
  const [attempts, setAttempts] = useState<PaymentAttempt[]>([]);
  const [settledRef, setSettledRef] = useState<string | null>(null);
  const [printNotice, setPrintNotice] = useState("");
  const [receiptNotice, setReceiptNotice] = useState("");
  const [receiptRetrying, setReceiptRetrying] = useState<string | null>(null);
  const [access, setAccess] = useState<StudentAccessScope | null>(null);

  const {
    status: contextStatus,
    context,
    students,
    errorMessage,
    switching,
    switchStudent,
    announcement,
    retry,
  } = useFamilyContext();

  const refresh = useCallback(async (): Promise<InvoiceView | null> => {
    const [nextView, nextAttempts] = await Promise.all([
      financeService.getInvoice(invoiceRef),
      financeService.listAttempts(invoiceRef),
    ]);
    if (nextView) setView(nextView);
    setAttempts(nextAttempts);
    return nextView;
  }, [invoiceRef]);

  useEffect(() => {
    if (supabaseMode) {
      setView(initial);
      void financeService.listAttempts(invoiceRef).then(setAttempts).catch(() => {});
      return;
    }
    void refresh();
  }, [initial, invoiceRef, refresh, supabaseMode]);

  /* Classify the invoice's owning student against the family account. The
     classifier needs the account id from the resolved context; null owners
     (admission invoices before conversion) classify as "current". */
  useEffect(() => {
    if (context === null) return;
    let cancelled = false;
    void familyContextService
      .classifyStudentAccess(context.accountId, view.studentId)
      .then((scope) => {
        if (!cancelled) setAccess(scope);
      })
      .catch(() => {
        if (!cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [context, view.studentId]);

  function handleSettled(receiptRef: string): void {
    setSettledRef(receiptRef);
    void refresh();
  }

  function printInvoice(): void {
    setPrintNotice("Print dialog opened for the demo invoice. The browser can save this view as a PDF.");
    window.print();
  }

  async function retryReceipt(receiptRef: string): Promise<void> {
    setReceiptRetrying(receiptRef);
    setReceiptNotice(`Retrying receipt lookup for ${receiptRef}…`);
    try {
      const receipt = await financeService.getReceipt(receiptRef);
      const nextView = await refresh();
      const resolved = Boolean(receipt && nextView?.receipts.some((item) => item.ref === receiptRef));
      setReceiptNotice(
        resolved ? `Receipt ${receiptRef} is available.` : "Receipt unavailable — retry",
      );
    } catch {
      setReceiptNotice("Receipt unavailable — retry");
    } finally {
      setReceiptRetrying(null);
    }
  }

  const { invoice } = view;
  const statusMeta = INVOICE_STATUS_META[view.status];
  const firstPayment = view.payments[0];
  const firstReceipt = firstPayment
    ? view.receipts.find((receipt) => receipt.ref === firstPayment.receiptRef)
    : undefined;
  const receiptHref = firstReceipt ? `/portal/receipts/${firstReceipt.ref}` : undefined;
  const amountPaise = view.balancePaise;
  const balanceAfterPaise = Math.max(0, view.balancePaise - amountPaise);
  /* The linked child that owns this invoice, when one is linked ("other"). */
  const owningStudent =
    view.studentId === null ? null : (students.find((item) => item.student.id === view.studentId) ?? null);

  return (
    <>
      <ActiveChildLine />
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <Link prefetch={false} className={`link-arrow ${styles.backLink}`} href="/portal/fees">
        ← Fees
      </Link>

      {contextStatus === "error" ? (
        <div className="workspace-state" role="alert">
          <p className="workspace-state-title">Family context unavailable</p>
          <p className="workspace-state-note">
            {errorMessage ?? "The demo family context could not be loaded. Retry to continue."}
          </p>
          <button type="button" className="button button--quiet button--small" onClick={retry}>
            Try again
          </button>
        </div>
      ) : access === "none" ? (
        <div className="workspace-state" role="alert">
          <p className="workspace-state-title">This record is not available to this account</p>
          <p className="workspace-state-note">
            The invoice you opened is not linked to this family account, so its details are not shown here. If you
            believe this is a mistake, contact the school office.
          </p>
          <Link prefetch={false} className="link-arrow" href="/portal/fees">
            ← Back to fees
          </Link>
        </div>
      ) : (
        <>
          {access === "other" && owningStudent ? (
            <div className={styles.contextPanel}>
              <p className={styles.contextPanelTitle}>
                This invoice belongs to {owningStudent.student.displayName}
              </p>
              <p className={styles.contextPanelNote}>
                {owningStudent.student.displayName} is in {gradeSectionLabel(owningStudent.gradeSection)}. This
                record is theirs — switch the active child to view and manage it under their ledger.
              </p>
              <div className={styles.contextPanelActions}>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  onClick={() => void switchStudent(owningStudent.student.id)}
                  disabled={switching}
                >
                  {switching ? "Switching…" : `Switch to ${owningStudent.student.displayName}`}
                </button>
              </div>
            </div>
          ) : null}

          {access === null ? (
            <p className={styles.checkingNote} role="status" aria-live="polite">
              Checking access…
            </p>
          ) : null}

          <header className={styles.pageHeader}>
            <p className="eyebrow">Portal · Invoice</p>
            <h1 className={styles.title}>
              {invoice.term} · <span className="num">{invoice.ref}</span>
            </h1>
            <p className={styles.metaLine}>
              <span>
                Issued {formatKolkata(invoice.issuedAtIso, { format: "day" })} · Due{" "}
                {formatKolkata(invoice.dueAtIso, { format: "day" })}
              </span>
              <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
            </p>
            <p className={styles.demoLine}>
              <span className="demo-badge">{supabaseMode ? "Live ledger projection" : "Demo data"}</span>{supabaseMode ? " Authoritative invoice and payment records." : ` ${FINANCE_DEMO_NOTE}`}
            </p>
            <div className={styles.headerActions}>
              <Button variant="quiet" onClick={printInvoice} aria-describedby="invoice-print-note">
                Print invoice{!supabaseMode ? " — demo" : ""}
              </Button>
              <span id="invoice-print-note" className="sr-only">
                Opens the browser print dialog for the visible {supabaseMode ? "ledger projection" : "demo invoice"} details. No file is generated here.
              </span>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {printNotice}
            </p>
          </header>

          <section className={styles.invoiceSection} aria-labelledby="items-title">
            <p className="section-label" id="items-title">
              Invoice items
            </p>
            <div className="table--scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className={styles.amountHead}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item) => (
                    <tr key={item.label} className={item.kind === "concession" ? styles.concessionRow : undefined}>
                      <td>{item.label}</td>
                      <td className={`num ${styles.amountCell}`}>{formatINR(item.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className={styles.totals}>
              <div>
                <dt>Total</dt>
                <dd className="num">{formatINR(view.totalPaise)}</dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd className="num">{formatINR(view.paidPaise)}</dd>
              </div>
              <div className={styles.balanceCell}>
                <dt>Balance</dt>
                <dd className="num">{formatINR(view.balancePaise)}</dd>
              </div>
            </dl>
            {view.ledgerEntries.length > 0 ? (
              <section className={styles.ledgerSection} aria-labelledby="ledger-entries-title">
                <p className="section-label" id="ledger-entries-title">
                  Adjustments &amp; refunds
                </p>
                <ul className={styles.ledgerList}>
                  {view.ledgerEntries.map((entry) => (
                    <li key={entry.ref}>
                      <div className={styles.paymentRow}>
                        <span className={`num ${styles.paymentRef}`}>{entry.ref}</span>
                        <span className={styles.paymentDesc}>
                          <strong>{entry.kind}</strong>
                          <small>{entry.reason}</small>
                        </span>
                        <span className={`num ${styles.paymentAmount}`}>{formatINR(entry.amountPaise)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className={styles.policyNote}>
                  Concessions, adjustments, and refunds are posted ledger entries — the original invoice items and
                  payment history are never rewritten (demo policy marker).
                </p>
              </section>
            ) : null}
          </section>

          <section className={styles.paymentsSection} aria-labelledby="payments-title">
            <p className="section-label" id="payments-title">
              Payments
            </p>
            {view.payments.length === 0 ? (
              <p className={styles.emptyState}>No payments recorded for this invoice yet.</p>
            ) : (
              <ul className={styles.paymentList}>
                {view.payments.map((payment) => (
                  <li key={payment.ref}>
                    <div className={styles.paymentRow}>
                      <span className={`num ${styles.paymentRef}`}>{payment.ref}</span>
                      <span className={styles.paymentDesc}>
                        <strong>{payment.method}</strong>
                        <small>{formatKolkata(payment.paidAtIso, { format: "day" })}</small>
                      </span>
                      <span className={`num ${styles.paymentAmount}`}>{formatINR(payment.amountPaise)}</span>
                      {view.receipts.some((receipt) => receipt.ref === payment.receiptRef) ? (
                        <Link prefetch={false} className="link-arrow" href={`/portal/receipts/${payment.receiptRef}`}>
                          Receipt →
                        </Link>
                      ) : (
                        <span className={styles.receiptRecovery}>
                          Receipt unavailable —{" "}
                          <button
                            type="button"
                            className="button button--quiet button--small"
                            onClick={() => void retryReceipt(payment.receiptRef)}
                            disabled={receiptRetrying === payment.receiptRef}
                          >
                            {receiptRetrying === payment.receiptRef ? "Retrying…" : "retry"}
                          </button>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.policyNote}>Partial payments are allowed per school policy.</p>
            <p className="sr-only" role="status" aria-live="polite">
              {receiptNotice}
            </p>
          </section>

          {attempts.length > 0 ? (
            <section className={styles.attemptsSection} aria-labelledby="attempts-title">
              <p className="section-label" id="attempts-title">
                Payment attempts
              </p>
              <ul className={styles.paymentList}>
                {attempts.map((attempt) => (
                  <li key={attempt.id}>
                    <div className={styles.attemptRow}>
                      <span className={`num ${styles.paymentRef}`}>{attempt.id}</span>
                      <span className={styles.attemptDesc}>
                        <strong>{ATTEMPT_STATUS_META[attempt.status].label}</strong>
                        <small>
                          {attempt.method} · {formatINR(attempt.amountPaise)} ·{" "}
                          {formatKolkata(attempt.updatedAtIso, { format: "day" })}
                        </small>
                        {attempt.failureReason ? (
                          <small className={styles.failureReason}>{attempt.failureReason}</small>
                        ) : null}
                      </span>
                      <StatusBadge tone={ATTEMPT_STATUS_META[attempt.status].tone}>
                        {ATTEMPT_STATUS_META[attempt.status].label}
                      </StatusBadge>
                    </div>
                  </li>
                ))}
              </ul>
              <p className={styles.policyNote}>
                Attempts are demo gateway records — only succeeded attempts post to the ledger.
              </p>
            </section>
          ) : null}

          <section className={styles.paymentAction} aria-label="Payment action">
            {view.balancePaise > 0 || settledRef ? (
              <PayFlow
                invoiceRef={invoiceRef}
                term={invoice.term}
                amountPaise={amountPaise}
                balanceAfterPaise={balanceAfterPaise}
                onSettled={handleSettled}
              />
            ) : (
              <div className={styles.paidBox}>
                <StatusBadge tone="good">Paid</StatusBadge>
                <p className={styles.paidText}>
                  This invoice is fully paid{receiptHref || firstPayment ? " — " : "."}
                  {receiptHref ? (
                    <Link prefetch={false} className="link-arrow" href={receiptHref}>
                      view receipt →
                    </Link>
                  ) : firstPayment ? (
                    <span className={styles.receiptRecovery}>
                      Receipt unavailable —{" "}
                      <button
                        type="button"
                        className="button button--quiet button--small"
                        onClick={() => void retryReceipt(firstPayment.receiptRef)}
                        disabled={receiptRetrying === firstPayment.receiptRef}
                      >
                        {receiptRetrying === firstPayment.receiptRef ? "Retrying…" : "retry"}
                      </button>
                    </span>
                  ) : null}
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
