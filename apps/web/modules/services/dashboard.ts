/**
 * Staff-home dashboard aggregation. The loaders fan out across the
 * authoritative module services with one settled promise per source so a
 * failing projection degrades its own panel instead of blanking the page.
 * Every derivation lives here — components only render the returned model.
 *
 * Source semantics: "hidden" means the caller's grants do not cover the
 * projection (render nothing), "error" means it failed to load (render the
 * honest error state). Neither is ever presented as a zero.
 */

import { academicsService, type EntryBatch } from "@/modules/services/academics";
import { admissionsService, type StaffQueueRecord } from "@/modules/services/admissions";
import { auditService, type AuditEvent } from "@/modules/services/audit";
import { careersService, type JobApplicationRecord } from "@/modules/services/careers";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { contentService, type ContentNotice } from "@/modules/services/content";
import { familyContextService } from "@/modules/services/family-context";
import { financeService, formatINR, type InvoiceView } from "@/modules/services/finance";
import { guardiansService, type GuardianAdminRow } from "@/modules/services/guardians";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { supportService, type Grievance } from "@/modules/services/support";
import { timetableService } from "@/modules/services/timetable";
import { usersService } from "@/modules/services/users";

export type Source<T> =
  | { kind: "ok"; value: T }
  | { kind: "error" }
  | { kind: "hidden" };

export const ok = <T>(value: T): Source<T> => ({ kind: "ok", value });
export const SOURCE_ERROR: Source<never> = { kind: "error" };
export const SOURCE_HIDDEN: Source<never> = { kind: "hidden" };

export type ChartTone = "ink" | "saffron" | "willow" | "madder" | "muted";

export type BarDatum = { label: string; value: number; tone: ChartTone };
export type RailSegment = { label: string; value: number; tone: ChartTone; hint?: string };

export type KpiTile = {
  key: string;
  label: string;
  /** Formatted headline figure; null renders the honest "Not available". */
  value: string | null;
  secondary: string | null;
  href: string;
};

export type QueueRow = {
  key: string;
  title: string;
  detail: string;
  /** null when the figure could not be computed — the row still links. */
  count: number | null;
  href: string;
};

export type SectionProgress = { label: string; total: number; segments: RailSegment[] };

export type FeeCollection = {
  totalPaise: number;
  collectedPaise: number;
  dueSoonPaise: number;
  overduePaise: number;
  notYetDuePaise: number;
  segments: RailSegment[];
};

export type ActivityDay = { key: string; label: string; count: number };
export type ActivityItem = { id: string; atIso: string; action: string; target: string; outcome: string };
export type ActivityModel = { days: ActivityDay[]; latest: ActivityItem[]; total: number; windowTotal: number };

export type TimetableSummary = {
  classes: number;
  published: number;
  drafts: number;
  perClass: Array<{ label: string; status: string }>;
};

export type DashboardRecords = { admissions: StaffQueueRecord[]; jobs: JobApplicationRecord[] };

export type AdministratorDashboard = {
  kpis: KpiTile[];
  approvals: QueueRow[];
  approvalsState: "ok" | "error" | "hidden";
  activity: Source<ActivityModel>;
  funnel: Source<BarDatum[]>;
  feeCollection: Source<FeeCollection>;
  resultsProgress: Source<SectionProgress[]>;
  support: Source<BarDatum[]>;
  content: Source<BarDatum[]>;
  guardianAccess: Source<BarDatum[]>;
  records: DashboardRecords;
};

export type PrincipalDashboard = {
  kpis: KpiTile[];
  drafting: QueueRow[];
  draftingState: "ok" | "error" | "hidden";
  activity: Source<ActivityModel>;
  funnel: Source<BarDatum[]>;
  resultsProgress: Source<SectionProgress[]>;
  support: Source<BarDatum[]>;
  content: Source<BarDatum[]>;
  timetable: Source<TimetableSummary>;
  records: DashboardRecords;
};

