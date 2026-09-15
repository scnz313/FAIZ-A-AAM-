"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { DashboardQueues } from "@/components/staff/DashboardQueues";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { admissionsService, type StaffQueueRecord } from "@/modules/services/admissions";
import { academicsService } from "@/modules/services/academics";
import { careersService, type JobApplicationRecord } from "@/modules/services/careers";
import { contentService } from "@/modules/services/content";
import { familyContextService } from "@/modules/services/family-context";
import { financeService } from "@/modules/services/finance";
import { supportService } from "@/modules/services/support";
import { usersService } from "@/modules/services/users";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./StaffHomeWorkspace.module.css";

/**
 * Role-aware staff home — V14 aligned. Uses V14's PageHead pattern with
 * role chips, a work queue Panel with q-mini rows, and a grid with
 * maker-checker discipline and latest audit entries panels. The greeting
 * follows the demo identity and the active workspace; queue counts are
 * filtered to the actions the active role may perform. UI visibility is
 * not authorization — the route guards and the backend adapter stay
 * authoritative.
 */
/** School-time greeting (Asia/Kolkata), never the workstation clock. */
function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function StaffHomeWorkspace() {
  const { status, summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const supabaseMode = clientAdapterMode() === "supabase";
  const ready = status === "ready" && summary !== null;
  /* Aggregate authorization: profile accounts check every active grant;
     legacy accounts fall back to the single active workspace role. */
  const roles = summary?.profileCode === null
    ? (summary?.role ? [summary.role] : [])
    : (summary?.roles ?? []);

  const showAdmissions = canAnyRole(roles, "admissions.view");
  const showCareers = canAnyRole(roles, "careers.view");
  const showFinance = canAnyRole(roles, "finance.view");
  const showSupport = canAnyRole(roles, "support.view");
  const showResults = canAnyRole(roles, "results.view");
  const showTimetables = canAnyRole(roles, "timetable.view");
  const showContent = canAnyRole(roles, "content.view");
  const showUsers = canAnyRole(roles, "users.manage");
  const showSettings = canAnyRole(roles, "settings.manage");
  const showAudit = canAnyRole(roles, "audit.view");
  const showLinks = canAnyRole(roles, "links.verify");
  const showAdmin = showUsers || showSettings || showAudit || showLinks;

  /* Admin summary counts: pending link requests and total staff accounts. */
  const [pendingLinks, setPendingLinks] = useState<number | null>(null);
  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [queueCounts, setQueueCounts] = useState<{
    applications: number;
    assessment: number;
    offers: number;
    invoicesDue: number;
    invoiceTotal: number;
    supportNew: number;
    supportProgress: number;
    supportResolved: number;
    notices: number;
    resultsPending: number | null;
  } | null>(null);
  const [admissionRows, setAdmissionRows] = useState<StaffQueueRecord[]>([]);
  const [jobRows, setJobRows] = useState<JobApplicationRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    const pendingPromise = showAdmin
      ? supabaseMode
        ? familyContextService.listLinkRequestSummaries(0, 1).then((page) => page.total)
        : Promise.all([familyContextService.listLinkRequests(), familyContextService.listLinkRequestSummaries()])
            .then(([requests, links]) => requests.rows.filter((row) => row.request.status === "pending").length + links.rows.filter((row) => row.link.status === "pending_verification").length)
      : Promise.resolve(null);
    void Promise.all([
      pendingPromise,
      showAdmin ? usersService.listUsers() : Promise.resolve(null),
      showAdmissions ? admissionsService.listStaffRecords() : Promise.resolve(null),
      showFinance ? financeService.listAllInvoices() : Promise.resolve(null),
      showSupport ? supportService.listGrievances() : Promise.resolve(null),
      showContent ? contentService.listForStaff() : Promise.resolve(null),
      showCareers ? careersService.listStaffRecords() : Promise.resolve(null),
      showResults ? academicsService.listBatches() : Promise.resolve(null),
    ])
      .then(([pending, users, applications, invoiceViews, grievances, content, jobs, batches]) => {
        if (cancelled) return;
        setLoadError(false);
        setLoadedOnce(true);
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
          invoiceTotal: invoiceViews?.length ?? 0,
          supportNew: grievances?.filter((g) => g.status === "New").length ?? 0,
          supportProgress: grievances?.filter((g) => g.status === "In progress").length ?? 0,
          supportResolved: grievances?.filter((g) => g.status === "Resolved").length ?? 0,
          notices: content?.length ?? 0,
          /* Batches awaiting a moderation decision or publication. Null when not
             fetched — rendered as an honest link, never a fabricated zero. */
          resultsPending: batches === null || batches === undefined
            ? null
            : batches.filter((batch) => ["submitted", "moderation", "returned", "approved"].includes(batch.status)).length,
        });
      })
      .catch(() => {
        /* Keep prior rows on screen; flag staleness with retry instead of zeroing. */
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [showAdmin, showAdmissions, showCareers, showFinance, showSupport, showContent, showResults, supabaseMode, reloadToken]);

  /* V14 work queue items — filtered by role authorization. A null count means
     the figure is not computed for this surface: the row links honestly
     instead of fabricating a zero. While the first projection is in flight
     the row reads "Loading…" — never a fabricated zero. */
  const countsUnavailable = loadError && !loadedOnce;
  const countsLoading = queueCounts === null && !countsUnavailable;
  /* Non-null view once loading has resolved: the loading/unavailable branches
     render honest "Loading…"/"Counts unavailable" copy instead of values. */
  const counts = queueCounts ?? {
    applications: 0,
    assessment: 0,
    offers: 0,
    invoicesDue: 0,
    invoiceTotal: 0,
    supportNew: 0,
    supportProgress: 0,
    supportResolved: 0,
    notices: 0,
    resultsPending: null as number | null,
  };
  const workQueueItems: Array<{ title: string; desc: string; count: number | null; icon: string; href: string; show: boolean }> = [
    {
      title: "Admissions",
      desc: countsUnavailable
        ? "Counts unavailable · open the queue"
        : queueCounts === null
          ? "Loading…"
          : `${counts.applications} applications ready for review · ${counts.assessment} awaiting assessment`,
      count: countsUnavailable || queueCounts === null ? null : counts.applications + counts.assessment,
      icon: "edit_document",
      href: canonicalStaffUrl(profileCode, "/admissions"),
      show: showAdmissions,
    },
    {
      title: "Finance",
      desc: countsUnavailable
        ? "Counts unavailable · open the ledger"
        : queueCounts === null
          ? "Loading…"
          : `${counts.invoicesDue} invoices due soon · ${counts.invoiceTotal} in ledger`,
      count: countsUnavailable || queueCounts === null ? null : counts.invoicesDue,
      icon: "payments",
      href: canonicalStaffUrl(profileCode, "/finance"),
      show: showFinance,
    },
    {
      title: "Support",
      desc: countsUnavailable
        ? "Counts unavailable · open the inbox"
        : countsLoading
          ? "Loading…"
          : `${queueCounts?.supportNew ?? 0} new concerns · ${queueCounts?.supportProgress ?? 0} in progress`,
      count: countsUnavailable || countsLoading ? null : (queueCounts?.supportNew ?? 0) + (queueCounts?.supportProgress ?? 0),
      icon: "support_agent",
      href: canonicalStaffUrl(profileCode, "/support"),
      show: showSupport,
    },
    {
      title: "Content",
      desc: countsUnavailable ? "Counts unavailable · open the register" : countsLoading ? "Loading…" : `${queueCounts?.notices ?? 0} notices in the register`,
      count: countsUnavailable || countsLoading ? null : (queueCounts?.notices ?? 0),
      icon: "article",
      href: canonicalStaffUrl(profileCode, "/notices"),
      show: showContent,
    },
    {
      title: "Guardian links",
      desc: countsUnavailable
        ? "Counts unavailable · open the queue"
        : pendingLinks === null
          ? "Loading…"
          : `${pendingLinks} claims to verify`,
      count: countsUnavailable ? null : pendingLinks,
      icon: "link",
      href: canonicalStaffUrl(profileCode, "/link-requests"),
      show: showLinks,
    },
    {
      title: "Users",
      desc: countsUnavailable
        ? "Counts unavailable · open the register"
        : staffCount === null
          ? "Loading…"
          : `${staffCount} staff accounts`,
      count: countsUnavailable ? null : staffCount,
      icon: "group",
      href: canonicalStaffUrl(profileCode, "/users"),
      show: showUsers,
    },
    {
      title: "Results",
      desc:
        queueCounts === null || counts.resultsPending === null
          ? "Moderation queue for term batches"
          : `${counts.resultsPending} batches awaiting moderation or publish`,
      count: queueCounts === null ? null : counts.resultsPending,
      icon: "grading",
      href: canonicalStaffUrl(profileCode, "/results"),
      show: showResults,
    },
    {
      title: "Timetables",
      desc: "Versions, overrides, and date sheets",
      count: null,
      icon: "calendar_month",
      href: canonicalStaffUrl(profileCode, "/timetables"),
      show: showTimetables,
    },
    {
      title: "Audit",
      desc: "Read-only evidence of every meaningful action",
      count: null,
      icon: "history",
      href: canonicalStaffUrl(profileCode, "/audit"),
      show: showAudit,
    },
    {
      title: "Settings",
      desc: "Academic year, admission window, fee and result policy",
      count: null,
      icon: "settings",
      href: canonicalStaffUrl(profileCode, "/settings"),
      show: showSettings,
    },
  ];

  const visibleQueueItems = workQueueItems.filter((item) => item.show);
  const roleLabels = ready ? (summary?.roles ?? (summary?.role ? [summary.role] : [])) : [];

  return (
    <div className={styles.page}>
      {/* V14 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>
            {ready ? `${greetingFor(new Date())}, ${summary!.displayName}` : "Workspace overview"}
          </h1>
          <p className="ph-sub">
            {ready ? `${summary!.profileLabel ?? summary!.roleLabel} · ${summary!.academicYearLabel} · ` : ""}everything waiting on your attention, in one ledger.
          </p>
        </div>
        {ready && roleLabels.length > 0 ? (
          <div className={styles.roleChips}>
            {roleLabels.map((role) => (
              <span key={role} className="chip">{role.replace(/_/g, " ")}</span>
            ))}
          </div>
        ) : null}
      </div>

      {/* V14 Work queue Panel with q-mini rows */}
      {loadError ? (
        <div className="callout bad" role="alert">
          <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
            close
          </span>
          <div>
            <p className="strong" style={{ margin: 0 }}>
              Workspace counts could not be refreshed.
            </p>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              Queues below may be stale. No record was changed · try again.
            </p>
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setLoadError(false);
                  setReloadToken((token) => token + 1);
                }}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {visibleQueueItems.length > 0 ? (
        <section className="panel">
          <div className="pn-head">
            <h2>Work queue</h2>
            <span className="demo-badge">{supabaseMode ? "Live projection" : "Demo data"}</span>
          </div>
          <div className="pn-body flush">
            <div className={styles.queue}>
              {visibleQueueItems.map((item) => (
                <Link
                  key={item.title}
                  prefetch={false}
                  href={item.href}
                  className={styles.qMini}
                >
                  <span className={styles.qMiniLeft}>
                    <span className={`msym ${styles.qMiniIcon}`} aria-hidden="true" style={{ fontSize: 21 }}>{item.icon}</span>
                    <span>
                      <span className={styles.qMiniTitle}>{item.title}</span>
                      <span className={styles.qMiniDesc}>{item.desc}</span>
                    </span>
                  </span>
                  <span className={`num ${styles.qMiniCount}`}>{item.count === null ? "Open →" : `${item.count} items`}</span>
                  <span className={`msym ${styles.qMiniChev}`} aria-hidden="true" style={{ fontSize: 20 }}>chevron_right</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <DashboardQueues admissions={admissionRows} jobs={jobRows} loading={!loadedOnce && !loadError} />

      {/* V14 grid: Maker-checker discipline + audit info */}
      {showAdmin ? (
        <div className={styles.infoGrid}>
          <section className="panel">
            <div className="pn-head"><h2>Maker-checker discipline</h2></div>
            <div className="pn-body">
              <p className="small muted">
                Approvals are separated from preparation. Where a rule requires two officers, items you prepared yourself are marked and locked for you. A different approver must confirm them. The same rule binds the Principal: consequential work never approves itself.
              </p>
            </div>
          </section>
          <section className="panel">
            <div className="pn-head"><h2>Administration</h2></div>
            <div className="pn-body">
              <p className="small muted">
                {staffCount === null ? "Loading…" : `${staffCount} staff accounts`} · {pendingLinks === null ? "Loading…" : `${pendingLinks} pending link verifications`}
              </p>
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {showAudit ? (
                  <Link prefetch={false} className="btn btn-ghost btn-sm" href={canonicalStaffUrl(profileCode, "/audit")}>
                    <span className="msym" style={{ fontSize: 16 }}>history</span> Open audit trail
                  </Link>
                ) : null}
                {showSettings ? (
                  <Link prefetch={false} className="btn btn-ghost btn-sm" href={canonicalStaffUrl(profileCode, "/settings")}>
                    <span className="msym" style={{ fontSize: 16 }}>settings</span> Settings
                  </Link>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {!ready ? null : visibleQueueItems.length === 0 ? (
        <p className={styles.emptyNote}>
          Your workspace has no operational queues this session · open a module from the navigation.
        </p>
      ) : null}
    </div>
  );
}

export default StaffHomeWorkspace;
