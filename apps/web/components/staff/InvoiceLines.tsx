import type { Invoice } from "@/modules/finance/demo";
import { formatINR, invoiceTotal } from "@/modules/finance/demo";

import styles from "./InvoiceLines.module.css";

/**
 * Expandable line items for one invoice: the ref summary opens a ruled
 * list of item labels with amounts and the invoice total. Shared by the
 * portal ledger and the staff invoice register.
 */
export function InvoiceLines({ invoice }: { invoice: Invoice }) {
  return (
    <details className={styles.lines}>
      <summary>
        <strong className="num">{invoice.ref}</strong>
        <small className={styles.lineCount}>
          {invoice.items.length} line{invoice.items.length === 1 ? "" : "s"}
        </small>
      </summary>
      <div className={styles.lineItems}>
        {invoice.items.map((item) => (
          <div className={styles.lineItem} key={item.label}>
            <span className={item.kind === "concession" ? styles.concession : undefined}>{item.label}</span>
            <span className="num">{formatINR(item.amountPaise)}</span>
          </div>
        ))}
        <div className={styles.lineTotal}>
          <span>Total</span>
          <span className="num">{formatINR(invoiceTotal(invoice))}</span>
        </div>
      </div>
    </details>
  );
}

export default InvoiceLines;