/* ------------------------------------------------------------------ */
/* Pure derivations                                                     */
/* ------------------------------------------------------------------ */

/** Invoices due within this many days count as "due soon" (inclusive). */
export const DUE_SOON_DAYS = 14;

export function admissionsFunnel(rows: StaffQueueRecord[]): BarDatum[] {
  const count = (...statuses: string[]) => rows.filter((row) => statuses.includes(row.status)).length;
  return [
    { label: "Submitted", value: count("Submitted"), tone: "ink" },
    { label: "Under review", value: count("Under review", "Changes requested"), tone: "saffron" },
    { label: "Assessment", value: count("Assessment"), tone: "saffron" },
    { label: "Offered", value: count("Offered", "Waitlisted"), tone: "willow" },
    { label: "Enrolled", value: count("Enrolled"), tone: "willow" },
    { label: "Declined", value: count("Declined", "Withdrawn"), tone: "muted" },
  ];
}

export function admissionsPipelineCount(rows: StaffQueueRecord[]): number {
  return rows.filter((row) => !["Enrolled", "Declined", "Withdrawn"].includes(row.status)).length;
}

export function feeCollection(views: InvoiceView[], nowMs: number): FeeCollection {
  const dueSoonEnd = nowMs + DUE_SOON_DAYS * 86_400_000;
  let totalPaise = 0;
  let collectedPaise = 0;
  let dueSoonPaise = 0;
  let overduePaise = 0;
  let notYetDuePaise = 0;
  for (const view of views) {
    totalPaise += view.totalPaise;
    collectedPaise += view.paidPaise;
    if (view.balancePaise <= 0) continue;
    const due = Date.parse(view.invoice.dueAtIso);
    if (Number.isNaN(due) || due > dueSoonEnd) notYetDuePaise += view.balancePaise;
    else if (due < nowMs) overduePaise += view.balancePaise;
    else dueSoonPaise += view.balancePaise;
  }
  const segments: RailSegment[] = [
    { label: "Collected", value: collectedPaise, tone: "willow", hint: formatINR(collectedPaise) },
    { label: `Due in ${DUE_SOON_DAYS} days`, value: dueSoonPaise, tone: "saffron", hint: formatINR(dueSoonPaise) },
    { label: "Overdue", value: overduePaise, tone: "madder", hint: formatINR(overduePaise) },
    { label: "Not yet due", value: notYetDuePaise, tone: "muted", hint: formatINR(notYetDuePaise) },
  ];
  const visibleSegments = segments.filter((segment) => segment.value > 0);
  return { totalPaise, collectedPaise, dueSoonPaise, overduePaise, notYetDuePaise, segments: visibleSegments };
}

export function invoiceDueCounts(views: InvoiceView[], nowMs: number): { overdue: number; dueSoon: number } {
  const dueSoonEnd = nowMs + DUE_SOON_DAYS * 86_400_000;
  let overdue = 0;
  let dueSoon = 0;
  for (const view of views) {
    if (view.balancePaise <= 0) continue;
    const due = Date.parse(view.invoice.dueAtIso);
    if (Number.isNaN(due)) continue;
    if (due < nowMs) overdue += 1;
    else if (due <= dueSoonEnd) dueSoon += 1;
  }
  return { overdue, dueSoon };
}

const RESULT_SEGMENTS: ReadonlyArray<{ label: string; statuses: readonly string[]; tone: ChartTone }> = [
  { label: "Entry", statuses: ["draft", "returned"], tone: "muted" },
  { label: "In review", statuses: ["submitted", "moderation"], tone: "saffron" },
  { label: "Approved", statuses: ["approved"], tone: "ink" },
  { label: "Published", statuses: ["published"], tone: "willow" },
  { label: "Withdrawn", statuses: ["withdrawn"], tone: "madder" },
];

