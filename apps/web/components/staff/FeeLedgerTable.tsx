"use client";

import { useState } from "react";
import { formatINR, INVOICE_STATUS_META, type InvoiceStatus } from "@/modules/services/finance";
import { formatKolkata } from "@/modules/iot/domain";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { InvoiceLines } from "@/components/staff/InvoiceLines";
import type { InvoiceView } from "@/modules/services/finance";

import styles from "./FeeLedgerTable.module.css";

type FilterKey = "all" | InvoiceStatus;

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "partial", label: "Partial" },
  { key: "unpaid", label: "Unpaid" },
];

const GROUP_ORDER: ReadonlyArray<InvoiceStatus> = ["paid", "partial", "unpaid", "overdue"];

/**
 * Staff fee ledger: status tabs over the ledger views served by
 * financeService, with expandable line items per invoice. The "All" tab
 * groups rows by ledger state, the way an accounts office would run its
 * register. Views carry live totals and the owning student, so parent and
 * staff balances agree.
 */
export function FeeLedgerTable({
  views,
  mode = "demo",
}: {
  views: ReadonlyArray<InvoiceView>;
  mode?: "demo" | "supabase";
}) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const visible = filter === "all" ? views : views.filter((view) => view.status === filter);
  const groups =
    filter === "all"
      ? GROUP_ORDER.map((status) => ({
          status,
          rows: views.filter((view) => view.status === status),
        })).filter((group) => group.rows.length > 0)
      : null;

  return (
    <section aria-labelledby="ledger-heading">
      <div className={styles.sectionHead}>
        <h2 id="ledger-heading" className="section-label">
          Term ledger
        </h2>
        <span className="demo-badge">{mode === "supabase" ? "Authoritative ledger" : "Demo data"}</span>
      </div>

      <div className="tabs" role="group" aria-label="Filter invoices by status">
        {FILTERS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={filter === tab.key ? "active" : undefined}
            aria-pressed={filter === tab.key}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className={styles.empty}>No invoices in this state.</p>
      ) : (
        <div className="table--scroll">
          <table className={`table ${styles.ledgerTable}`}>
            <thead>
              <tr>
                <th scope="col">Ref</th>
                <th scope="col">Student</th>
                <th scope="col">Term</th>
                <th scope="col" className="num">Issued</th>
                <th scope="col" className="num">Due</th>
                <th scope="col" className="num">Total</th>
                <th scope="col" className="num">Paid</th>
                <th scope="col" className="num">Balance</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {groups
                ? groups.map((group) => (
                    <InvoiceRows key={group.status} invoices={group.rows} groupLabel={INVOICE_STATUS_META[group.status].label} />
                  ))
                : <InvoiceRows invoices={visible} />}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InvoiceRows({
  invoices,
  groupLabel,
}: {
  invoices: ReadonlyArray<InvoiceView>;
  groupLabel?: string;
}) {
  return (
    <>
      {groupLabel && (
        <tr className={styles.groupRow}>
          <td colSpan={9} className={styles.groupCell}>
            <span className="section-label">{groupLabel}</span>
            <span className={styles.groupCount}>
              {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
            </span>
          </td>
        </tr>
      )}
      {invoices.map((view) => (
        <tr key={view.invoice.ref}>
          <td>
            <InvoiceLines invoice={view.invoice} />
          </td>
          <td>{view.studentName}</td>
          <td>{view.invoice.term}</td>
          <td className="num">{formatKolkata(view.invoice.issuedAtIso, { format: "day" })}</td>
          <td className="num">{formatKolkata(view.invoice.dueAtIso, { format: "day" })}</td>
          <td className="num">{formatINR(view.totalPaise)}</td>
          <td className="num">{formatINR(view.paidPaise)}</td>
          <td className="num">{formatINR(view.balancePaise)}</td>
          <td>
            <StatusBadge tone={INVOICE_STATUS_META[view.status].tone}>{INVOICE_STATUS_META[view.status].label}</StatusBadge>
          </td>
        </tr>
      ))}
    </>
  );
}
