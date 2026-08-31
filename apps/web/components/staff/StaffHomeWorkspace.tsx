"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { DashboardQueues } from "@/components/staff/DashboardQueues";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canRole } from "@/modules/services/staff-authorization";
import { admissionsService, type StaffQueueRecord } from "@/modules/services/admissions";
import { careersService, type JobApplicationRecord } from "@/modules/services/careers";
import { contentService } from "@/modules/services/content";
import { familyContextService } from "@/modules/services/family-context";
import { financeService } from "@/modules/services/finance";
import { supportService } from "@/modules/services/support";
import { usersService } from "@/modules/services/users";
import { clientAdapterMode } from "@/modules/services/adapter-client";

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
  const supabaseMode = clientAdapterMode() === "supabase";
  const ready = status === "ready" && summary !== null;

  const showAdmissions = canRole(role, "admissions.view");
  const showCareers = canRole(role, "careers.view");
  const showFinance = canRole(role, "finance.view");
  const showSupport = canRole(role, "support.view");
  const showResults = canRole(role, "results.view");
  const showTimetables = canRole(role, "timetable.view");
  const showContent = canRole(role, "content.view");
  const showUsers = canRole(role, "users.manage");
  const showSettings = canRole(role, "settings.manage");
  const showAudit = canRole(role, "audit.view");
  const showLinks = canRole(role, "links.verify");
  const showAdmin = showUsers || showSettings || showAudit || showLinks;

  /* Admin summary counts: pending link requests and total staff accounts. */
  const [pendingLinks, setPendingLinks] = useState<number | null>(null);
  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [queueCounts, setQueueCounts] = useState({ applications: 0, assessment: 0, offers: 0, invoicesDue: 0, payments: 0, invoiceTotal: 0, supportNew: 0, supportProgress: 0, supportResolved: 0, notices: 0 });
  const [admissionRows, setAdmissionRows] = useState<StaffQueueRecord[]>([]);
  const [jobRows, setJobRows] = useState<JobApplicationRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    const pendingPromise = showAdmin
      ? supabaseMode
        ? familyContextService.listLinkRequestSummaries().then((rows) => rows.length)
        : Promise.all([familyContextService.listLinkRequests(), familyContextService.listLinkRequestSummaries()])
            .then(([requests, links]) => requests.filter((row) => row.request.status === "pending").length + links.filter((row) => row.link.status === "pending_verification").length)
      : Promise.resolve(null);
    void Promise.all([
      pendingPromise,
      showAdmin ? usersService.listUsers() : Promise.resolve(null),
      showAdmissions ? admissionsService.listStaffRecords() : Promise.resolve(null),
      showFinance ? financeService.listAllInvoices() : Promise.resolve(null),
      showSupport ? supportService.listGrievances() : Promise.resolve(null),
      showContent ? contentService.listForStaff() : Promise.resolve(null),
      showCareers ? careersService.listStaffRecords() : Promise.resolve(null),
    ])
      .then(([pending, users, applications, invoiceViews, grievances, content, jobs]) => {
        if (cancelled) return;
        if (pending !== null) setPendingLinks(pending);
        if (users !== null) setStaffCount(users.length);
        setAdmissionRows(applications ?? []);
        setJobRows(jobs ?? []);
        const now = Date.now();
        setQueueCounts({
          applications: applications?.filter((row) => ["Submitted", "Under review", "Changes requested"].includes(row.status)).length ?? 0,
          assessment: applications?.filter((row) => row.status === "Assessment").length ?? 0,
          offers: applications?.filter((row) => row.status === "Offered").length ?? 0,
          invoicesDue: invoiceViews?.filter((view) => view.balancePaise > 0 && Date.parse(view.invoice.dueAtIso) >= now && Date.parse(view.invoice.dueAtIso) <= now + 14 * 86_400_000).length ?? 0,
          payments: 0,
          invoiceTotal: invoiceViews?.length ?? 0,
          supportNew: grievances?.filter((g) => g.status === "New").length ?? 0,
          supportProgress: grievances?.filter((g) => g.status === "In progress").length ?? 0,
          supportResolved: grievances?.filter((g) => g.status === "Resolved").length ?? 0,
          notices: content?.length ?? 0,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAdmissionRows([]);
          setJobRows([]);
          if (showAdmin) {
            setPendingLinks(0);
            setStaffCount(0);
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showAdmin, showAdmissions, showCareers, showFinance, showSupport, showContent, supabaseMode]);

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Home</p>
        <h1 className="workspace-title">
          {ready ? `Good morning, ${summary!.displayName}` : "Staff home"}
        </h1>
        <p className="workspace-intro">
          {ready ? `${summary!.roleLabel} · ${summary!.academicYearLabel} — ` : ""}school day overview.
        </p>
      </header>

      <section className={styles.band} aria-label="School day summary">
        {showAdmissions ? (
          <div className={styles.col}>
            <p className="section-label">Applications</p>
            <p className={styles.bigLine}>
              <span className={`num ${styles.bigNum}`}>{queueCounts.applications}</span>
              <span className={styles.bigSuffix}>queued for review</span>
            </p>
            <ul className={styles.breakdown}>
              <li>
                <span className="status-dot status-dot--watch" aria-hidden="true" />
                <span className="num">{queueCounts.assessment}</span> awaiting assessment
              </li>
              <li>
                <span className="status-dot status-dot--good" aria-hidden="true" />
                <span className="num">{queueCounts.offers}</span> offers outstanding
              </li>
            </ul>
            <Link prefetch={false} className="link-arrow" href="/staff/admissions">
              Review the queue →
            </Link>
          </div>
        ) : null}

        {showFinance ? (
          <div className={styles.col}>
            <p className="section-label">Finance</p>
            <p className={styles.bigLine}>
              <span className={`num ${styles.bigNum}`}>{queueCounts.invoicesDue}</span>
              <span className={styles.bigSuffix}>invoices due soon</span>
            </p>
            <ul className={styles.breakdown}>
              <li>
                <span className="status-dot status-dot--watch" aria-hidden="true" />
                <span className="num">{queueCounts.payments}</span> payments to reconcile
              </li>
              <li>
                <span className="status-dot status-dot--neutral" aria-hidden="true" />
                <span className="num">{queueCounts.invoiceTotal}</span> invoices in ledger
              </li>
            </ul>
            <Link prefetch={false} className="link-arrow" href="/staff/finance">
              Open the ledger →
            </Link>
          </div>
        ) : null}

        {showSupport ? (
          <div className={styles.col}>
            <p className="section-label">Support</p>
            <p className={styles.bigLine}>
              <span className={`num ${styles.bigNum}`}>{queueCounts.supportNew}</span>
              <span className={styles.bigSuffix}>new concerns</span>
            </p>
            <ul className={styles.breakdown}>
              <li>
                <span className="status-dot status-dot--watch" aria-hidden="true" />
                <span className="num">{queueCounts.supportProgress}</span> in progress
              </li>
              <li>
                <span className="status-dot status-dot--good" aria-hidden="true" />
                <span className="num">{queueCounts.supportResolved}</span> resolved
              </li>
            </ul>
            <Link prefetch={false} className="link-arrow" href="/staff/support">
              Open the support inbox →
            </Link>
          </div>
        ) : null}
      </section>

      <DashboardQueues admissions={admissionRows} jobs={jobRows} />

      {showResults || showTimetables || showContent ? (
        <section aria-labelledby="publishing-heading" className={styles.publishing}>
          <div className={styles.sectionHead}>
            <h2 id="publishing-heading" className="section-label">
              Publishing
            </h2>
            <span className="demo-badge">{supabaseMode ? "Live projection" : "Demo data"}</span>
          </div>
          {showContent ? (
            <p className={styles.publishingLine}>
              <span className="num">{queueCounts.notices}</span> notices in the register
            </p>
          ) : null}
          <div className={styles.quickLinks}>
            {showResults ? (
              <Link prefetch={false} className="tile-link" href="/staff/results">
                <span className="tile-link__num">01</span>
                <span className="tile-link__title">Review results</span>
                <span className="tile-link__line">Moderation queue for Term 2 batches.</span>
                <span className="tile-link__more">Open →</span>
              </Link>
            ) : null}
            {showTimetables ? (
              <Link prefetch={false} className="tile-link" href="/staff/timetables">
                <span className="tile-link__num">02</span>
                <span className="tile-link__title">Manage timetables</span>
                <span className="tile-link__line">Versions, overrides, and date sheets.</span>
                <span className="tile-link__more">Open →</span>
              </Link>
            ) : null}
            {showContent ? (
              <Link prefetch={false} className="tile-link" href="/staff/notices">
                <span className="tile-link__num">03</span>
                <span className="tile-link__title">Publish notices</span>
                <span className="tile-link__line">Draft, schedule, and publish notices.</span>
                <span className="tile-link__more">Open →</span>
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {!ready ? null : !showAdmissions && !showFinance && !showSupport && !showAdmin ? (
        <p className={styles.emptyNote}>
          Your workspace has no operational queues this session — open a module from the navigation.
        </p>
      ) : null}

      {showAdmin ? (
        <section aria-labelledby="admin-heading" className={styles.publishing}>
          <div className={styles.sectionHead}>
            <h2 id="admin-heading" className="section-label">
              Administration
            </h2>
            <span className="demo-badge">{supabaseMode ? "Live projection" : "Demo data"}</span>
          </div>
          <div className={styles.quickLinks}>
            {showUsers ? (
              <Link prefetch={false} className="tile-link" href="/staff/users">
                <span className="tile-link__num">01</span>
                <span className="tile-link__title">Manage users</span>
                <span className="tile-link__line">
                  {staffCount === null ? "Loading…" : `${staffCount} staff accounts`}
                  — invite, grant, and revoke roles.
                </span>
                <span className="tile-link__more">Open →</span>
              </Link>
            ) : null}
            {showLinks ? (
              <Link prefetch={false} className="tile-link" href="/staff/link-requests">
                <span className="tile-link__num">02</span>
                <span className="tile-link__title">Link requests</span>
                <span className="tile-link__line">
                  {pendingLinks === null ? "Loading…" : `${pendingLinks} pending verification`}
                  — approve or reject guardian links.
                </span>
                <span className="tile-link__more">Open →</span>
              </Link>
            ) : null}
            {showSettings ? (
              <Link prefetch={false} className="tile-link" href="/staff/settings">
                <span className="tile-link__num">03</span>
                <span className="tile-link__title">Settings</span>
                <span className="tile-link__line">Academic year, admission window, fee and result policy.</span>
                <span className="tile-link__more">Open →</span>
              </Link>
            ) : null}
            {showAudit ? (
              <Link prefetch={false} className="tile-link" href="/staff/audit">
                <span className="tile-link__num">04</span>
                <span className="tile-link__title">Audit trail</span>
                <span className="tile-link__line">Read-only evidence of every meaningful action.</span>
                <span className="tile-link__more">Open →</span>
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default StaffHomeWorkspace;
