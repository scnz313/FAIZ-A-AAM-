"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PayFlow } from "@/components/portal/PayFlow";
import Button from "@/components/ui/Button";
import { formatINR } from "@/modules/finance/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { financeService, type InvoiceView } from "@/modules/services/finance";
import {
  EnrollmentConversionError,
  convertApplication,
  type EnrollmentConversionResult,
} from "@/modules/services/enrollment";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./AdmissionFeeStep.module.css";

type AdmissionFeeStepProps = {
  applicationRef: string;
  /** The admission invoice issued at offer acceptance (I3). */
  invoiceRef: string;
  acceptByIso: string;
};

/**
 * Admission-fee island on the status page, shown once the offered seat is
 * accepted. The amount, payment, and receipt all come from the finance
 * ledger (the admission invoice issued at acceptance), so a confirmed
 * payment posts exactly once through the shared payment flow. Once the
 * invoice is paid, "Complete enrollment" runs the idempotent conversion:
 * it creates the permanent student/enrollment (and guardian link) records
 * and adopts the paid invoice into the new student's ledger. Retrying a
 * failed conversion is safe — it never duplicates records.
 */
export default function AdmissionFeeStep({ applicationRef, invoiceRef, acceptByIso }: AdmissionFeeStepProps) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(true);
  const [invoiceError, setInvoiceError] = useState(false);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState<EnrollmentConversionResult | null>(null);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const settledRef = useRef<string | null>(null);

  const refreshInvoice = useCallback(async (): Promise<void> => {
    try {
      const next = await financeService.getInvoice(invoiceRef);
      setInvoice(next);
      setInvoiceError(next === null);
      if (next === null) {
        setLive(`The admission invoice ${invoiceRef} could not be resolved.`);
      } else if (next.balancePaise === 0) {
        setLive("Admission fee paid — enrollment can now be completed.");
      }
    } catch {
      setInvoiceError(true);
      setLive("The admission invoice could not be resolved. Please try again.");
    }
  }, [invoiceRef]);

  /* The loading flag gates only the FIRST render — a later refresh must not
     unmount PayFlow while a payment is settling. */
  useEffect(() => {
    let cancelled = false;
    setInvoiceLoading(true);
    void refreshInvoice().finally(() => {
      if (!cancelled) setInvoiceLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshInvoice]);

  /* Move focus into the panel when a payment settles or conversion completes. */
  useEffect(() => {
    if (converted !== null || (invoice !== null && invoice.balancePaise === 0)) {
      panelRef.current?.focus();
    }
  }, [converted, invoice]);

  async function handleSettled(receiptRef: string): Promise<void> {
    settledRef.current = receiptRef;
    setLive(`Payment recorded — receipt ${receiptRef}. Enrollment can now be completed.`);
    await refreshInvoice();
  }

  async function handleConvert(): Promise<void> {
    if (converting) return;
    setConverting(true);
    setConversionError(null);
    setLive("Completing enrollment…");
    try {
      const result = await convertApplication(applicationRef);
      setConverted(result);
      setLive(
        result.portalAvailable
          ? `Enrollment complete — ${result.matchedExisting ? "existing student record" : "permanent student record"} ${result.studentRef} is on the school register and linked to the family portal.`
          : `Enrollment complete — permanent student record ${result.studentRef} is on the school register. The school will invite the guardian to link it.`,
      );
    } catch (error) {
      const message =
        error instanceof EnrollmentConversionError
          ? error.message
          : "Enrollment could not be completed right now. Please try again — a retry is safe and never duplicates records.";
      setConversionError(message);
      setLive(message);
    } finally {
      setConverting(false);
    }
  }

  const balancePaise = invoice?.balancePaise ?? 0;
  /* PayFlow stays mounted until conversion completes so its success panel
     (and the receipt link) remains visible after the ledger posts. */
  const showPayFlow = invoice !== null && !invoiceError && converted === null;
  const showConvert = invoice !== null && !invoiceError && balancePaise === 0 && converted === null;

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className={styles.panel}
      aria-labelledby="fee-step-title"
      aria-busy={invoiceLoading || converting}
    >
      <p className={styles.liveLine} aria-live="polite">
        {live}
      </p>
      <div className={styles.head}>
        <p className="section-label">Admission fee</p>
        {!supabaseMode ? <span className="demo-badge">Demo payment</span> : null}
      </div>
      <h3 className={styles.title} id="fee-step-title">
        Pay {formatINR(invoice?.totalPaise ?? 0)}
      </h3>
      <p className={styles.dueLine}>
        Due by <span className="num">{formatKolkata(acceptByIso, { format: "day" })}</span> — the seat is held only
        until this date. Invoice <span className="num">{invoiceRef}</span> is issued on the fee ledger.
      </p>

      {invoiceLoading ? (
        <p className={styles.processingLine} role="status" aria-live="polite">
          Checking the admission fee…
        </p>
      ) : invoiceError ? (
        <div className={styles.success} role="alert">
          <p className={styles.successTitle}>Invoice unavailable</p>
          <p className={styles.successNote}>
            The admission invoice could not be resolved in this demo ledger. Try again.
          </p>
          <Button variant="quiet" onClick={() => void refreshInvoice()}>
            Try again
          </Button>
        </div>
      ) : showPayFlow ? (
        <div className={styles.actions}>
          <PayFlow
            invoiceRef={invoiceRef}
            term="Admission"
            amountPaise={balancePaise}
            balanceAfterPaise={0}
            onSettled={(receiptRef) => void handleSettled(receiptRef)}
          />
        </div>
      ) : null}

      {showConvert ? (
        <div className={styles.success}>
          <p className={styles.successMark} aria-hidden="true">
            ✓
          </p>
          <p className={styles.successTitle}>Admission fee paid</p>
          <p className={styles.successNote}>
            {settledRef.current !== null ? (
              <>
                Receipt <span className="num">{settledRef.current}</span> recorded on the fee ledger — enrollment can
                now be completed.
              </>
            ) : (
              "The paid admission fee is recorded on the fee ledger — enrollment can now be completed."
            )}
          </p>
          <div className={styles.convertActions}>
            <Button variant="primary" onClick={() => void handleConvert()} disabled={converting}>
              {converting ? "Completing enrollment…" : "Complete enrollment"}
            </Button>
          </div>
          {conversionError !== null ? (
            <p className={styles.convertError} role="alert">
              {conversionError}
            </p>
          ) : null}
        </div>
      ) : null}

      {converted !== null ? (
        <div className={styles.converted} role="status">
          <p className={styles.successMark} aria-hidden="true">
            ✓
          </p>
          <p className={styles.successTitle}>Enrollment complete</p>
          <dl className={styles.convertedRows}>
            <div>
              <dt>Permanent student reference</dt>
              <dd className="num">{converted.studentRef}</dd>
            </div>
            <div>
              <dt>Enrollment reference</dt>
              <dd className="num">{converted.enrollmentRef}</dd>
            </div>
          </dl>
          <p className={styles.successNote}>
            {converted.portalAvailable
              ? "The child is now linked to the guardian's family portal — fees, results, timetable, and notices appear under the linked child."
              : "The child is enrolled. The school will invite the guardian to link the child to a family portal account."}
          </p>
          {converted.portalAvailable ? (
            <div className={styles.convertActions}>
              <Button href="/portal" variant="primary">
                Open family portal →
              </Button>
            </div>
          ) : null}
          <p className={styles.successNote}>Retrying this step is safe — enrollment never duplicates records.</p>
        </div>
      ) : null}
    </section>
  );
}
