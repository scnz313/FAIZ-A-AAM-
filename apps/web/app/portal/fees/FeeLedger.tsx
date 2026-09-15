"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import { ErrorPanel } from "@/components/ui/AsyncStates";
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
 * Client island for the fee ledger. V14 layout: a row-between summary
 * (Balance | Next due | Concessions) with a seg filter, then a full-width
 * Panel with a flush ledger table. Demo mode re-reads the adapter on mount,
 * and both modes reload on child switch so session payments posted from an
 * invoice page appear in the per-invoice Paid and Balance columns and the
 * summary after navigation. The server `initial` prop covers first paint.
 */
export function FeeLedger({ initial, initialFilter }: FeeLedgerProps) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const router = useRouter();
  const [views, setViews] = useState<InvoiceView[]>(initial);
  const [filter, setFilter] = useState<LedgerFilter>(initialFilter);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementNotice, setStatementNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
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
  // A failed reload for a *newly selected* child never leaves the previous
  // child's rows on screen: the ledger is replaced by a retryable error panel.
  // A failed mount refresh keeps the authoritative server initial.
  useEffect(() => {
    if (activeStudentId === undefined) return;
    const previous = previousStudentId.current;
    const firstRun = previous === undefined;
    const sameStudent = previous === activeStudentId;
    const retrying = reloadToken > 0;
    previousStudentId.current = activeStudentId;
    if (supabaseMode && sameStudent && !retrying) {
      setViews(initial);
      setLoadError(false);
      return;
    }
    let cancelled = false;
    setLoadError(false);
    void financeService
      .listInvoices(activeStudentId)
      .then((next) => {
        if (!cancelled) setViews(next);
      })
      .catch(() => {
        if (!cancelled && !firstRun) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStudentId, initial, supabaseMode, reloadToken]);

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
        .reduce((sub, item) => sub + item.amountPaise, 0) +
      (view.ledgerEntries ?? [])
        .filter((entry) => entry.kind === "concession")
        .reduce((sub, entry) => sub + Math.abs(entry.amountPaise), 0),
    0,
  );
  const statementTotal = visible.reduce((sum, view) => sum + view.totalPaise, 0);
  const statementPaid = visible.reduce((sum, view) => sum + view.paidPaise, 0);
  const statementBalance = visible.reduce((sum, view) => sum + view.balancePaise, 0);
  const statementFilterLabel =
    filter === "all" ? "All invoices" : filter === "paid" ? "Paid invoices" : "Unpaid invoices";

  function openStatement(): void {
    setStatementOpen(true);
    setStatementNotice(
      supabaseMode
        ? "Printable statement preview opened. Review the ledger view, then choose Print statement."
        : "Printable statement preview opened. Review the demo statement, then choose Print statement.",
    );
  }

  function printStatement(): void {
    setStatementNotice(
      supabaseMode
        ? "Print dialog opened for this statement. The browser can save the preview as a PDF."
        : "Print dialog opened for the demo statement. The browser can save this preview as a PDF.",
    );
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
    views.length === 0
      ? "No invoices have been issued for this student yet. New term invoices appear here."
      : filter === "paid"
        ? "No paid invoices yet · receipts appear here after your first payment."
        : filter === "unpaid"
          ? "Nothing outstanding · every invoice in this ledger is settled."
          : "No invoices have been issued for this student yet. New term invoices appear here.";
  /* The heading must not blame a filter when the ledger itself is empty, and
     "Show all invoices" is a dead control while the "All" view is active. */
  const emptyTitle = views.length === 0 ? "No invoices yet" : "No invoices match this filter";

  const nextDueLabel = firstUnpaid
    ? formatKolkata(firstUnpaid.invoice.dueAtIso, { format: "day" })
    : "None";

  /* A failed reload must never leave the previous child's ledger on screen
     under the new child's name. */
  if (loadError) {
    return (
      <ErrorPanel
        title="The fee ledger could not be loaded"
        note="The finance service did not respond. No record was changed; the last confirmed ledger is untouched."
      >
        <Button variant="quiet" type="button" onClick={() => setReloadToken((token) => token + 1)}>
          Try again
        </Button>
      </ErrorPanel>
    );
  }

  return (
    <>
      {/* V14 row-between summary: Balance | Next due | Concessions + seg filter */}
      <div className={styles.summaryRow}>
        <div className={styles.summaryStats}>
          <div className={styles.summaryStat}>
            <div className="label">Balance</div>
            <div className={`serif num ${styles.summaryBigNum}`}>
              {formatINR(totalOutstanding)}
            </div>
          </div>
          <div className={styles.summaryStat}>
            <div className="label">Next due</div>
            <div className={`strong num ${styles.summaryMed}`}>{nextDueLabel}</div>
          </div>
          <div className={styles.summaryStat}>
            <div className="label">Concessions</div>
            <div className={`strong ${styles.summaryMed}`}>
              {concessionTotal > 0 ? formatINR(concessionTotal) : "None"}
            </div>
          </div>
        </div>
        <div className={styles.segWrap}>
          <div className="seg" role="tablist" aria-label="Filter invoices">
            {TABS.map((tab) => {
              const active = filter === tab.key;
              return (
                <Link
                  prefetch={false}
                  key={tab.key}
                  href={tab.href}
                  className={active ? "on" : undefined}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(tab.key)}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* V14 Panel with flush ledger table */}
      {visible.length === 0 ? (
        <section className={`panel ${styles.ledgerPanel}`}>
          <div className="pn-body">
            <div style={{ textAlign: "center", padding: "42px 18px" }}>
              <div className="empty-ill" style={{ margin: "0 auto 12px" }}>
                <span className="msym" style={{ fontSize: 26 }}>filter_alt</span>
              </div>
              <div className="strong" style={{ fontSize: "1.02rem" }}>{emptyTitle}</div>
              <p className="muted small" style={{ margin: "6px auto 14px", maxWidth: 340 }}>{emptyLine}</p>
              {views.length > 0 && filter !== "all" ? (
                <Link
                  prefetch={false}
                  className="btn btn-ghost btn-sm"
                  href="/portal/fees"
                  onClick={() => setFilter("all")}
                >
                  Show all invoices
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section className={`panel ${styles.ledgerPanel}`}>
          <div className="pn-body flush">
            <div className="table-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Period</th>
                    <th>Due</th>
                    <th className="num">Amount</th>
                    <th className="num">Paid</th>
                    <th className="num">Balance</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((view) => (
                    <tr
                      key={view.invoice.ref}
                      className="click"
                      title="Open invoice"
                      onClick={(event) => {
                        /* The inner links are the keyboard path; the row click
                           matches the V15 ledger affordance. */
                        if ((event.target as HTMLElement).closest("a, button")) return;
                        router.push(`/portal/fees/${view.invoice.ref}`);
                      }}
                    >
                      <td>
                        <Link prefetch={false} className={styles.rowLink} href={`/portal/fees/${view.invoice.ref}`}>
                          <strong className="num">{view.invoice.ref}</strong>
                        </Link>
                      </td>
                      <td className="small">
                        {view.invoice.term}
                        <div className="tiny muted">
                          Issued {formatKolkata(view.invoice.issuedAtIso, { format: "day" })}
                        </div>
                      </td>
                      <td className="num small">{formatKolkata(view.invoice.dueAtIso, { format: "day" })}</td>
                      <td className="num">{formatINR(view.totalPaise)}</td>
                      <td className="num muted">{formatINR(view.paidPaise)}</td>
                      <td className="num strong">{formatINR(view.balancePaise)}</td>
                      <td>
                        <StatusBadge tone={INVOICE_STATUS_META[view.status].tone}>
                          {INVOICE_STATUS_META[view.status].label}
                        </StatusBadge>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {view.balancePaise > 0 ? (
                          <Button href={`/portal/fees/${view.invoice.ref}`} variant="saffron">
                            Pay
                          </Button>
                        ) : (
                          <Link
                            prefetch={false}
                            className="btn btn-ghost btn-sm"
                            href={`/portal/fees/${view.invoice.ref}`}
                          >
                            Receipt
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <div style={{ marginTop: 18 }} className={styles.ledgerCallout}>
        <div className="callout">
          <span className="msym" style={{ fontSize: 20, flex: "none", marginTop: 1, color: "var(--ink-3)" }}>info</span>
          <span className="small">
            Concessions appear as their own invoice line, never as a cash adjustment.
            The printable statement shows every invoice, payment and concession for the whole year.
          </span>
        </div>
      </div>

      <div className={styles.ledgerFoot}>
        <p>Partial payments are allowed per school policy. Showing academic year 2026–27.</p>
        <span className={styles.statement}>
          <button
            type="button"
            ref={statementTriggerRef}
            className="btn btn-ghost btn-sm"
            aria-controls="statement-preview"
            aria-describedby="statement-demo-note"
            aria-expanded={statementOpen}
            onClick={openStatement}
          >
            <span className="msym" style={{ fontSize: 16 }}>receipt_long</span> Download statement
          </button>
          <span className={styles.statementHint}>
            {supabaseMode
              ? "Printable preview · no file is generated"
              : "Printable demo preview · no file is generated"}
          </span>
          <span id="statement-demo-note" className="sr-only">
            Opens an on-page statement preview. No file is generated; use Print statement to open the browser print dialog.
          </span>
        </span>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {statementNotice}
      </p>

      {firstUnpaid ? (
        <div style={{ marginTop: 18 }} className={styles.payAction}>
          <Button href={`/portal/fees/${firstUnpaid.invoice.ref}`} variant="saffron" block>
            Pay {formatINR(firstUnpaid.balancePaise)} →
          </Button>
        </div>
      ) : null}

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
              <p className="section-label">Faiz E Aam Secondary School · Bandipora</p>
              <h2 id="statement-preview-title" className={styles.statementTitle}>
                Fee statement
              </h2>
            </div>
            <div className={styles.statementActions}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={printStatement}>
                Print statement{!supabaseMode ? " · demo" : ""}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={closeStatement}>
                Close preview
              </button>
            </div>
          </div>

          <p className={styles.statementNote}>
            {supabaseMode ? "Authoritative ledger projection for the linked student." : `${FINANCE_DEMO_NOTE} This preview represents the linked student's ${statementFilterLabel.toLowerCase()} view.`}
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

          <div className="table-wrap">
            <table className="ledger">
              <caption className="sr-only">Printable fee statement for the linked student</caption>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Term</th>
                  <th className="num">Total</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
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
