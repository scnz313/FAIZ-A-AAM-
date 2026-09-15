"use client";

import { formatINR, type Invoice, type Receipt } from "@/modules/services/finance";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./ReceiptPanel.module.css";

type ReceiptPanelProps = {
  receipt: Receipt;
  invoice: Invoice;
  /** Active linked child shown on the sheet. */
  studentName: string;
  /** Class label when the viewer has one; omitted for staff projections. */
  studentClass?: string;
  /** Live projection: never labels a real receipt record as a demo. */
  live?: boolean;
};

const PRINT_RULES = `
  @media print {
    @page { margin: 14mm; }
    .faas-print-bar { display: none; }
    .faas-receipt-sheet { border-color: #0b1c2a; max-width: none; }
    .side-nav, .portal-topbar, .demo-strip, .alert-strip, .folio { display: none !important; }
    .facility-shell { display: block; }
    .portal-main { max-width: none; padding: 0; }
  }
`;

/**
 * Bordered receipt sheet with a print action. The print rules in this file
 * hide the portal chrome so only the sheet reaches the printer.
 */
export function ReceiptPanel({ receipt, invoice, studentName, studentClass, live = false }: ReceiptPanelProps) {
  return (
    <div className={styles.wrap}>
      {/* Print rules live in a literal style tag: the chrome they target is
          outside CSS-module scope, and raw selectors are allowed here. */}
      <style>{PRINT_RULES}</style>

      <div className={`faas-print-bar ${styles.printBar}`}>
        <button type="button" className="button button--quiet button--small" onClick={() => window.print()}>
          Print / save PDF
        </button>
      </div>

      <div className={`faas-receipt-sheet ${styles.sheet}`}>
        <header className={styles.sheetHead}>
          <div>
            <p className={styles.schoolName}>Faiz Aam Secondary School</p>
            <p className={styles.sheetLabel}>Fee receipt</p>
          </div>
          <span className={`num ${styles.sheetRef}`}>{receipt.ref}</span>
        </header>

        <dl className={styles.fields}>
          <div>
            <dt>Issued</dt>
            <dd>{formatKolkata(receipt.issuedAtIso, { format: "full" })}</dd>
          </div>
          <div>
            <dt>Student</dt>
            <dd>
              {studentName}
              {studentClass ? ` · ${studentClass}` : ""}
            </dd>
          </div>
          <div>
            <dt>Invoice</dt>
            <dd className="num">
              {receipt.invoiceRef} · {invoice.term}
            </dd>
          </div>
          <div>
            <dt>Method</dt>
            <dd>{receipt.method}</dd>
          </div>
        </dl>

        <div className={styles.amountBlock}>
          <p className={styles.amountLabel}>Amount received</p>
          <p className={`num ${styles.amount}`}>{formatINR(receipt.amountPaise)}</p>
        </div>

        <footer className={styles.sheetFoot}>
          <p className={styles.counter}>Counter: {receipt.counter}</p>
          <p className={styles.demoNote}>
            {live
              ? "This view reflects the finance office receipt record · the numbered original is issued by the office."
              : "This is a demo receipt · official receipts are numbered by the finance office."}
          </p>
        </footer>
      </div>
    </div>
  );
}

export default ReceiptPanel;
