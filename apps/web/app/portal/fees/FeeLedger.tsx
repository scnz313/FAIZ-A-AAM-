"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { gradeSectionLabel } from "@/modules/services/family-context";
import { FINANCE_DEMO_NOTE, formatINR, INVOICE_STATUS_META } from "@/modules/services/finance";
import { demoTodayLabel } from "@/modules/demo/clock";
import { formatKolkata } from "@/modules/iot/domain";
import { financeService, type InvoiceView } from "@/modules/services/finance";
import { clientAdapterMode } from "@/modules/services/adapter-client";

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
 * Client island for the fee ledger. Demo mode re-reads the adapter on mount,
 * and both modes reload on child switch so session payments posted from an
 * invoice page appear in the per-invoice Paid and Balance columns and the
 * summary after navigation. The server `initial` prop covers first paint.
 */
export function FeeLedger({ initial, initialFilter }: FeeLedgerProps) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const [views, setViews] = useState<InvoiceView[]>(initial);
  const [filter, setFilter] = useState<LedgerFilter>(initialFilter);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementNotice, setStatementNotice] = useState("");
  const statementPreviewRef = useRef<HTMLElement>(null);
  const statementTriggerRef = useRef<HTMLButtonElement>(null);
  const { activeStudent } = useFamilyContext();
  const activeStudentId = activeStudent?.student.id;
  const previousStudentId = useRef(activeStudentId);
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

  // The active-child ledger. Skipped until the provider resolves; the
  // authoritative server initial covers Supabase first paint, while demo
  // mount refreshes and child switches reload through the client service.
  useEffect(() => {
    if (activeStudentId === undefined) return;
    const sameStudent = previousStudentId.current === activeStudentId;
    previousStudentId.current = activeStudentId;
    if (supabaseMode && sameStudent) {
      setViews(initial);
      return;
    }
    let cancelled = false;
    void financeService
      .listInvoices(activeStudentId)
      .then((next) => {
        if (!cancelled) setViews(next);
      })
      .catch(() => {
        if (!cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [activeStudentId, initial, supabaseMode]);

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
    /* Return focus to the disclosure trigger so keyboard users are not
       dropped at the top of the document. */
    statementTriggerRef.current?.focus();
  }

  /** Empty-state copy names the view and the next step, never just "empty". */
  const emptyLine =
    filter === "paid"
      ? "No paid invoices yet — receipts appear here after your first payment."
      : filter === "unpaid"
        ? "Nothing outstanding — every invoice in this ledger is settled."
        : "No invoices have been issued for this student yet. New term invoices appear here.";

  return (
    <>
      <div className={styles.feeLayout}>
      <section className={styles.feeSummary} aria-labelledby="fee-summary-title">
        <p className="section-label section-label--on-ink">Current balance</p>
        <div className={styles.balanceLine}>
          <h2 id="fee-summary-title" className={`num ${styles.bigAmount}`}>
            {formatINR(totalOutstanding)}
          </h2>
          <StatusBadge tone={totalOutstanding > 0 ? "watch" : "good"}>
            {totalOutstanding > 0 ? "Due" : "Clear"}
          </StatusBadge>
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
              <Link prefetch={false}
                key={tab.key}
                href={tab.href}
                className={active ? styles.active : undefined}
                aria-current={active ? "true" : undefined}
              >
                {tab.label}
              </Link>
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
                <th scope="col" className={`num ${styles.numHead}`}>Total</th>
                <th scope="col" className={`num ${styles.numHead}`}>Paid</th>
                <th scope="col" className={`num ${styles.numHead}`}>Balance</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.emptyState}>
                    {emptyLine}
                  </td>
                </tr>
              ) : (
                visible.map((view) => (
                  <tr key={view.invoice.ref}>
                    <td>
                      <Link prefetch={false} className={styles.rowLink} href={`/portal/fees/${view.invoice.ref}`}>
                        <strong className="num">{view.invoice.ref}</strong>
                      </Link>
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
                ref={statementTriggerRef}
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
              <p className="section-label">Printable statement · {supabaseMode ? "ledger projection" : "demo"}</p>
              <h2 id="statement-preview-title" className={styles.statementTitle}>
                Fee statement
              </h2>
            </div>
            <div className={styles.statementActions}>
              <button type="button" className="button button--quiet button--small" onClick={printStatement}>
                Print statement{!supabaseMode ? " — demo" : ""}
              </button>
              <button type="button" className="button button--quiet button--small" onClick={closeStatement}>
                Close preview
              </button>
            </div>
          </div>

          <p className={styles.statementNote}>
            {supabaseMode ? "Authoritative ledger projection for the linked student." : `${FINANCE_DEMO_NOTE} This preview represents the linked student&apos;s ${statementFilterLabel.toLowerCase()} view.`}
          </p>

          <dl className={styles.statementMeta}>
            <div>
              <dt>Student</dt>
              <dd>{studentLine ?? "Loading linked student…"}</dd>
            </div>
            <div>
              <dt>Academic year</dt>
              <dd>{activeStudent?.academicYear.label ?? "Not configured"}</dd>
            </div>
            <div>
              <dt>Prepared</dt>
              <dd>{supabaseMode ? formatKolkata(new Date().toISOString(), { format: "day" }) : demoTodayLabel()}</dd>
            </div>
            <div>
              <dt>Ledger view</dt>
              <dd>{statementFilterLabel}</dd>
            </div>
          </dl>

          <div className="table--scroll">
            <table className={`table ${styles.statementTable}`}>
            <caption className="sr-only">Printable fee statement for the linked student</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Term</th>
                  <th scope="col" className={`num ${styles.numHead}`}>Total</th>
                  <th scope="col" className={`num ${styles.numHead}`}>Paid</th>
                  <th scope="col" className={`num ${styles.numHead}`}>Balance</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyState}>
                      {emptyLine}
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
            {supabaseMode ? "This view prints the current ledger projection; official PDF generation remains a backend capability." : "Demo print view only. Official statements and PDF generation require the finance backend."}
          </p>
        </section>
      ) : null}
    </>
  );
}
