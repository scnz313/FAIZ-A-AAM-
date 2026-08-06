"use client";

import { useEffect, useRef, useState } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { gradeSectionLabel } from "@/modules/services/family-context";
import { FINANCE_DEMO_NOTE, formatINR, INVOICE_STATUS_META } from "@/modules/finance/demo";
import { demoTodayLabel } from "@/modules/demo/clock";
import { formatKolkata } from "@/modules/iot/domain";
import { financeService, type InvoiceView } from "@/modules/services/finance";

import styles from "./page.module.css";

export type LedgerFilter = "all" | "unpaid" | "paid";

type FeeLedgerProps = {
  /** Ledger views read through the adapter on the server (fixtures by default). */
  initial: InvoiceView[];
  initialFilter: LedgerFilter;
};

const TABS: ReadonlyArray<{ key: LedgerFilter; label: string; href: string }> = [
  { key: "all", label: "All", href: "/portal/fees" },
  { key: "unpaid", label: "Unpaid", href: "/portal/fees?status=unpaid" },
  { key: "paid", label: "Paid", href: "/portal/fees?status=paid" },
];

function filterViews(views: InvoiceView[], filter: LedgerFilter): InvoiceView[] {
  switch (filter) {
    case "paid":
      return views.filter((view) => view.balancePaise === 0);
    case "unpaid":
      return views.filter((view) => view.balancePaise > 0);
    default:
      return views;
  }
}

/**
 * Client island for the fee ledger. Re-reads the adapter on mount (and on
 * child switch) so the active student's session payments — posted from an
 * invoice page — appear in the per-invoice Paid and Balance columns and the
 * summary after navigation. The server `initial` prop stays Aarif's default
 * for first paint; the provider resolves the real active child.
 */
