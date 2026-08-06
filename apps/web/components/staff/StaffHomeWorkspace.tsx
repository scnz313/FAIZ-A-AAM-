"use client";

import { DashboardQueues } from "@/components/staff/DashboardQueues";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { admissionsQueueCounts } from "@/modules/admissions/demo";
import { notices } from "@/modules/content/demo";
import { demoTodayLabel } from "@/modules/demo/clock";
import { financeQueueCounts, invoices } from "@/modules/finance/demo";
import { canRole } from "@/modules/services/staff-authorization";
import { grievances } from "@/modules/support/demo";

import styles from "./StaffHomeWorkspace.module.css";

/**
 * Role-aware staff home (I4): the greeting follows the demo identity and the
 * active workspace; the school-day band, queue panels, and quick links are
 * filtered to the actions the active role may perform. UI visibility is not
 * authorization — the route guards and the backend adapter stay authoritative.
 */
export function StaffHomeWorkspace() {
  const { status, summary } = useStaffContext();
  const role = summary?.role ?? "";
  const ready = status === "ready" && summary !== null;

  const showAdmissions = canRole(role, "admissions.view");
  const showFinance = canRole(role, "finance.view");
  const showSupport = canRole(role, "support.view");
  const showResults = canRole(role, "results.view");
  const showTimetables = canRole(role, "timetable.view");
  const showContent = canRole(role, "content.view");

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Home</p>
        <h1 className="workspace-title">
          {ready ? `Good morning, ${summary!.displayName}` : "Staff home"}
        </h1>
        <p className="workspace-intro">
          {ready ? `${summary!.roleLabel} · ${summary!.academicYearLabel} — ` : ""}school day overview —{" "}
          {demoTodayLabel()}.
        </p>
      </header>

      <section className={styles.band} aria-label="School day summary">
        {showAdmissions ? (
          <div className={styles.col}>
            <p className="section-label">Applications</p>
            <p className={styles.bigLine}>
              <span className={`num ${styles.bigNum}`}>{admissionsQueueCounts.pendingReview}</span>
              <span className={styles.bigSuffix}>queued for review</span>
            </p>
            <ul className={styles.breakdown}>
              <li>
                <span className="status-dot status-dot--watch" aria-hidden="true" />
                <span className="num">{admissionsQueueCounts.awaitingAssessment}</span> awaiting assessment
              </li>
              <li>
                <span className="status-dot status-dot--good" aria-hidden="true" />
                <span className="num">{admissionsQueueCounts.offersOutstanding}</span> offers outstanding
              </li>
            </ul>
            <a className="link-arrow" href="/staff/admissions">
              Review the queue →
            </a>
          </div>
        ) : null}

        {showFinance ? (
          <div className={styles.col}>
            <p className="section-label">Finance</p>
            <p className={styles.bigLine}>
              <span className={`num ${styles.bigNum}`}>{financeQueueCounts.invoicesDueSoon}</span>
              <span className={styles.bigSuffix}>invoices due soon</span>
            </p>
            <ul className={styles.breakdown}>
              <li>
                <span className="status-dot status-dot--watch" aria-hidden="true" />
                <span className="num">{financeQueueCounts.paymentsToReconcile}</span> payments to reconcile
              </li>
              <li>
                <span className="status-dot status-dot--neutral" aria-hidden="true" />
                <span className="num">{invoices.length}</span> invoices this session
              </li>
            </ul>
            <a className="link-arrow" href="/staff/finance">
              Open the ledger →
            </a>
          </div>
        ) : null}

        {showSupport ? (
          <div className={styles.col}>
            <p className="section-label">Support</p>
            <p className={styles.bigLine}>
              <span className={`num ${styles.bigNum}`}>{grievances.filter((g) => g.status === "New").length}</span>
              <span className={styles.bigSuffix}>new concerns</span>
            </p>
            <ul className={styles.breakdown}>
              <li>
                <span className="status-dot status-dot--watch" aria-hidden="true" />
                <span className="num">{grievances.filter((g) => g.status === "In progress").length}</span> in progress
              </li>
              <li>
                <span className="status-dot status-dot--good" aria-hidden="true" />
                <span className="num">{grievances.filter((g) => g.status === "Resolved").length}</span> resolved
              </li>
            </ul>
            <a className="link-arrow" href="/staff/support">
              Open the support inbox →
            </a>
          </div>
        ) : null}
      </section>

      <DashboardQueues />

      {showResults || showTimetables || showContent ? (
        <section aria-labelledby="publishing-heading" className={styles.publishing}>
          <div className={styles.sectionHead}>
            <h2 id="publishing-heading" className="section-label">
              Publishing
            </h2>
            <span className="demo-badge">Demo data</span>
          </div>
          {showContent ? (
            <p className={styles.publishingLine}>
              <span className="num">2</span> drafts · <span className="num">1</span> scheduled ·{" "}
              <span className="num">{notices.length}</span> published notices this month
            </p>
          ) : null}
          <div className={styles.quickLinks}>
            {showResults ? (
              <a className="tile-link" href="/staff/results">
                <span className="tile-link__num">01</span>
                <span className="tile-link__title">Review results</span>
                <span className="tile-link__line">Moderation queue for Term 2 batches.</span>
                <span className="tile-link__more">Open →</span>
              </a>
            ) : null}
            {showTimetables ? (
              <a className="tile-link" href="/staff/timetables">
                <span className="tile-link__num">02</span>
                <span className="tile-link__title">Manage timetables</span>
                <span className="tile-link__line">Versions, overrides, and date sheets.</span>
                <span className="tile-link__more">Open →</span>
              </a>
            ) : null}
            {showContent ? (
              <a className="tile-link" href="/staff/notices">
                <span className="tile-link__num">03</span>
                <span className="tile-link__title">Publish notices</span>
                <span className="tile-link__line">Draft, schedule, and publish notices.</span>
                <span className="tile-link__more">Open →</span>
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {!ready ? null : !showAdmissions && !showFinance && !showSupport ? (
        <p className={styles.emptyNote}>
          Your workspace has no operational queues this session — open a module from the navigation.
        </p>
      ) : null}
    </div>
  );
}

export default StaffHomeWorkspace;
