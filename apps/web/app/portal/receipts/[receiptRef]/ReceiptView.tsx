"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { ReceiptPanel } from "@/components/portal/ReceiptPanel";
import Button from "@/components/ui/Button";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { familyContextService, gradeSectionLabel, type StudentAccessScope } from "@/modules/services/family-context";
import { FINANCE_DEMO_NOTE } from "@/modules/services/finance";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { financeService, type Invoice, type Receipt } from "@/modules/services/finance";

import styles from "./page.module.css";

type ReceiptState =
  | { status: "loading" }
  | { status: "found"; receipt: Receipt; invoice: Invoice }
  | { status: "missing" }
  | { status: "error"; message: string };

type ReceiptData = { receipt: Receipt; invoice: Invoice };

async function loadReceiptData(receiptRef: string): Promise<ReceiptData | { error: string } | null> {
  try {
    const receipt = await financeService.getReceipt(receiptRef);
    if (!receipt) return null;
    const view = await financeService.getInvoice(receipt.invoiceRef);
    return view ? { receipt, invoice: view.invoice } : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load receipt. Please try again.";
    return { error: message };
  }
}

/**
 * Client island for one receipt. Resolves through the adapter on mount so a
 * receipt issued in the current session (e.g. by PayFlow) renders here;
 * unknown references get the editorial not-found.
 *
 * Access scope (plan.md Phase 2): the owning student is classified against
 * the family account once the context resolves — "current" renders as
 * before, "other" (a linked sibling) renders the record under a child-switch
 * panel, and "none" (unlinked owner) renders a neutral denial with no record
 * details. While the classification is pending the found content stays
 * visible so the denial never flashes before it is earned.
 */