export function FeeLedger({ initial, initialFilter }: FeeLedgerProps) {
  const [views, setViews] = useState<InvoiceView[]>(initial);
  const [filter, setFilter] = useState<LedgerFilter>(initialFilter);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementNotice, setStatementNotice] = useState("");
  const statementPreviewRef = useRef<HTMLElement>(null);
  const { activeStudent } = useFamilyContext();
  const activeStudentId = activeStudent?.student.id;
  const studentLine = activeStudent
    ? `${activeStudent.student.displayName} · ${gradeSectionLabel(activeStudent.gradeSection)}`
    : null;

  useEffect(() => {
    if (statementOpen) statementPreviewRef.current?.focus();
  }, [statementOpen]);

  // Tab navigation (a real URL change) re-renders the server page; keep the
  // client filter in step with the URL.
  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  // The active-child ledger. Skipped until the provider resolves so the
  // server-rendered initial (Aarif) covers first paint; child switches reload.
  useEffect(() => {
    if (activeStudentId === undefined) return;
    let cancelled = false;
    void financeService.listInvoices(activeStudentId).then((next) => {
      if (!cancelled) setViews(next);
    });
    return () => {
      cancelled = true;
    };
  }, [activeStudentId]);

  const visible = filterViews(views, filter);
  const outstanding = views.filter((view) => view.balancePaise > 0);

  /** The invoice the pay button leads to: the first unpaid one, earliest due date first. */
  const firstUnpaid =
    views
      .filter((view) => view.status === "unpaid" || view.status === "overdue")
      .sort((a, b) => a.invoice.dueAtIso.localeCompare(b.invoice.dueAtIso))[0] ??
    views.find((view) => view.balancePaise > 0);

  const totalOutstanding = outstanding.reduce((sum, view) => sum + view.balancePaise, 0);
  const concessionTotal = views.reduce(
    (sum, view) =>
      sum +
      view.invoice.items
        .filter((item) => item.kind === "concession")
        .reduce((sub, item) => sub + item.amountPaise, 0),
    0,
  );
  const statementTotal = visible.reduce((sum, view) => sum + view.totalPaise, 0);
  const statementPaid = visible.reduce((sum, view) => sum + view.paidPaise, 0);
  const statementBalance = visible.reduce((sum, view) => sum + view.balancePaise, 0);
  const statementFilterLabel =
    filter === "all" ? "All invoices" : filter === "paid" ? "Paid invoices" : "Unpaid invoices";

  function openStatement(): void {
    setStatementOpen(true);
    setStatementNotice("Printable statement preview opened. Review the demo statement, then choose Print statement.");
  }

  function printStatement(): void {
    setStatementNotice("Print dialog opened for the demo statement. The browser can save this preview as a PDF.");
    window.print();
  }

  function closeStatement(): void {
    setStatementOpen(false);
    setStatementNotice("Printable statement preview closed.");
  }

  return (
    <>
      <div className={styles.feeLayout}>
      <section className={styles.feeSummary} aria-labelledby="fee-summary-title">
        <p className="section-label section-label--on-ink">Current balance</p>
        <div className={styles.balanceLine}>
          <h2 id="fee-summary-title" className={`num ${styles.bigAmount}`}>
            {formatINR(totalOutstanding)}
          </h2>
          <StatusBadge tone="watch">Due</StatusBadge>
        </div>
        <p className={styles.summaryMuted}>
          Outstanding across {outstanding.length} invoices. Concessions already applied.
        </p>
        <div className={styles.amountRule} aria-hidden="true" />
        <dl className={styles.feeBreakdown}>
          {outstanding.map((view) => (
            <div key={view.invoice.ref}>
              <dt>
                {view.invoice.term} · {view.invoice.ref}
              </dt>
              <dd className="num">{formatINR(view.balancePaise)}</dd>
            </div>
          ))}
          <div className={styles.concession}>
            <dt>Merit concession — 10% of tuition</dt>
            <dd className="num">{formatINR(concessionTotal)}</dd>
          </div>
        </dl>
        {firstUnpaid ? (
          <Button href={`/portal/fees/${firstUnpaid.invoice.ref}`} variant="saffron" block>
            Pay {formatINR(firstUnpaid.balancePaise)} →
          </Button>
        ) : null}
        <p className={styles.paymentNote}>
          <span aria-hidden="true">✓</span> Secure checkout — UPI Intent/QR, cards and net banking. The school
          never stores card or UPI credentials.
        </p>
      </section>

      <section className={styles.ledgerPanel} aria-labelledby="ledger-title">
        <div className={styles.ledgerHeading}>
          <div>
            <p className="section-label">Account history</p>
            <h2 id="ledger-title" className={styles.ledgerTitle}>
              Fee ledger
            </h2>
          </div>
        </div>

        <div className={styles.ledgerTabs} role="group" aria-label="Filter the ledger by invoice status">
          {TABS.map((tab) => {
            const active = filter === tab.key;
            return (
              <a
                key={tab.key}
                href={tab.href}
                className={active ? styles.active : undefined}
                aria-current={active ? "true" : undefined}
              >
                {tab.label}
              </a>
            );
          })}
        </div>

        <div className="table--scroll">
          <table className={`table ${styles.ledgerTable}`}>
            <caption className="sr-only">Fee ledger with reference, term, totals and status</caption>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Term</th>
                <th scope="col" className="num">Total</th>
                <th scope="col" className="num">Paid</th>
                <th scope="col" className="num">Balance</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.emptyState}>
                    No invoices in this view.
                  </td>
                </tr>
              ) : (
                visible.map((view) => (
                  <tr key={view.invoice.ref}>
                    <td>
                      <a className={styles.rowLink} href={`/portal/fees/${view.invoice.ref}`}>
                        <strong className="num">{view.invoice.ref}</strong>
                      </a>
                    </td>
                    <td className={styles.desc}>
                      <strong>{view.invoice.term}</strong>
                      <small>
                        Issued {formatKolkata(view.invoice.issuedAtIso, { format: "day" })} · Due{" "}
                        {formatKolkata(view.invoice.dueAtIso, { format: "day" })}
                      </small>
                    </td>
                    <td className={`num ${styles.cell} ${styles.hideSmall}`}>{formatINR(view.totalPaise)}</td>
                    <td className={`num ${styles.cell} ${styles.hideSmall}`}>{formatINR(view.paidPaise)}</td>
                    <td className={`num ${styles.cell} ${styles.balanceCell}`}>{formatINR(view.balancePaise)}</td>
                    <td>
                      <StatusBadge tone={INVOICE_STATUS_META[view.status].tone}>
                        {INVOICE_STATUS_META[view.status].label}
                      </StatusBadge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.ledgerFoot}>
          <p>Partial payments are allowed per school policy. Showing academic year 2026–27.</p>
          <span className={styles.statement}>
            <button
              type="button"
              className="button button--quiet button--small"
              aria-controls="statement-preview"
              aria-describedby="statement-demo-note"
              aria-expanded={statementOpen}
              onClick={openStatement}
            >
              ↓ Statement (PDF) — demo
            </button>
            <span id="statement-demo-note" className="sr-only">
              Opens an on-page demo statement preview. No file is generated; use Print statement to open the browser print dialog.
            </span>
          </span>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {statementNotice}
        </p>
      </section>
    </div>

      {statementOpen ? (
        <section
          ref={statementPreviewRef}
          id="statement-preview"
          className={styles.statementPreview}
          aria-labelledby="statement-preview-title"
          tabIndex={-1}
        >
          <div className={styles.statementHeader}>
            <div>
              <p className="section-label">Printable statement · demo</p>
              <h2 id="statement-preview-title" className={styles.statementTitle}>
                Fee statement
              </h2>
            </div>
            <div className={styles.statementActions}>
              <button type="button" className="button button--quiet button--small" onClick={printStatement}>
                Print statement — demo
              </button>
              <button type="button" className="button button--quiet button--small" onClick={closeStatement}>
                Close preview
              </button>
            </div>
          </div>

          <p className={styles.statementNote}>
            {FINANCE_DEMO_NOTE} This preview represents the linked student&apos;s {statementFilterLabel.toLowerCase()} view.
          </p>

          <dl className={styles.statementMeta}>
            <div>
              <dt>Student</dt>
              <dd>{studentLine ?? "Loading linked student…"}</dd>
            </div>
            <div>
              <dt>Academic year</dt>
              <dd>2026–27</dd>
            </div>
            <div>
              <dt>Prepared</dt>
              <dd>{demoTodayLabel()}</dd>
            </div>
            <div>
              <dt>Ledger view</dt>
              <dd>{statementFilterLabel}</dd>
            </div>
          </dl>

          <div className="table--scroll">
            <table className={`table ${styles.statementTable}`}>
              <caption className="sr-only">Printable fee statement for the linked demo student</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Term</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">Paid</th>
                  <th scope="col" className="num">Balance</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyState}>
                      No invoices in this view.
                    </td>
                  </tr>
                ) : (
                  visible.map((view) => (
                    <tr key={view.invoice.ref}>
                      <td className="num">{view.invoice.ref}</td>
                      <td>{view.invoice.term}</td>
                      <td className="num">{formatINR(view.totalPaise)}</td>
                      <td className="num">{formatINR(view.paidPaise)}</td>
                      <td className="num">{formatINR(view.balancePaise)}</td>
                      <td>{INVOICE_STATUS_META[view.status].label}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>View total</th>
                  <td className="num">{formatINR(statementTotal)}</td>
                  <td className="num">{formatINR(statementPaid)}</td>
                  <td className="num">{formatINR(statementBalance)}</td>
                  <td>—</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className={styles.statementFooter}>
            Demo print view only. Official statements and PDF generation require the finance backend.
          </p>
        </section>
      ) : null}
    </>
  );
}