export function resultsBySection(batches: EntryBatch[]): SectionProgress[] {
  const groups = new Map<string, EntryBatch[]>();
  for (const batch of batches) {
    const key = batch.className || "Unassigned";
    groups.set(key, [...(groups.get(key) ?? []), batch]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, rows]) => ({
      label,
      total: rows.length,
      segments: RESULT_SEGMENTS.map((segment) => ({
        label: segment.label,
        value: rows.filter((row) => segment.statuses.includes(row.status)).length,
        tone: segment.tone,
      })).filter((segment) => segment.value > 0),
    }));
}

export function supportBars(rows: Grievance[]): BarDatum[] {
  const count = (status: Grievance["status"]) => rows.filter((row) => row.status === status).length;
  return [
    { label: "New", value: count("New"), tone: "saffron" },
    { label: "In progress", value: count("In progress"), tone: "ink" },
    { label: "Resolved", value: count("Resolved"), tone: "willow" },
  ];
}

export function contentBars(rows: ContentNotice[]): BarDatum[] {
  const count = (status: ContentNotice["reviewStatus"]) => rows.filter((row) => row.reviewStatus === status).length;
  return [
    { label: "Draft", value: count("draft"), tone: "muted" },
    { label: "In review", value: count("in_review"), tone: "saffron" },
    { label: "Approved", value: count("approved"), tone: "ink" },
    { label: "Published", value: count("published"), tone: "willow" },
  ];
}

export function guardianAccessBars(rows: GuardianAdminRow[]): BarDatum[] {
  const count = (...states: GuardianAdminRow["accessState"][]) => rows.filter((row) => states.includes(row.accessState)).length;
  return [
    { label: "Active", value: count("active"), tone: "willow" },
    { label: "Activation pending", value: count("invited"), tone: "saffron" },
    { label: "Awaiting activation", value: count("not_activated", "expired", "delivery_failed", "revoked"), tone: "ink" },
    { label: "No email recorded", value: count("no_contact"), tone: "muted" },
    { label: "Suspended", value: count("suspended"), tone: "madder" },
  ];
}

/* ------------------------------------------------------------------ */
/* Activity — audit events bucketed by Asia/Kolkata day                  */
/* ------------------------------------------------------------------ */

const KOLKATA_DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const KOLKATA_DAY_LABEL = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});

function kolkataDayKey(ms: number): string {
  return KOLKATA_DAY_KEY.format(ms);
}

