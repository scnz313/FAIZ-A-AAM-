"use client";

import { useEffect, useState } from "react";

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

/**
 * Client island for the overview account summary: the ledger reads through
 * financeService for the ACTIVE child, so switching children updates the
 * amount due, due date, and outstanding count together.
 */
export function OverviewFinanceBand({ classNames = {} }: { classNames?: OverviewFinanceBandClassNames }) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const { activeStudent } = useFamilyContext();
  const [views, setViews] = useState<InvoiceView[] | null>(null);
  const studentId = activeStudent?.student.id;
  const studentRef = activeStudent?.student.ref;
  const academicYearId = activeStudent?.academicYear.id;

  useEffect(() => {
    if (studentId === undefined) return;
    let cancelled = false;
    void financeService
      .listInvoices(studentId)
      .then((next) => {
        if (!cancelled) setViews(next);
      })
      .catch(() => {
        if (!cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  /* The latest published term for the ACTIVE child — never a hard-coded
     label that survives a child switch. null means "nothing published". */
  const [latestTerm, setLatestTerm] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (studentRef === undefined || academicYearId === undefined) return;
    let cancelled = false;
    setLatestTerm(undefined);
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
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [studentRef, academicYearId]);

  const amountDue = (views ?? []).reduce((sum, view) => sum + view.balancePaise, 0);
  const outstandingCount = (views ?? []).filter((view) => view.balancePaise > 0).length;
  const nextInvoice = [...(views ?? [])]
    .filter((view) => view.status === "unpaid" || view.status === "overdue")
    .sort((a, b) => a.invoice.dueAtIso.localeCompare(b.invoice.dueAtIso))[0];

  return (
    <section className={classNames.band} aria-label="Account summary">
      <span className={`demo-badge ${classNames.badge ?? ""}`}>{supabaseMode ? "Live ledger projection" : "Demo data · fictional fees"}</span>

      <div className={classNames.grid}>
        <section className={classNames.col}>
          <p className="section-label">Amount due</p>
          <p className={`num ${classNames.bigNum ?? ""}`}>{views === null ? "…" : formatINR(amountDue)}</p>
          <p className={classNames.detail}>
            <StatusBadge tone={amountDue > 0 ? "watch" : "good"}>{amountDue > 0 ? "Due" : "Clear"}</StatusBadge>
          </p>
          <p className={classNames.detail}>
            {views === null
              ? "Loading ledger…"
              : `${outstandingCount} invoice${outstandingCount === 1 ? "" : "s"} outstanding`}
          </p>
        </section>

        <section className={classNames.col}>
          <p className="section-label">Next due date</p>
          <p className={classNames.bigLine}>
            <span className={`num ${classNames.bigNum ?? ""}`}>
              {nextInvoice ? formatKolkata(nextInvoice.invoice.dueAtIso, { format: "day" }) : "—"}
            </span>
          </p>
          <p className={classNames.detail}>
            {nextInvoice ? `${nextInvoice.invoice.term} · ${nextInvoice.invoice.ref}` : "Nothing due"}
          </p>
        </section>

        <section className={classNames.col}>
          <p className="section-label">Latest result</p>
          <p className={`num ${classNames.bigNum ?? ""}`}>
            {latestTerm === undefined ? "…" : (latestTerm ?? "—")}
          </p>
          <p className={classNames.detail}>
            {latestTerm === undefined ? (
              "Checking published reports…"
            ) : latestTerm === null ? (
              "No published report yet"
            ) : (
              <a className="link-arrow" href="/portal/results">
                Published — view results →
              </a>
            )}
          </p>
        </section>
      </div>
    </section>
  );
}

export default OverviewFinanceBand;
