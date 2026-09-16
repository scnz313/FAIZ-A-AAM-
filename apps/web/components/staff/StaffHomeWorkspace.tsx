"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DashboardQueues } from "@/components/staff/DashboardQueues";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { EmptyState, ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import { BarChart } from "@/components/ui/BarChart";
import { ProgressRail } from "@/components/ui/ProgressRail";
import { StatTile } from "@/components/ui/StatTile";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  dashboardService,
  type ActivityModel,
  type AdministratorDashboard,
  type BarDatum,
  type FeeCollection,
  type PrincipalDashboard,
  type QueueRow,
  type SectionProgress,
  type Source,
  type TimetableSummary,
} from "@/modules/services/dashboard";
import { canAnyRole } from "@/modules/services/staff-profiles";
import type { StaffAction as StaffActionKey } from "@/modules/services/staff-authorization";
import type { StaffProfileCode } from "@fass/contracts";
import { formatINR } from "@/modules/services/finance";

import styles from "./StaffHomeWorkspace.module.css";

/* ------------------------------------------------------------------ */
/* Page furniture                                                       */
/* ------------------------------------------------------------------ */

/** School-time greeting (Asia/Kolkata), never the workstation clock. */
function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

type PanelProps<T> = {
  title: string;
  note?: string;
  source: Source<T>;
  onRetry: () => void;
  isEmpty?: (value: T) => boolean;
  emptyTitle?: string;
  emptyNote?: string;
  children: (value: T) => ReactNode;
};

/** Panel that renders nothing when the caller is not authorised for the
 *  source, an honest retry state on failure, an empty state when empty. */
function SourcePanel<T>({ title, note, source, onRetry, isEmpty, emptyTitle, emptyNote, children }: PanelProps<T>) {
  if (source.kind === "hidden") return null;
  return (
    <section className="panel">
      <div className="pn-head">
        <h2>{title}</h2>
        {note ? <span className="sub">{note}</span> : null}
      </div>
      <div className="pn-body">
        {source.kind === "error" ? (
          <ErrorPanel title={`${title} could not be loaded.`} note="No record was changed · try again.">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
              Try again
            </button>
          </ErrorPanel>
        ) : isEmpty?.(source.value) ? (
          <EmptyState title={emptyTitle ?? "Nothing to show"} note={emptyNote} />
        ) : (
          children(source.value)
        )}
      </div>
    </section>
  );
}