function dayKeyToUtcMs(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

export const ACTIVITY_DAYS = 14;

/**
 * Per-day event counts for the trailing window. The window ends on the
 * Asia/Kolkata day of the most recent event (or today when the trail is
 * empty), so the chart reports real work instead of a flat line of zeros
 * when recorded activity predates today.
 */
export function activityByDay(events: AuditEvent[], nowMs: number, days = ACTIVITY_DAYS): ActivityModel {
  const sorted = [...events].sort((a, b) => b.timestampIso.localeCompare(a.timestampIso));
  const latestMs = sorted.length > 0 ? Date.parse(sorted[0]!.timestampIso) : Number.NaN;
  const endKey = kolkataDayKey(Number.isNaN(latestMs) ? nowMs : latestMs);
  const startMs = dayKeyToUtcMs(endKey) - (days - 1) * 86_400_000;
  const buckets = new Map<string, number>();
  for (const event of sorted) {
    const key = kolkataDayKey(Date.parse(event.timestampIso));
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const dayList: ActivityDay[] = [];
  let windowTotal = 0;
  for (let index = 0; index < days; index += 1) {
    const dayMs = startMs + index * 86_400_000;
    /* Noon UTC on the key date always lands inside that Asia/Kolkata day. */
    const key = kolkataDayKey(dayMs + 12 * 3_600_000);
    const count = buckets.get(key) ?? 0;
    windowTotal += count;
    dayList.push({ key, label: KOLKATA_DAY_LABEL.format(dayMs + 12 * 3_600_000), count });
  }
  return {
    days: dayList,
    latest: sorted.slice(0, 6).map((event) => ({
      id: event.id,
      atIso: event.timestampIso,
      action: event.action,
      target: event.target,
      outcome: event.outcome,
    })),
    total: sorted.length,
    windowTotal,
  };
}

/* ------------------------------------------------------------------ */
/* Queue rows                                                           */
/* ------------------------------------------------------------------ */

function countOr<T>(source: Source<T[]>, derive: (rows: T[]) => number): number | null {
  return source.kind === "ok" ? derive(source.value) : null;
}

function administratorApprovals(input: {
  admissions: Source<StaffQueueRecord[]>;
  careers: Source<JobApplicationRecord[]>;
  results: Source<EntryBatch[]>;
  content: Source<ContentNotice[]>;
  pendingLinks: Source<number>;
}): QueueRow[] {
  const rows: QueueRow[] = [];
  if (input.admissions.kind !== "hidden") {
    rows.push({
      key: "admissions-offers",
      title: "Admission offers awaiting decision",
      detail: "Offered applications need your final call",
      count: countOr(input.admissions, (rows_) => rows_.filter((row) => row.status === "Offered").length),
      href: "/admissions",
    });
  }
  if (input.results.kind !== "hidden") {
    rows.push({
      key: "results-review",
      title: "Result sheets to moderate",
      detail: "Submitted or in moderation",
      count: countOr(input.results, (rows_) => rows_.filter((row) => ["submitted", "moderation"].includes(row.status)).length),
      href: "/results",
    });
    rows.push({
      key: "results-publish",
      title: "Result sheets to publish",
      detail: "Approved sheets awaiting release",
      count: countOr(input.results, (rows_) => rows_.filter((row) => row.status === "approved").length),
      href: "/results",
    });
  }
  if (input.content.kind !== "hidden") {
    rows.push({
      key: "content-review",
      title: "Notices awaiting approval",
      detail: "Drafts submitted for publication review",
      count: countOr(input.content, (rows_) => rows_.filter((row) => row.reviewStatus === "in_review").length),
      href: "/notices",
    });
  }
  if (input.careers.kind !== "hidden") {
    rows.push({
      key: "careers-offers",
      title: "Candidate offers to decide",
      detail: "Shortlisted applications awaiting an offer",
      count: countOr(input.careers, (rows_) => rows_.filter((row) => row.status === "Shortlisted").length),
      href: "/careers",
    });
  }
  if (input.pendingLinks.kind !== "hidden") {
    rows.push({
      key: "guardian-links",
      title: "Guardian link requests",
      detail: "Family access claims to verify",
      count: input.pendingLinks.kind === "ok" ? input.pendingLinks.value : null,
      href: "/link-requests",
    });
  }
  return rows;
}

function principalDrafting(input: {
  admissions: Source<StaffQueueRecord[]>;
  results: Source<EntryBatch[]>;
  content: Source<ContentNotice[]>;
  support: Source<Grievance[]>;
  timetable: Source<TimetableSummary>;
}): QueueRow[] {
  const rows: QueueRow[] = [];
  if (input.admissions.kind !== "hidden") {
    rows.push({
      key: "admissions-review",
      title: "Applications to review",
      detail: "Submitted, under review, or returned for changes",
      count: countOr(input.admissions, (rows_) => rows_.filter((row) => ["Submitted", "Under review", "Changes requested"].includes(row.status)).length),
      href: "/admissions",
    });
  }
  if (input.results.kind !== "hidden") {
    rows.push({
      key: "results-entry",
      title: "Marks entry to finish",
      detail: "Draft sheets and sheets returned for correction",
      count: countOr(input.results, (rows_) => rows_.filter((row) => ["draft", "returned"].includes(row.status)).length),
      href: "/results",
    });
  }
  if (input.content.kind !== "hidden") {
    rows.push({
      key: "content-draft",
      title: "Notices in draft",
      detail: "Drafts to finish and submit for approval",
      count: countOr(input.content, (rows_) => rows_.filter((row) => row.reviewStatus === "draft").length),
      href: "/notices",
    });
  }
  if (input.timetable.kind !== "hidden") {
    rows.push({
      key: "timetable-drafts",
      title: "Timetable drafts",
      detail: "Unpublished timetable versions",
      count: input.timetable.kind === "ok" ? input.timetable.value.drafts : null,
      href: "/timetables",
    });
  }
  if (input.support.kind !== "hidden") {
    rows.push({
      key: "support-new",
      title: "New support concerns",
      detail: "Unanswered grievances in the inbox",
      count: countOr(input.support, (rows_) => rows_.filter((row) => row.status === "New").length),
      href: "/support",
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Loaders                                                              */
/* ------------------------------------------------------------------ */

async function attempt<T>(promise: Promise<T>): Promise<Source<T>> {
  try {
    return ok(await promise);
  } catch {
    return SOURCE_ERROR;
  }
}

function hiddenUnless<T>(allowed: boolean, promise: () => Promise<T>): Promise<Source<T>> {
  return allowed ? attempt(promise()) : Promise.resolve(SOURCE_HIDDEN);
}

async function loadPendingLinks(supabaseMode: boolean): Promise<number> {
  if (supabaseMode) {
    const page = await familyContextService.listLinkRequestSummaries(0, 1);
    return page.total;
  }
  const [requests, links] = await Promise.all([
    familyContextService.listLinkRequests(),
    familyContextService.listLinkRequestSummaries(),
  ]);
  return (
    requests.rows.filter((row) => row.request.status === "pending").length +
    links.rows.filter((row) => row.link.status === "pending_verification").length
  );
}

async function loadTimetableSummary(): Promise<TimetableSummary> {
  const classes = await timetableService.listTimetableClasses();
  const versions = await Promise.all(classes.map((className) => timetableService.getTimetableVersionList(className)));
  const perClass = classes.map((label, index) => {
    const list = versions[index] ?? [];
    const current = list.find((entry) => entry.status === "draft") ?? list[0];
    return { label, status: current?.status ?? "none" };
  });
  const flat = versions.flat();
  return {
    classes: classes.length,
    published: flat.filter((entry) => entry.status === "published").length,
    drafts: flat.filter((entry) => entry.status === "draft").length,
    perClass,
  };
}

function queueState(sources: ReadonlyArray<Source<unknown>>): "ok" | "error" | "hidden" {
  const visible = sources.filter((source) => source.kind !== "hidden");
  if (visible.length === 0) return "hidden";
  return visible.every((source) => source.kind === "error") ? "error" : "ok";
}

export const dashboardService = {
  async loadAdministrator(roles: ReadonlyArray<string>, opts: { nowMs?: number } = {}): Promise<AdministratorDashboard> {
    const nowMs = opts.nowMs ?? Date.now();
    const supabaseMode = clientAdapterMode() === "supabase";
    const gates = {
      admissions: canAnyRole(roles, "admissions.view"),
      careers: canAnyRole(roles, "careers.view"),
      finance: canAnyRole(roles, "finance.view"),
      support: canAnyRole(roles, "support.view"),
      results: canAnyRole(roles, "results.view"),
      content: canAnyRole(roles, "content.view"),
      links: canAnyRole(roles, "links.verify"),
      audit: canAnyRole(roles, "audit.view"),
    };
    const [admissions, careers, finance, support, results, content, guardians, pendingLinks, auditPage] =
      await Promise.all([
        hiddenUnless(gates.admissions, () => admissionsService.listStaffRecords()),
        hiddenUnless(gates.careers, () => careersService.listStaffRecords()),
        hiddenUnless(gates.finance, () => financeService.listAllInvoices()),
        hiddenUnless(gates.support, () => supportService.listGrievances()),
        hiddenUnless(gates.results, () => academicsService.listBatches()),
        hiddenUnless(gates.content, () => contentService.listForStaff()),
        hiddenUnless(gates.links, () => guardiansService.list()),
        hiddenUnless(gates.links, () => loadPendingLinks(supabaseMode)),
        hiddenUnless(gates.audit, () => auditService.listEventsPage({ limit: 100 })),
      ]);

    const kpis: KpiTile[] = [];
    if (admissions.kind !== "hidden") {
      kpis.push({
        key: "pipeline",
        label: "Applications in pipeline",
        value: admissions.kind === "ok" ? String(admissionsPipelineCount(admissions.value)) : null,
        secondary: admissions.kind === "ok"
          ? `${admissions.value.filter((row) => row.status === "Offered").length} awaiting your decision`
          : "Open the admissions queue",
        href: "/admissions",
      });
    }
    if (finance.kind !== "hidden") {
      const dueCounts = finance.kind === "ok" ? invoiceDueCounts(finance.value, nowMs) : null;
      kpis.push({
        key: "fees",
        label: "Fees outstanding",
        value: finance.kind === "ok" ? formatINR(finance.value.reduce((sum, view) => sum + view.balancePaise, 0)) : null,
        secondary: dueCounts === null ? "Open the fee ledger" : `${dueCounts.overdue} overdue · ${dueCounts.dueSoon} due in ${DUE_SOON_DAYS} days`,
        href: "/finance",
      });
    }
    if (results.kind !== "hidden") {
      kpis.push({
        key: "results",
        label: "Results awaiting decision",
        value: results.kind === "ok"
          ? String(results.value.filter((row) => ["submitted", "moderation", "approved"].includes(row.status)).length)
          : null,
        secondary: results.kind === "ok"
          ? `${results.value.filter((row) => row.status === "published").length} published this term`
          : "Open the results register",
        href: "/results",
      });
    }
    if (guardians.kind !== "hidden") {
      kpis.push({
        key: "guardians",
        label: "Guardian portal access",
        value: guardians.kind === "ok"
          ? `${guardians.value.filter((row) => row.accessState === "active").length} / ${guardians.value.length}`
          : null,
        secondary: guardians.kind === "ok"
          ? `${guardians.value.filter((row) => row.accessState === "invited").length} activation pending`
          : "Open the guardians register",
        href: "/guardians",
      });
    }

    const approvals = administratorApprovals({ admissions, careers, results, content, pendingLinks });

    return {
      kpis,
      approvals,
      approvalsState: queueState([admissions, careers, results, content, pendingLinks]),
      activity: auditPage.kind === "ok" ? ok(activityByDay(auditPage.value.events, nowMs)) : auditPage as Source<ActivityModel>,
      funnel: admissions.kind === "ok" ? ok(admissionsFunnel(admissions.value)) : admissions as Source<BarDatum[]>,
      feeCollection: finance.kind === "ok" ? ok(feeCollection(finance.value, nowMs)) : finance as Source<FeeCollection>,
      resultsProgress: results.kind === "ok" ? ok(resultsBySection(results.value)) : results as Source<SectionProgress[]>,
      support: support.kind === "ok" ? ok(supportBars(support.value)) : support as Source<BarDatum[]>,
      content: content.kind === "ok" ? ok(contentBars(content.value)) : content as Source<BarDatum[]>,
      guardianAccess: guardians.kind === "ok" ? ok(guardianAccessBars(guardians.value)) : guardians as Source<BarDatum[]>,
      records: {
        admissions: admissions.kind === "ok" ? admissions.value : [],
        jobs: careers.kind === "ok" ? careers.value : [],
      },
    };
  },

  async loadPrincipal(roles: ReadonlyArray<string>, opts: { nowMs?: number } = {}): Promise<PrincipalDashboard> {
    const nowMs = opts.nowMs ?? Date.now();
    const gates = {
      admissions: canAnyRole(roles, "admissions.view"),
      careers: canAnyRole(roles, "careers.view"),
      results: canAnyRole(roles, "results.view"),
      content: canAnyRole(roles, "content.view"),
      support: canAnyRole(roles, "support.view"),
      timetable: canAnyRole(roles, "timetable.view"),
      audit: canAnyRole(roles, "audit.view"),
    };
    const [admissions, careers, results, content, support, timetable, auditPage] = await Promise.all([
      hiddenUnless(gates.admissions, () => admissionsService.listStaffRecords()),
      hiddenUnless(gates.careers, () => careersService.listStaffRecords()),
      hiddenUnless(gates.results, () => academicsService.listBatches()),
      hiddenUnless(gates.content, () => contentService.listForStaff()),
      hiddenUnless(gates.support, () => supportService.listGrievances()),
      hiddenUnless(gates.timetable, () => loadTimetableSummary()),
      hiddenUnless(gates.audit, () => auditService.listEventsPage({ limit: 100 })),
    ]);

    const kpis: KpiTile[] = [];
    if (admissions.kind !== "hidden") {
      kpis.push({
        key: "review",
        label: "Applications to review",
        value: admissions.kind === "ok"
          ? String(admissions.value.filter((row) => ["Submitted", "Under review", "Changes requested"].includes(row.status)).length)
          : null,
        secondary: admissions.kind === "ok"
          ? `${admissions.value.filter((row) => row.status === "Assessment").length} in assessment`
          : "Open the admissions queue",
        href: "/admissions",
      });
    }
    if (results.kind !== "hidden") {
      kpis.push({
        key: "marks",
        label: "Marks entry in progress",
        value: results.kind === "ok"
          ? String(results.value.filter((row) => ["draft", "returned"].includes(row.status)).length)
          : null,
        secondary: results.kind === "ok"
          ? `${results.value.filter((row) => row.status === "returned").length} returned for correction`
          : "Open the results register",
        href: "/results",
      });
    }
    if (content.kind !== "hidden") {
      kpis.push({
        key: "notices",
        label: "Notices in draft or review",
        value: content.kind === "ok"
          ? String(content.value.filter((row) => ["draft", "in_review"].includes(row.reviewStatus)).length)
          : null,
        secondary: content.kind === "ok"
          ? `${content.value.filter((row) => row.reviewStatus === "published").length} published`
          : "Open the notices register",
        href: "/notices",
      });
    }
    if (support.kind !== "hidden") {
      kpis.push({
        key: "support",
        label: "New support concerns",
        value: support.kind === "ok" ? String(support.value.filter((row) => row.status === "New").length) : null,
        secondary: support.kind === "ok"
          ? `${support.value.filter((row) => row.status === "In progress").length} in progress`
          : "Open the support inbox",
        href: "/support",
      });
    }

    const drafting = principalDrafting({ admissions, results, content, support, timetable });

    return {
      kpis,
      drafting,
      draftingState: queueState([admissions, results, content, support, timetable]),
      activity: auditPage.kind === "ok" ? ok(activityByDay(auditPage.value.events, nowMs)) : auditPage as Source<ActivityModel>,
      funnel: admissions.kind === "ok" ? ok(admissionsFunnel(admissions.value)) : admissions as Source<BarDatum[]>,
      resultsProgress: results.kind === "ok" ? ok(resultsBySection(results.value)) : results as Source<SectionProgress[]>,
      support: support.kind === "ok" ? ok(supportBars(support.value)) : support as Source<BarDatum[]>,
      content: content.kind === "ok" ? ok(contentBars(content.value)) : content as Source<BarDatum[]>,
      timetable,
      records: {
        admissions: admissions.kind === "ok" ? admissions.value : [],
        jobs: careers.kind === "ok" ? careers.value : [],
      },
    };
  },
};
