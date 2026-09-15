import type { Metadata } from "next";
import Link from "next/link";

import { ReceiptPanel } from "@/components/portal/ReceiptPanel";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import RetryButton from "@/components/ui/RetryButton";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerInvoices, loadServerProfileCode, loadServerStaffReceipts } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Receipt · Staff",
};

/**
 * Staff receipt detail. Reads the same RLS-scoped receipt projection the
 * family ledger reads, so the printed amount, method, and invoice always
 * agree with the guardian view. Browser print or Save-as-PDF produces the
 * sheet; no separate file is generated.
 */
export default async function StaffReceiptPage({ params }: { params: Promise<{ receiptRef: string }> }) {
  const { receiptRef } = await params;
  const backHref = "/administrator/finance/payments";

  if (dataAdapter() !== "supabase") {
    return (
      <div className={styles.page}>
        <p className={styles.back}>
          <Link prefetch={false} className="link-arrow" href={backHref}>
            ← Payments
          </Link>
        </p>
        <p className="workspace-intro">
          Receipt detail reads the live finance projection. In demo mode the register stays as reference text.
        </p>
      </div>
    );
  }

  let profileCode;
  let receipts;
  let views;
  try {
    profileCode = await loadServerProfileCode();
    [receipts, views] = await Promise.all([loadServerStaffReceipts(), loadServerInvoices()]);
  } catch {
    return (
      <div className={styles.page}>
        <p className={styles.back}>
          <Link prefetch={false} className="link-arrow" href={backHref}>
            ← Payments
          </Link>
        </p>
        <ErrorPanel title="This receipt could not be loaded." note="No ledger record was changed. Try again.">
          <RetryButton />
        </ErrorPanel>
      </div>
    );
  }

  const receipt = receipts.find((candidate) => candidate.ref === receiptRef);
  const view = receipt ? views.find((candidate) => candidate.invoice.ref === receipt.invoiceRef) : undefined;
  if (receipt === undefined || view === undefined) {
    return (
      <div className={styles.page}>
        <p className={styles.back}>
          <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/finance/payments")}>
            ← Payments
          </Link>
        </p>
        <h1 className="workspace-title">Receipt not found</h1>
        <p className="workspace-intro">
          No receipt in the authorized register carries the reference <span className="num">{receiptRef}</span>.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <p className={styles.back}>
        <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/finance/payments")}>
          ← Payments
        </Link>
      </p>
      <ReceiptPanel receipt={receipt} invoice={view.invoice} studentName={view.studentName} />
    </div>
  );
}