/** Queue rows — the global V15 `.q-row` ledger with a count column. */
function QueueRows({ rows, profileCode }: { rows: QueueRow[]; profileCode: StaffProfileCode | null }) {
  return (
    <div className={styles.qRows}>
      {rows.map((row) => (
        <div key={row.key} className="q-row">
          <div>
            <div className="q-t">{row.title}</div>
            <div className="q-s">{row.detail}</div>
          </div>
          <div className="q-m">{row.count === null ? "Count unavailable" : `${row.count} ${row.count === 1 ? "item" : "items"}`}</div>
          <div />
          <div className="q-act">
            <Link prefetch={false} className="btn btn-ghost btn-sm" href={canonicalStaffUrl(profileCode, row.href)}>
              Open
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityPanel({ source, onRetry, profileCode }: { source: Source<ActivityModel>; onRetry: () => void; profileCode: StaffProfileCode | null }) {
  return (
    <SourcePanel
      title="Activity · last 14 days"
      note="Audit events per day"
      source={source}
      onRetry={onRetry}
      isEmpty={(value) => value.windowTotal === 0}
      emptyTitle="No recorded activity in the last 14 days"
      emptyNote="Audit events appear here as staff work is recorded."
    >
      {(value) => {
        const max = Math.max(1, ...value.days.map((day) => day.count));
        const mid = Math.floor(value.days.length / 2);
        return (
          <>
            <div className={styles.activityChart} role="img" aria-label={`Audit events per day, ${value.days.length} days`}>
              {value.days.map((day) => (
                <span key={day.key} className={styles.activityBar} title={`${day.label}: ${day.count}`}>
                  <span className={styles.activityFill} style={{ height: `${(day.count / max) * 100}%` }} />
                </span>
              ))}
            </div>
            <div className={styles.activityScale} aria-hidden="true">
              <span>{value.days[0]?.label}</span>
              <span>{value.days[mid]?.label}</span>
              <span>{value.days[value.days.length - 1]?.label}</span>
            </div>
            <ul className={styles.activityList}>
              {value.latest.map((event) => (
                <li key={event.id} className={styles.activityItem}>
                  <span className={`num ${styles.activityTime}`}>{formatKolkata(event.atIso, { format: "short" })}</span>
                  <span className={styles.activityAction}>{event.action}</span>
                  <span className={`ref ${styles.activityTarget}`}>{event.target}</span>
                </li>
              ))}
            </ul>
            <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/audit")}>
              Open the audit trail →
            </Link>
          </>
        );
      }}
    </SourcePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace                                                            */
/* ------------------------------------------------------------------ */

const WORKSPACE_LINKS: ReadonlyArray<{ title: string; desc: string; icon: string; href: string; action: StaffActionKey }> = [
  { title: "Admissions", desc: "Applications, assessments, and offers", icon: "edit_document", href: "/admissions", action: "admissions.view" },
  { title: "Careers", desc: "Vacancies and candidate review", icon: "work", href: "/careers", action: "careers.view" },
  { title: "Finance", desc: "Fee ledger, payments, and concessions", icon: "payments", href: "/finance", action: "finance.view" },
  { title: "Results", desc: "Marks entry, moderation, and release", icon: "grading", href: "/results", action: "results.view" },
  { title: "Timetables", desc: "Versions, overrides, and date sheets", icon: "calendar_month", href: "/timetables", action: "timetable.view" },
  { title: "Teaching records", desc: "Teacher records and assignments", icon: "person", href: "/academics/teachers", action: "timetable.manage" },
  { title: "Notices", desc: "Draft, review, and publish notices", icon: "campaign", href: "/notices", action: "content.view" },
  { title: "Content", desc: "Public pages and download register", icon: "article", href: "/content", action: "content.view" },
  { title: "Documents", desc: "Record files and the public register", icon: "folder_open", href: "/documents", action: "documents.view" },
  { title: "Support", desc: "Guardian and public grievances", icon: "support_agent", href: "/support", action: "support.view" },
  { title: "Guardians", desc: "Contacts and portal activation", icon: "family_restroom", href: "/guardians", action: "links.verify" },
  { title: "Guardian links", desc: "Family link requests to verify", icon: "link", href: "/link-requests", action: "links.verify" },
  { title: "Users", desc: "Staff accounts and access", icon: "group", href: "/users", action: "users.manage" },
  { title: "Imports", desc: "CSV intake and validation", icon: "upload", href: "/data/imports", action: "users.manage" },
  { title: "Exports", desc: "Protected register exports", icon: "download", href: "/data/exports", action: "users.manage" },
  { title: "Settings", desc: "Academic year and policy", icon: "settings", href: "/settings", action: "settings.manage" },
  { title: "Audit", desc: "Read-only evidence of every action", icon: "history", href: "/audit", action: "audit.view" },
];

export function StaffHomeWorkspace() {
  const { status, summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const isPrincipal = profileCode === "principal";
  const supabaseMode = clientAdapterMode() === "supabase";
  const ready = status === "ready" && summary !== null;
  /* Aggregate authorization: profile accounts check every active grant;
     legacy accounts fall back to the single active workspace role. */
  const roles = useMemo<ReadonlyArray<string>>(
    () => (summary?.profileCode === null ? (summary?.role ? [summary.role] : []) : (summary?.roles ?? [])),
    [summary],
  );

  const [model, setModel] = useState<AdministratorDashboard | PrincipalDashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const loading = model === null && !failed;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const load = isPrincipal
      ? dashboardService.loadPrincipal(roles)
      : dashboardService.loadAdministrator(roles);
    load
      .then((value) => {
        if (cancelled) return;
        setModel(value);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, isPrincipal, roles, reloadToken]);

  const retry = () => {
    setFailed(false);
    setReloadToken((token) => token + 1);
  };

  const roleLabels = ready ? (summary?.roles ?? (summary?.role ? [summary.role] : [])) : [];
  const today = formatKolkata(new Date().toISOString(), { format: "day" });
  const workspaceLinks = WORKSPACE_LINKS.filter((link) => canAnyRole(roles, link.action));

  return (
    <div className={styles.page}>
      {/* V15 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>
            {ready ? `${greetingFor(new Date())}, ${summary!.displayName}` : "Workspace overview"}
          </h1>
          <p className="ph-sub">
            {ready ? `${summary!.profileLabel ?? summary!.roleLabel} · ${summary!.academicYearLabel} · ${today} · ` : ""}
            everything waiting on your attention, in one ledger.
          </p>
        </div>
        {ready && roleLabels.length > 0 ? (
          <div className={`${styles.roleChips} x-scroll`} role="region" aria-label="Active staff roles" tabIndex={0}>
            {roleLabels.map((role) => (
              <span key={role} className="chip">{role.replace(/_/g, " ")}</span>
            ))}
          </div>
        ) : null}
      </div>

      {failed ? (
        <ErrorPanel title="The dashboard could not be loaded." note="No record was changed · try again.">
          <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
            Try again
          </button>
        </ErrorPanel>
      ) : null}

      {/* KPI strip */}
      <div className={styles.kpiGrid} aria-label="Key figures">
        {loading
          ? [0, 1, 2, 3].map((index) => <StatTile key={index} label="Loading" value={undefined} />)
          : model?.kpis.map((tile) => (
              <StatTile
                key={tile.key}
                label={tile.label}
                value={tile.value}
                secondary={tile.secondary ?? undefined}
                href={canonicalStaffUrl(profileCode, tile.href)}
              />
            ))}
      </div>

      {/* Queue, activity, and insight panels — paired into g32 rows so a
          hidden panel never leaves an empty track beside a lone sibling. */}
      {loading ? (
        <>
          <div className="g32">
            <section className="panel">
              <div className="pn-head"><h2>{isPrincipal ? "Your drafting queue" : "Waiting for your approval"}</h2></div>
              <div className="pn-body"><LoadingSkeleton lines={4} label="Loading the queue…" /></div>
            </section>
            <section className="panel">
              <div className="pn-head"><h2>Activity · last 14 days</h2></div>
              <div className="pn-body"><LoadingSkeleton lines={5} label="Loading activity…" /></div>
            </section>
          </div>
          <div className="g32">
            <section className="panel"><div className="pn-head"><h2>Admissions funnel</h2></div><div className="pn-body"><LoadingSkeleton lines={5} label="Loading admissions…" /></div></section>
            <section className="panel"><div className="pn-head"><h2>Insights</h2></div><div className="pn-body"><LoadingSkeleton lines={5} label="Loading insights…" /></div></section>
          </div>
        </>
      ) : model ? (
        <DashboardPanels model={model} isPrincipal={isPrincipal} profileCode={profileCode} onRetry={retry} />
      ) : null}

      {/* Live record queues (admissions + careers) */}
      <DashboardQueues
        admissions={model?.records.admissions ?? []}
        jobs={model?.records.jobs ?? []}
        loading={loading}
      />

      {/* All workspaces */}
      {ready && workspaceLinks.length > 0 ? (
        <section className="panel">
          <div className="pn-head">
            <h2>All workspaces</h2>
            <span className="demo-badge">{supabaseMode ? "Live projection" : "Demo data"}</span>
          </div>
          <div className="pn-body flush">
            <div className={styles.queue}>
              {workspaceLinks.map((item) => (
                <Link
                  key={item.title}
                  prefetch={false}
                  href={canonicalStaffUrl(profileCode, item.href)}
                  className={styles.qMini}
                >
                  <span className={styles.qMiniLeft}>
                    <span className={`msym ${styles.qMiniIcon}`} aria-hidden="true" style={{ fontSize: 21 }}>{item.icon}</span>
                    <span>
                      <span className={styles.qMiniTitle}>{item.title}</span>
                      <span className={styles.qMiniDesc}>{item.desc}</span>
                    </span>
                  </span>
                  <span className={`msym ${styles.qMiniChev}`} aria-hidden="true" style={{ fontSize: 20 }}>chevron_right</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function hasMiniCharts(model: AdministratorDashboard | PrincipalDashboard): boolean {
  const sources =
    "guardianAccess" in model
      ? [model.support, model.content, model.guardianAccess]
      : [model.support, model.content, model.timetable];
  return sources.some((source) => source.kind !== "hidden");
}

/* Builds the ordered, visibility-filtered list of dashboard panels and pairs
   them into g32 rows so a hidden panel never leaves a lone sibling with an
   empty track beside it. An odd tail renders full-width via the g32
   :only-child rule. */
function DashboardPanels({
  model,
  isPrincipal,
  profileCode,
  onRetry,
}: {
  model: AdministratorDashboard | PrincipalDashboard;
  isPrincipal: boolean;
  profileCode: StaffProfileCode | null;
  onRetry: () => void;
}) {
  const admin = model as AdministratorDashboard;
  const queueHidden = isPrincipal
    ? (model as PrincipalDashboard).draftingState === "hidden"
    : admin.approvalsState === "hidden";
  const funnel =
    model.funnel.kind !== "hidden" ? (
      <SourcePanel
        key="funnel"
        title="Admissions funnel"
        note="This cycle"
        source={model.funnel}
        onRetry={onRetry}
        isEmpty={(value) => value.every((bar) => bar.value === 0)}
        emptyTitle="No applications this cycle"
        emptyNote="Submitted applications appear here as they move through review."
      >
        {(value: BarDatum[]) => <BarChart data={value} ariaLabel="Applications by admissions stage" />}
      </SourcePanel>
    ) : null;
  const results =
    model.resultsProgress.kind !== "hidden" ? (
      <SourcePanel
        key="results"
        title="Results progress"
        note="Entry sheets by class"
        source={model.resultsProgress}
        onRetry={onRetry}
        isEmpty={(value) => value.length === 0}
        emptyTitle="No result batches yet"
        emptyNote="Marks entry sheets appear here once created for this term."
      >
        {(value: SectionProgress[]) => <ResultsProgress value={value} />}
      </SourcePanel>
    ) : null;
  const mini = hasMiniCharts(model) ? (
    <MiniChartsPanel key="mini" model={model} isPrincipal={isPrincipal} profileCode={profileCode} onRetry={onRetry} />
  ) : null;

  const panels: ReactNode[] = [];
  if (!queueHidden) {
    panels.push(<ApprovalQueue key="queue" model={model} isPrincipal={isPrincipal} profileCode={profileCode} onRetry={onRetry} />);
  }
  if (model.activity.kind !== "hidden") {
    panels.push(<ActivityPanel key="activity" source={model.activity} onRetry={onRetry} profileCode={profileCode} />);
  }
  if (isPrincipal) {
    if (mini) panels.push(mini);
    if (funnel) panels.push(funnel);
    if (results) panels.push(results);
  } else {
    if (funnel) panels.push(funnel);
    if (admin.feeCollection.kind !== "hidden") {
      panels.push(<FeePanel key="fee" source={admin.feeCollection} onRetry={onRetry} profileCode={profileCode} />);
    }
    if (results) panels.push(results);
    if (mini) panels.push(mini);
  }

  const rows: ReactNode[][] = [];
  for (let i = 0; i < panels.length; i += 2) rows.push(panels.slice(i, i + 2));
  return (
    <>
      {rows.map((row, index) => (
        <div key={index} className="g32">
          {row}
        </div>
      ))}
    </>
  );
}

function ApprovalQueue({
  model,
  isPrincipal,
  profileCode,
  onRetry,
}: {
  model: AdministratorDashboard | PrincipalDashboard;
  isPrincipal: boolean;
  profileCode: StaffProfileCode | null;
  onRetry: () => void;
}) {
  const rows = (isPrincipal ? (model as PrincipalDashboard).drafting : (model as AdministratorDashboard).approvals)
    /* Rows whose count resolved to zero need no action; rows with an
       unavailable count still link honestly. */
    .filter((row) => row.count !== 0);
  const state = isPrincipal ? (model as PrincipalDashboard).draftingState : (model as AdministratorDashboard).approvalsState;
  const title = isPrincipal ? "Your drafting queue" : "Waiting for your approval";
  if (state === "hidden") return null;
  return (
    <section className="panel">
      <div className="pn-head">
        <h2>{title}</h2>
        <span className="sub">{isPrincipal ? "Maker work" : "Checker work"}</span>
      </div>
      <div className="pn-body flush">
        {state === "error" ? (
          <div style={{ padding: "18px" }}>
            <ErrorPanel title="The queue could not be loaded." note="No record was changed · try again.">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
                Try again
              </button>
            </ErrorPanel>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing waiting" note="Queues fill as colleagues submit work for your attention." />
        ) : (
          <QueueRows rows={rows} profileCode={profileCode} />
        )}
      </div>
    </section>
  );
}

function FeePanel({ source, onRetry, profileCode }: { source: Source<FeeCollection>; onRetry: () => void; profileCode: StaffProfileCode | null }) {
  return (
    <SourcePanel
      title="Fee collection"
      note="Whole ledger"
      source={source}
      onRetry={onRetry}
      isEmpty={(value) => value.totalPaise === 0}
      emptyTitle="No invoices yet"
      emptyNote="Issued invoices appear here once the fee ledger opens."
    >
      {(value) => (
        <>
          <p className={styles.feeTotal}>
            <span className="num">{formatINR(value.collectedPaise)}</span>
            <span className={styles.feeTotalSub}> collected of {formatINR(value.totalPaise)}</span>
          </p>
          <ProgressRail data={value.segments} ariaLabel="Fee collection split" total={value.totalPaise} />
          <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/finance")}>
            Open the fee ledger →
          </Link>
        </>
      )}
    </SourcePanel>
  );
}

function ResultsProgress({ value }: { value: SectionProgress[] }) {
  return (
    <div className={`${styles.sectionRails} y-scroll`}>
      {value.map((section) => (
        <div key={section.label} className={styles.sectionRail}>
          <div className={styles.sectionRailHead}>
            <span className={styles.sectionRailLabel}>{section.label}</span>
            <span className={`num ${styles.sectionRailTotal}`}>{section.total} {section.total === 1 ? "sheet" : "sheets"}</span>
          </div>
          <ProgressRail data={section.segments} ariaLabel={`${section.label} result sheet progress`} total={section.total} />
        </div>
      ))}
    </div>
  );
}

function MiniChart({
  title,
  source,
  onRetry,
  emptyNote,
}: {
  title: string;
  source: Source<BarDatum[]>;
  onRetry: () => void;
  emptyNote: string;
}) {
  if (source.kind === "hidden") return null;
  return (
    <div className={styles.miniChart}>
      <h3 className={styles.miniChartTitle}>{title}</h3>
      {source.kind === "error" ? (
        <p className={styles.miniChartError}>
          {title} could not be loaded ·{" "}
          <button type="button" className="underline-link" onClick={onRetry}>
            try again
          </button>
        </p>
      ) : source.value.every((bar) => bar.value === 0) ? (
        <p className={styles.miniChartEmpty}>{emptyNote}</p>
      ) : (
        <BarChart data={source.value} ariaLabel={`${title} by status`} />
      )}
    </div>
  );
}

function MiniChartsPanel({
  model,
  isPrincipal,
  profileCode,
  onRetry,
}: {
  model: AdministratorDashboard | PrincipalDashboard;
  isPrincipal: boolean;
  profileCode: StaffProfileCode | null;
  onRetry: () => void;
}) {
  const sources = [
    model.support,
    model.content,
    "guardianAccess" in model ? model.guardianAccess : ({ kind: "hidden" } as Source<BarDatum[]>),
    "timetable" in model ? model.timetable : ({ kind: "hidden" } as Source<TimetableSummary>),
  ];
  if (sources.every((source) => source.kind === "hidden")) return null;
  return (
    <section className="panel">
      <div className="pn-head"><h2>{isPrincipal ? "Support and timetable" : "Content and guardians"}</h2></div>
      <div className="pn-body">
        <div className={styles.miniCharts}>
          <MiniChart title="Support" source={model.support} onRetry={onRetry} emptyNote="No grievances on record." />
          <MiniChart title="Notices" source={model.content} onRetry={onRetry} emptyNote="No notices in the register." />
          {"guardianAccess" in model ? (
            <MiniChart title="Guardian portal access" source={model.guardianAccess} onRetry={onRetry} emptyNote="No guardians on record." />
          ) : null}
          {"timetable" in model ? <TimetableBlock source={model.timetable} onRetry={onRetry} profileCode={profileCode} /> : null}
        </div>
      </div>
    </section>
  );
}

function TimetableBlock({ source, onRetry, profileCode }: { source: Source<TimetableSummary>; onRetry: () => void; profileCode: StaffProfileCode | null }) {
  if (source.kind === "hidden") return null;
  return (
    <div className={styles.miniChart}>
      <h3 className={styles.miniChartTitle}>Timetables</h3>
      {source.kind === "error" ? (
        <p className={styles.miniChartError}>
          Timetables could not be loaded ·{" "}
          <button type="button" className="underline-link" onClick={onRetry}>
            try again
          </button>
        </p>
      ) : (
        <>
          <p className={styles.miniChartEmpty}>
            {source.value.published} published {source.value.published === 1 ? "version" : "versions"} · {source.value.drafts} {source.value.drafts === 1 ? "draft" : "drafts"} across {source.value.classes} {source.value.classes === 1 ? "class" : "classes"}
          </p>
          <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/timetables")}>
            Open timetables →
          </Link>
        </>
      )}
    </div>
  );
}

export default StaffHomeWorkspace;
