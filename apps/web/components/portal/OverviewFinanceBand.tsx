"use client";

import { useEffect, useState } from "react";

import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatINR } from "@/modules/finance/demo";
import { financeService, type InvoiceView } from "@/modules/services/finance";
import { formatKolkata } from "@/modules/iot/domain";

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
  const { activeStudent } = useFamilyContext();
  const [views, setViews] = useState<InvoiceView[] | null>(null);
  const studentId = activeStudent?.student.id;

  useEffect(() => {
    if (studentId === undefined) return;
    let cancelled = false;
    void financeService.listInvoices(studentId).then((next) => {
      if (!cancelled) setViews(next);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const amountDue = (views ?? []).reduce((sum, view) => sum + view.balancePaise, 0);
  const outstandingCount = (views ?? []).filter((view) => view.balancePaise > 0).length;
  const nextInvoice = [...(views ?? [])]
    .filter((view) => view.status === "unpaid" || view.status === "overdue")
    .sort((a, b) => a.invoice.dueAtIso.localeCompare(b.invoice.dueAtIso))[0];

  return (
    <section className={classNames.band} aria-label="Account summary">
      <span className={`demo-badge ${classNames.badge ?? ""}`}>Demo data · fictional fees</span>

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
          <p className={`num ${classNames.bigNum ?? ""}`}>Term 2</p>
          <p className={classNames.detail}>
            <a className="link-arrow" href="/portal/results">
              Published — view results →
            </a>
          </p>
        </section>
      </div>
    </section>
  );
}

export default OverviewFinanceBand;
