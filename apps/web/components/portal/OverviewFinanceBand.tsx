"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatINR } from "@/modules/services/finance";
import { academicsService } from "@/modules/services/academics";
import { financeService, type InvoiceView } from "@/modules/services/finance";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";

/** Class names come from the page's CSS module so one style sheet stays authoritative. */
export type OverviewFinanceBandClassNames = {
  band?: string;
  badge?: string;
  grid?: string;
  col?: string;
  bigNum?: string;
  detail?: string;
  bigLine?: string;
};

/** One small retry control shared by the band's independent reads. */
function BandRetry({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onClick}>
      {label}
    </button>
  );
}

/**
 * Client island for the overview account summary: the ledger reads through
 * financeService for the ACTIVE child, so switching children updates the
 * amount due, due date, and outstanding count together. Each read has its
 * own loading, honest empty/no-publication, and error-with-retry state; a
 * failed read never stays a permanent loading line and stale values from a
 * previous child are cleared the moment the active child changes.
 */
export function OverviewFinanceBand({ classNames = {} }: { classNames?: OverviewFinanceBandClassNames }) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const { activeStudent, status: contextStatus, retry: retryContext } = useFamilyContext();
  const [views, setViews] = useState<InvoiceView[] | null>(null);
  const [ledgerError, setLedgerError] = useState(false);
  const [ledgerReload, setLedgerReload] = useState(0);
  const [latestTerm, setLatestTerm] = useState<string | null | undefined>(undefined);
  const [latestTermError, setLatestTermError] = useState(false);
  const [termReload, setTermReload] = useState(0);
  const studentId = activeStudent?.student.id;
  const studentRef = activeStudent?.student.ref;
  const academicYearId = activeStudent?.academicYear.id;

  useEffect(() => {
    if (studentId === undefined) {
      setViews(null);
      setLedgerError(false);
      return;
    }
    let cancelled = false;
    /* Clear the outgoing child's figures immediately so nothing from the
       previous child is shown while the new ledger loads. */
    setViews(null);
    setLedgerError(false);
    void financeService
      .listInvoices(studentId)
      .then((next) => {
        if (!cancelled) setViews(next);
      })
      .catch(() => {
        if (!cancelled) {
          setViews([]);
          setLedgerError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, ledgerReload]);

  /* The latest published term for the ACTIVE child — never a hard-coded
     label that survives a child switch. null means "nothing published". */
  useEffect(() => {
    if (studentRef === undefined || academicYearId === undefined) {
      setLatestTerm(undefined);
      setLatestTermError(false);
      return;
    }
    let cancelled = false;
    setLatestTerm(undefined);
    setLatestTermError(false);
    void academicsService
      .getStudentResultSnapshot(studentRef, academicYearId)
      .then((snapshot) => {
        if (cancelled) return;
        if (snapshot === null) {
          setLatestTerm(null);
          return;
        }
        const termsWithRows = Object.keys(snapshot.terms).filter((label) => (snapshot.terms[label] ?? []).length > 0);
        setLatestTerm(termsWithRows.length > 0 ? termsWithRows[termsWithRows.length - 1] : null);
      })
      .catch(() => {
        if (!cancelled) {
          setLatestTerm(null);
          setLatestTermError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studentRef, academicYearId, termReload]);

  const contextError = contextStatus === "error";
  const loading = contextStatus === "loading";
  const ledgerLoading = loading || views === null;
  const amountDue = (views ?? []).reduce((sum, view) => sum + view.balancePaise, 0);
  const outstandingCount = (views ?? []).filter((view) => view.balancePaise > 0).length;
  const nextInvoice = [...(views ?? [])]
    .filter((view) => view.status === "unpaid" || view.status === "overdue")
    .sort((a, b) => a.invoice.dueAtIso.localeCompare(b.invoice.dueAtIso))[0];
  const ledgerFailed = contextError || ledgerError;
  const termFailed = contextError || latestTermError;

  return (
    <div className={classNames.band} aria-label="Account summary">
      <span className={`demo-badge ${classNames.badge ?? ""}`}>{supabaseMode ? "Live ledger projection" : "Demo data · fictional fees"}</span>

      <div className={classNames.grid}>
        <section className={classNames.col}>
          <p className="section-label">Amount due</p>
          <p className={`num ${classNames.bigNum ?? ""}`}>{ledgerLoading ? "…" : formatINR(amountDue)}</p>
          <p className={classNames.detail}>
            {ledgerFailed ? (
              <span className="small muted">Ledger unavailable</span>
            ) : (
              <StatusBadge tone={amountDue > 0 ? "watch" : "good"}>{amountDue > 0 ? "Due" : "Clear"}</StatusBadge>
            )}
          </p>
          <p className={classNames.detail}>
            {ledgerLoading
              ? "Loading ledger…"
              : ledgerFailed
                ? <BandRetry label="Try again" onClick={() => { if (contextError) retryContext(); else setLedgerReload((key) => key + 1); }} />
                : `${outstandingCount} invoice${outstandingCount === 1 ? "" : "s"} outstanding`}
          </p>
        </section>

        <section className={classNames.col}>
          <p className="section-label">Next due date</p>
          <p className={classNames.bigLine}>
            <span className={`num ${classNames.bigNum ?? ""}`}>
              {ledgerLoading ? "…" : nextInvoice ? formatKolkata(nextInvoice.invoice.dueAtIso, { format: "day" }) : "—"}
            </span>
          </p>
          <p className={classNames.detail}>
            {ledgerLoading
              ? "Loading ledger…"
              : ledgerFailed
                ? "Ledger unavailable"
                : nextInvoice
                  ? `${nextInvoice.invoice.term} · ${nextInvoice.invoice.ref}`
                  : "Nothing due"}
          </p>
        </section>

        <section className={classNames.col}>
          <p className="section-label">Latest result</p>
          <p className={`num ${classNames.bigNum ?? ""}`}>
            {loading || latestTerm === undefined ? "…" : (latestTerm ?? "—")}
          </p>
          <p className={classNames.detail}>
            {termFailed ? (
              <BandRetry label="Try again" onClick={() => { if (contextError) retryContext(); else setTermReload((key) => key + 1); }} />
            ) : loading || latestTerm === undefined ? (
              "Checking published reports…"
            ) : latestTerm === null ? (
              "No published report yet"
            ) : (
              <Link className="link-arrow" href="/portal/results" prefetch={false}>
                Published · view results →
              </Link>
            )}
          </p>
        </section>
      </div>
    </div>
  );
}

export default OverviewFinanceBand;
