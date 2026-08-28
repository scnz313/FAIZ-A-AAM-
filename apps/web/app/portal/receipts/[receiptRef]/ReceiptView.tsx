"use client";

import { useEffect, useState } from "react";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { ReceiptPanel } from "@/components/portal/ReceiptPanel";
import Button from "@/components/ui/Button";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { familyContextService, gradeSectionLabel, type StudentAccessScope } from "@/modules/services/family-context";
import { FINANCE_DEMO_NOTE } from "@/modules/services/finance";
import { financeService, type Invoice, type Receipt } from "@/modules/services/finance";

import styles from "./page.module.css";

type ReceiptState =
  | { status: "loading" }
  | { status: "found"; receipt: Receipt; invoice: Invoice }
  | { status: "missing" };

type ReceiptData = { receipt: Receipt; invoice: Invoice };

async function loadReceiptData(receiptRef: string): Promise<ReceiptData | null> {
  try {
    const receipt = await financeService.getReceipt(receiptRef);
    if (!receipt) return null;
    const view = await financeService.getInvoice(receipt.invoiceRef);
    return view ? { receipt, invoice: view.invoice } : null;
  } catch {
    return null;
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
        setState(data ? { status: "found", ...data } : { status: "missing" });
      })
      .catch(() => {
        if (cancelled) return;
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
    if (data) {
      setState({ status: "found", ...data });
      setNotice(`Receipt ${receiptRef} is available.`);
    } else {
      setState({ status: "missing" });
      setNotice("Receipt unavailable — retry");
    }
    setRetrying(false);
  }

  function printReceipt(): void {
    setNotice("Print dialog opened for the demo receipt. The browser can save this view as a PDF.");
    window.print();
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
    return (
      <div className={styles.notFound}>
        <p className="eyebrow">Portal · Receipt</p>
        <h1 className={styles.title}>Receipt not found</h1>
        <p className={styles.notFoundText}>
          No receipt with the reference <span className="num">{receiptRef}</span> could be resolved in this demo ledger.
          The reference has not been replaced with another receipt.
        </p>
        <div className={styles.recoveryActions}>
          <Button variant="quiet" onClick={() => void retryReceipt()} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
          <a className="link-arrow" href="/portal/fees">
            ← Back to fees
          </a>
        </div>
        <p className={styles.liveNotice} role="status" aria-live="polite">
          {notice || "Receipt unavailable — retry"}
        </p>
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
            {errorMessage ?? "The demo family context could not be loaded. Retry to continue."}
          </p>
          <div className={styles.recoveryActions}>
            <button type="button" className="button button--quiet button--small" onClick={retry}>
              Try again
            </button>
            <a className="link-arrow" href="/portal/fees">
              ← Back to fees
            </a>
          </div>
        </div>
      ) : access === "none" ? (
        <div className="workspace-state" role="alert">
          <p className="workspace-state-title">This record is not available to this account</p>
          <p className="workspace-state-note">
            The receipt you opened is not linked to this family account, so its details are not shown here. If you
            believe this is a mistake, contact the school office.
          </p>
          <a className="link-arrow" href="/portal/fees">
            ← Back to fees
          </a>
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

          <div className={styles.pageHeader}>
            <a className="link-arrow" href="/portal/fees">
              ← Fees
            </a>
            <p className="eyebrow">Portal · Receipt</p>
            <h1 className={styles.title}>
              Receipt · <span className="num">{receipt.ref}</span>
            </h1>
            <p className={styles.demoLine}>
              <span className="demo-badge">Demo data</span> {FINANCE_DEMO_NOTE}
            </p>
            <div className={styles.headerActions}>
              <Button variant="quiet" onClick={printReceipt} aria-describedby="receipt-print-note">
                Print receipt — demo
              </Button>
              <span id="receipt-print-note" className="sr-only">
                Opens the browser print dialog for this visible demo receipt. No file is generated by this demo.
              </span>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {notice}
            </p>
          </div>

          <ReceiptPanel receipt={receipt} invoice={invoice} studentName={studentName} studentClass={studentClass} />
        </>
      )}
    </div>
  );
}