export function ReceiptView({ receiptRef }: { receiptRef: string }) {
  const [state, setState] = useState<ReceiptState>({ status: "loading" });
  const [retrying, setRetrying] = useState(false);
  const [notice, setNotice] = useState("");
  const [access, setAccess] = useState<StudentAccessScope | null>(null);
  const {
    status: contextStatus,
    context,
    activeStudent,
    students,
    errorMessage,
    switching,
    switchStudent,
    announcement,
    retry,
  } = useFamilyContext();

  useEffect(() => {
    let cancelled = false;
    void loadReceiptData(receiptRef)
      .then((data) => {
        if (cancelled) return;
        if (data && "error" in data) {
          setState({ status: "error", message: data.error });
        } else if (data) {
          setState({ status: "found", receipt: data.receipt, invoice: data.invoice });
        } else {
          setState({ status: "missing" });
        }
      })
      .catch(() => {
        /* Never leave the page on a permanent "Resolving…" line. */
        if (!cancelled) {
          setState({ status: "error", message: "Unable to load this receipt. Check your connection and try again." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [receiptRef]);

  /* Classify the receipt's owning student against the family account. The
     classifier needs the account id from the resolved context; null owners
     (admission receipts before conversion) classify as "current". */
  useEffect(() => {
    if (context === null || state.status !== "found") return;
    let cancelled = false;
    void familyContextService
      .classifyStudentAccess(context.accountId, state.receipt.studentId)
      .then((scope) => {
        if (!cancelled) setAccess(scope);
      })
      .catch(() => {
        if (!cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [context, state]);

  async function retryReceipt(): Promise<void> {
    setRetrying(true);
    setNotice("Retrying receipt lookup…");
    const data = await loadReceiptData(receiptRef);
    if (data && "error" in data) {
      setState({ status: "error", message: data.error });
      setNotice("Receipt lookup failed · retry");
    } else if (data) {
      setState({ status: "found", receipt: data.receipt, invoice: data.invoice });
      setNotice(`Receipt ${receiptRef} is available.`);
    } else {
      setState({ status: "missing" });
      setNotice("Receipt unavailable · retry");
    }
    setRetrying(false);
  }

  function printReceipt(): void {
    setNotice(
      clientAdapterMode() === "supabase"
        ? "Print dialog opened for this receipt. The browser can save this view as a PDF."
        : "Print dialog opened for the demo receipt. The browser can save this view as a PDF.",
    );
    window.print();
  }

  if (state.status === "error") {
    return (
      <div className={styles.notFound}>
        <p className="eyebrow">Portal · Receipt</p>
        <h1 className={styles.title}>Receipt temporarily unavailable</h1>
        <p className={styles.notFoundText} role="alert">
          {state.message}
        </p>
        <div className={styles.recoveryActions}>
          <Button variant="quiet" onClick={() => void retryReceipt()} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
          <Link prefetch={false} className="link-arrow" href="/portal/fees">
            ← Back to fees
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className={styles.receiptPage}>
        <p className="eyebrow">Portal · Receipt</p>
        <h1 className={styles.title}>
          Receipt · <span className="num">{receiptRef}</span>
        </h1>
        <p className={styles.notFoundText} role="status" aria-live="polite">
          Resolving receipt {receiptRef}…
        </p>
      </div>
    );
  }

  if (state.status === "missing") {
    const live = clientAdapterMode() === "supabase";
    return (
      <div className={styles.notFound}>
        <p className="eyebrow">Portal · Receipt</p>
        <h1 className={styles.title}>Receipt not found</h1>
        <p className={styles.notFoundText}>
          No receipt with the reference <span className="num">{receiptRef}</span>{" "}
          {live
            ? "is attached to this family account. Receipts are issued only after the finance office confirms a payment."
            : "could be resolved in this demo ledger. Receipts are issued only after a payment is confirmed."}
        </p>
        <div className={styles.recoveryActions}>
          <Button variant="quiet" onClick={() => void retryReceipt()} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
          <Link prefetch={false} className="link-arrow" href="/portal/fees">
            ← Back to fees
          </Link>
        </div>
        {notice ? (
          <p className={styles.liveNotice} role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}
      </div>
    );
  }

  const { receipt, invoice } = state;
  // The receipt resolves to its owning child, not the active selection: a
  // sibling's receipt must never be labelled with the current child.
  const owningStudent = receipt.studentId === null ? null : (students.find((item) => item.student.id === receipt.studentId) ?? null);
  const studentName =
    owningStudent?.student.displayName ?? activeStudent?.student.displayName ?? "Linked student";
  const studentClass = owningStudent
    ? gradeSectionLabel(owningStudent.gradeSection)
    : activeStudent
      ? gradeSectionLabel(activeStudent.gradeSection)
      : "—";
  return (
    <div className={styles.receiptPage}>
      <ActiveChildLine />
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {contextStatus === "error" ? (
        <div className="workspace-state" role="alert">
          <p className="workspace-state-title">Family context unavailable</p>
          <p className="workspace-state-note">
            {errorMessage ??
              (clientAdapterMode() === "supabase"
                ? "Your family context could not be loaded. Retry to continue."
                : "The demo family context could not be loaded. Retry to continue.")}
          </p>
          <div className={styles.recoveryActions}>
            <button type="button" className="button button--quiet button--small" onClick={retry}>
              Try again
            </button>
            <Link prefetch={false} className="link-arrow" href="/portal/fees">
              ← Back to fees
            </Link>
          </div>
        </div>
      ) : access === "none" ? (
        <div className="workspace-state" role="alert">
          <p className="workspace-state-title">This record is not available to this account</p>
          <p className="workspace-state-note">
            The receipt you opened is not linked to this family account, so its details are not shown here. If you
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
                This receipt belongs to {owningStudent.student.displayName}
              </p>
              <p className={styles.contextPanelNote}>
                {owningStudent.student.displayName} is in {gradeSectionLabel(owningStudent.gradeSection)}. This
                record is theirs · switch the active child to view and manage it under their ledger.
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

          <div className={styles.pageHeader}>
            <Link prefetch={false} className="link-arrow" href="/portal/fees">
              ← Fees
            </Link>
            <p className="eyebrow">Portal · Receipt</p>
            <h1 className={styles.title}>
              Receipt · <span className="num">{receipt.ref}</span>
            </h1>
            <p className={styles.demoLine}>
              {clientAdapterMode() === "demo" ? (<><span className="demo-badge">Demo data</span> {FINANCE_DEMO_NOTE}</>) : null}
            </p>
            <div className={styles.headerActions}>
              <Button variant="quiet" onClick={printReceipt} aria-describedby="receipt-print-note">
                Print receipt{clientAdapterMode() === "demo" ? " · demo" : ""}
              </Button>
              <span id="receipt-print-note" className="sr-only">
                {clientAdapterMode() === "supabase"
                  ? "Opens the browser print dialog for this receipt. No file is generated here."
                  : "Opens the browser print dialog for this visible demo receipt. No file is generated by this demo."}
              </span>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {notice}
            </p>
          </div>

          <ReceiptPanel
            receipt={receipt}
            invoice={invoice}
            studentName={studentName}
            studentClass={studentClass}
            live={clientAdapterMode() === "supabase"}
          />
        </>
      )}
    </div>
  );
}
