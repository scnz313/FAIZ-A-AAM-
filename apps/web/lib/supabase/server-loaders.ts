import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverAdapterOperation } from "@/lib/supabase/adapter-server";
import { dataAdapter } from "@/lib/supabase/env";
import { getServerActor } from "@/lib/auth/actor";
import { isStaffPath } from "@/lib/auth/portal-routes";
import { admissionPublicConfiguration, contentListPublic, contentListPublicDownloads, contentPublicPageBody, financeListAllAttempts, financeListAttemptsForInvoices, financeListInvoicesPage, financeListMyInvoices, financeListMyReceipts, financeListReconciliationProjection, jobsListPublishedVacancies, resolveFamilyContext, resolveStaffContext, type FinanceAttemptProjectionRow, type FinanceReconciliationProjectionRow } from "@/lib/supabase/domain";
import { financeRegisterRange, financeRegisterView } from "@/modules/services/finance-register";
import type { ServerFamilyContextResponse } from "@/modules/services/family-context";
import type { ServerStaffContextResponse } from "@/modules/services/staff-context";
import { mapServerStaffContext } from "@/modules/services/staff-context";
import { parseSchoolLifePageBody, type SchoolLifePageBody, type StaffProfileCode } from "@fass/contracts";
import {
  mapServerInvoiceView,
  mapServerReceipt,
  type ServerInvoiceRow,
  type ServerReceiptRow,
} from "@/modules/services/finance-server-map";
import type { InvoiceView } from "@/modules/services/finance";
import type { Vacancy } from "@/modules/content/demo";
import { isNoticeExpired, mapServerContentRow, mapServerPublicDownloadRow, type ContentNotice, type DownloadItem, type ServerContentRow } from "@/modules/services/content";
import { mapServerJob, type JobApplicationRecord, type ServerJobRow } from "@/modules/services/careers";
import { mapServerApplication, type ApplicationRecord, type ServerAdmissionRow } from "@/modules/services/admissions";
import { mapServerResultBatch, mapServerResultVersion, type BatchVersion, type EntryBatch, type SupabaseResultRow } from "@/modules/services/academics";
import { mapRequesterSupportRow, mapServerSupportRow, type Grievance, type ServerSupportRow } from "@/modules/services/support";
import type { AdmissionConfiguration, AdmissionWindow, AdmissionDocumentRequirement, SchoolGrade } from "@/modules/services/school-config";
import type { AcademicYear } from "@fass/contracts";
import type { NotificationItem } from "@/modules/notifications/demo";
import { mapServerAuditEvent, type AuditEvent, type ServerAuditEventRow } from "@/modules/services/audit";
import { notificationHref, notificationKind, type NotificationAudience, type ServerNotificationRow } from "@/modules/services/notifications";

async function financeClient() {
  return createSupabaseServerClient();
}

async function requireServerActor() {
  const rawPathname = (await headers()).get("x-fass-pathname") ?? "/";
  const pathname = rawPathname.split("?")[0] ?? "/";
  const actor = await getServerActor();
  if (actor === null) {
    const signInPath = isStaffPath(pathname) ? "/sign-in/staff" : "/sign-in";
    redirect(`${signInPath}?next=${encodeURIComponent(rawPathname)}`);
  }
  if (isStaffPath(pathname) && actor.aal !== "aal2") {
    redirect(`/sign-in/totp?next=${encodeURIComponent(rawPathname)}`);
  }
  return actor;
}

/** Request-scoped family context for protected Server Components. */
export const loadServerFamilyContext = cache(async (): Promise<ServerFamilyContextResponse> => {
  const actor = await requireServerActor();
  const client = await createSupabaseServerClient();
  const cookieStore = await cookies();
  const result = await resolveFamilyContext(client, {
    studentId: cookieStore.get("fass-active-student")?.value,
  }, actor);
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Family context could not be loaded.");
  return result.value as unknown as ServerFamilyContextResponse;
});

/** Request-scoped staff context for protected Server Components. */
export const loadServerStaffContext = cache(async (): Promise<ServerStaffContextResponse> => {
  const actor = await requireServerActor();
  if (actor.aal !== "aal2") throw new Error("Staff verification is required.");
  const client = await createSupabaseServerClient();
  const cookieStore = await cookies();
  const result = await resolveStaffContext(client, actor.personId, cookieStore.get("fass-active-workspace")?.value, actor);
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Staff context could not be loaded.");
  return result.value as unknown as ServerStaffContextResponse;
});

/**
 * Resolve the active staff access-profile code for a Server Component. Returns
 * null outside Supabase mode or when the context is unavailable; the canonical
 * URL helper uses the Administrator portal as the safe user-facing fallback.
 */
export async function loadServerProfileCode(): Promise<StaffProfileCode | null> {
  if (dataAdapter() !== "supabase") return null;
  try {
    const serverContext = await loadServerStaffContext();
    return mapServerStaffContext(serverContext).summary.profileCode;
  } catch {
    return null;
  }
}

export const loadServerInvoices = cache(async (studentId?: string): Promise<InvoiceView[]> => {
  await requireServerActor();
  const client = await financeClient();
  const [invoiceResult, receiptResult] = await Promise.all([financeListMyInvoices(client), financeListMyReceipts(client)]);
  if (!invoiceResult.ok) throw new Error(invoiceResult.errors[0]?.message ?? "Invoices could not be loaded.");
  if (!receiptResult.ok) throw new Error(receiptResult.errors[0]?.message ?? "Receipts could not be loaded.");
  const receipts = (receiptResult.value as unknown as ServerReceiptRow[]).map(mapServerReceipt);
  return (invoiceResult.value as unknown as ServerInvoiceRow[])
    .filter((row) => studentId === undefined || row.student_id === studentId)
    .map((row) => mapServerInvoiceView(row, receipts) satisfies InvoiceView);
});

export type ServerInvoiceRegister = {
  views: InvoiceView[];
  invoiceIds: string[];
  total: number;
  page: number;
  pageCount: number;
  shownFrom: number;
  shownTo: number;
};

/** One page of the staff invoice register with an exact total. The nested
 *  projection is fetched per page, so a school-sized register stays bounded. */
export const loadServerInvoiceRegister = cache(async (requestedPage: number): Promise<ServerInvoiceRegister> => {
  await requireServerActor();
  const client = await financeClient();
  const first = financeRegisterRange(requestedPage);
  const firstResult = await financeListInvoicesPage(client, first);
  if (!firstResult.ok) throw new Error(firstResult.errors[0]?.message ?? "Invoices could not be loaded.");
  const firstView = financeRegisterView(requestedPage, firstResult.value.total);
  let rows = firstResult.value.rows as unknown as ServerInvoiceRow[];
  if (firstView.page !== Math.max(Math.trunc(requestedPage), 1)) {
    const retry = await financeListInvoicesPage(client, financeRegisterRange(firstView.page));
    if (!retry.ok) throw new Error(retry.errors[0]?.message ?? "Invoices could not be loaded.");
    rows = retry.value.rows as unknown as ServerInvoiceRow[];
  }
  return {
    views: rows.map((row) => mapServerInvoiceView(row)),
    invoiceIds: rows.flatMap((row) => (typeof row.id === "string" && row.id.length > 0 ? [row.id] : [])),
    total: firstResult.value.total,
    page: firstView.page,
    pageCount: firstView.pageCount,
    shownFrom: firstView.shownFrom,
    shownTo: firstView.shownTo,
  };
});

/** Attempts for one page's invoices (bounded by the page size). */
export async function loadServerPaymentAttemptsForInvoices(invoiceIds: string[]): Promise<FinanceAttemptProjectionRow[]> {
  await requireServerActor();
  const result = await financeListAttemptsForInvoices(await financeClient(), invoiceIds);
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Payment attempts could not be loaded.");
  return result.value;
}

export const loadServerActiveStudentInvoices = cache(async (): Promise<InvoiceView[]> => {
  const context = await loadServerFamilyContext();
  return loadServerInvoices(context.activeStudentId ?? undefined);
});

/* Request-scoped cache: the public careers pages read vacancies twice (list
   and detail); React `cache` collapses that to one Supabase round trip. */
export const loadServerVacancies = cache(async (): Promise<Vacancy[]> => {
  /* Published vacancies are a public projection with an `anon` RLS policy.
     Use the anonymous client so a signed-in applicant (authenticated role)
     still receives them; the request-aware client would miss that policy. */
  const result = await jobsListPublishedVacancies(createSupabasePublicClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Vacancies could not be loaded.");
  return result.value.map((row) => {
    const terms = row.terms;
    const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const titleSlug = row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    return {
      slug: titleSlug,
      title: row.title,
      department: row.department ?? "School office",
      location: typeof terms.location === "string" ? terms.location : "Faiz E Aam School",
      type: terms.type === "Non-teaching" ? "Non-teaching" : "Teaching",
      qualifications: stringArray(terms.qualifications),
      documents: stringArray(terms.documents),
      deadlineIso: typeof terms.deadlineIso === "string" ? terms.deadlineIso : new Date().toISOString(),
      status: "open",
      description: typeof terms.description === "string" ? terms.description : "Published vacancy details.",
      reference: row.reference,
      version: row.version,
    } satisfies Vacancy;
  });
});

export async function loadServerJobs(): Promise<JobApplicationRecord[]> {
  const result = await serverAdapterOperation<ServerJobRow[]>("jobs.staffQueue");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Applications could not be loaded.");
  return result.value.map(mapServerJob);
}

export async function loadServerJobByRef(reference: string): Promise<JobApplicationRecord | null> {
  /* The staff projection carries reviewer assignments and scorecards, which
     the owner-facing mine projection deliberately omits. The detail page is
     staff-only, so read the authorized staff queue. */
  const result = await serverAdapterOperation<ServerJobRow[]>("jobs.staffQueue");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Job application could not be loaded.");
  const row = result.value.find((candidate) => candidate.reference === reference);
  return row ? mapServerJob(row) : null;
}

export async function loadServerAdmissions(): Promise<ApplicationRecord[]> {
  const result = await serverAdapterOperation<ServerAdmissionRow[]>("admissions.staffQueue");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Admissions could not be loaded.");
  return result.value.map((row) => mapServerApplication(row));
}

export async function loadServerAdmissionByRef(reference: string): Promise<ApplicationRecord | null> {
  const result = await serverAdapterOperation<ServerAdmissionRow | null>("admissions.staffByRef", { applicationRef: reference });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Application could not be loaded.");
  const row = result.value;
  if (row === null) return null;
  const record = mapServerApplication(row);
  /* Enrolled records need the public conversion references, which live on the
     staff-only conversion row; the owner is authorized for these fields. */
  if (record.status !== "Enrolled" || (record.studentRef !== undefined && record.enrollmentRef !== undefined)) {
    return record;
  }
  const refs = await serverAdapterOperation<{ studentRef?: string; enrollmentRef?: string; linkRef?: string | null } | null>(
    "admissions.enrollmentReference",
    { applicationRef: reference },
  );
  if (!refs.ok || refs.value === null) return record;
  return {
    ...record,
    studentRef: refs.value.studentRef ?? record.studentRef,
    enrollmentRef: refs.value.enrollmentRef ?? record.enrollmentRef,
    linkRef: refs.value.linkRef ?? record.linkRef,
  };
}

/** Public-safe configuration loader; it does not call the authenticated
 * adapter route, so public admissions pages never self-fetch or invent data. */
export async function loadServerPublicAdmissionConfiguration(): Promise<AdmissionConfiguration> {
  const result = await admissionPublicConfiguration(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Admission configuration could not be loaded.");
  const raw = result.value as Record<string, unknown>;
  return {
    academicYears: (raw.academicYears as AcademicYear[]) ?? [],
    grades: (raw.grades as SchoolGrade[]) ?? [],
    windows: ((raw.windows as Record<string, unknown>[]) ?? []).map((w) => ({
      id: w.id as string,
      ref: w.ref as string,
      academicYearId: w.academicYearId as string,
      gradeId: w.gradeId as string,
      opensAtIso: (w.opensAtIso ?? w.opensAt) as string,
      closesAtIso: (w.closesAtIso ?? w.closesAt) as string,
      capacity: (w.capacity ?? null) as number | null,
      status: w.status as AdmissionWindow["status"],
      version: w.version as number,
      policy: (w.policy ?? {}) as Record<string, unknown>,
      eligibilityPolicy: (w.eligibilityPolicy ?? {}) as Record<string, unknown>,
    })),
    documentRequirements: (raw.documentRequirements as AdmissionDocumentRequirement[]) ?? [],
    policy: (raw.policy ?? null) as AdmissionConfiguration["policy"],
  };
}

export async function loadServerPaymentAttempts(): Promise<FinanceAttemptProjectionRow[]> {
  await requireServerActor();
  const result = await financeListAllAttempts(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Payment attempts could not be loaded.");
  return result.value;
}

/** Staff receipt projection (RLS staff_read_receipts): the same amounts the
 * family ledger reads, so staff receipt detail matches the guardian view. */
export async function loadServerStaffReceipts(): Promise<Array<ReturnType<typeof mapServerReceipt>>> {
  await requireServerActor();
  const result = await serverAdapterOperation<ServerReceiptRow[]>("finance.listAllReceipts");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Receipts could not be loaded.");
  return (result.value as unknown as ServerReceiptRow[]).map(mapServerReceipt);
}

export async function loadServerReconciliationProjection(): Promise<FinanceReconciliationProjectionRow[]> {
  await requireServerActor();
  const result = await financeListReconciliationProjection(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Reconciliation could not be loaded.");
  return result.value;
}

/** Results/timetable/remaining-domain loaders keep protected Server
 * Components on the server adapter boundary; they never issue an
 * unauthenticated relative fetch or seed client fixtures in Supabase mode. */
export async function loadServerResultsBatches(): Promise<EntryBatch[]> {
  const result = await serverAdapterOperation<SupabaseResultRow[]>("results.listBatches");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Results could not be loaded.");
  return result.value.map(mapServerResultBatch);
}

/* Request-scoped cache: the batch detail and entry pages read the same batch
   twice (metadata + render); React `cache` collapses that to one operation. */
export const loadServerResultBatch = cache(async (batchRef: string): Promise<EntryBatch | null> => {
  const result = await serverAdapterOperation<SupabaseResultRow | null>("results.getBatch", { batchRef });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Result batch could not be loaded.");
  return result.value === null ? null : mapServerResultBatch(result.value);
});

export async function loadServerResultVersions(batchRef: string): Promise<BatchVersion[]> {
  const result = await serverAdapterOperation<Array<{ version?: number; state?: string; note?: string | null; createdAt?: string; created_at?: string }>>("results.listVersions", { sheetRef: batchRef });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Result versions could not be loaded.");
  return (result.value ?? []).map(mapServerResultVersion);
}

export async function loadServerResultPublications(studentId?: string): Promise<unknown[]> {
  const result = await serverAdapterOperation<unknown[]>("results.listReleases", studentId ? { studentId } : {});
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Published results could not be loaded.");
  return result.value;
}

export async function loadServerTimetable(gradeSectionId: string): Promise<unknown | null> {
  const result = await serverAdapterOperation<unknown | null>("timetable.effective", { gradeSectionId });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Timetable could not be loaded.");
  return result.value;
}

export async function loadServerContent(scope: "public" | "family" | "staff"): Promise<ContentNotice[]> {
  const result = await serverAdapterOperation<ServerContentRow[]>("content.list", { scope });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Content could not be loaded.");
  /* The staff/family projections carry both notices and managed pages. This
     loader feeds the notice surfaces (portal list/overview and the staff
     notice register), so page rows must never be mapped into notice records. */
  const mapped = (result.value as unknown as ServerContentRow[])
    .filter((row) => row.kind === "notice")
    .map(mapServerContentRow);
  if (scope !== "family") return mapped;
  /* The portal copy promises that expired notices disappear automatically.
     The staff projection returns every workflow state, so the family boundary
     keeps only published, unexpired notices addressed to the public or to
     families. Drafts, schedules, archives, and expired rows never reach the
     guardian portal. */
  const nowIso = new Date().toISOString();
  return mapped.filter(
    (notice) =>
      notice.status === "published" &&
      !isNoticeExpired(notice, nowIso) &&
      (notice.audience === "public" || notice.audience === "family"),
  );
}

/** Anonymous public content never traverses the authenticated adapter route.
 * Supabase RLS/SECURITY DEFINER projections return only published public rows.
 * The projection also carries pages for the managed-page loader, so notice
 * consumers filter to kind='notice' before mapping; the audience guard keeps
 * family-targeted rows out of the public surface when a signed-in session is
 * present on an otherwise public page. */
/* One anonymous projection per request: the homepage resolves four managed
   page slugs plus the notice list, and each previously re-scanned the whole
   published corpus. React `cache` collapses them to a single read. */
const loadServerPublicContentRows = cache(async (): Promise<ServerContentRow[]> => {
  const result = await contentListPublic(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Public content could not be loaded.");
  return result.value as unknown as ServerContentRow[];
});

export async function loadServerPublicContent(): Promise<ContentNotice[]> {
  const rows = await loadServerPublicContentRows();
  const nowIso = new Date().toISOString();
  return rows
    .filter((row) => row.kind === "notice")
    .map(mapServerContentRow)
    .filter(
      (notice) =>
        notice.status === "published" && notice.audience === "public" && !isNoticeExpired(notice, nowIso),
    );
}

/** Published public page body for one route slug, or null when the page has
 * no published version. Reads through app.public_page_body so a newer
 * unpublished draft never takes the live page offline; the route keeps its
 * concept copy until the school publishes a managed page. */
export const loadServerPublicPageBody = cache(
  async (slug: string): Promise<{ title: string; body: string[]; updatedAtIso: string | null } | null> => {
    try {
      const res = await contentPublicPageBody(await financeClient(), slug);
      if (!res.ok || res.value === null) return null;
      const parsed = parseServerPageBody(res.value.body);
      return {
        title: typeof res.value.title === "string" && res.value.title !== "" ? res.value.title : "School page",
        body: parsed.length > 0 ? parsed : ["Published school page."],
        updatedAtIso: typeof res.value.publishedAt === "string" ? res.value.publishedAt : null,
      };
    } catch {
      return null;
    }
  },
);

/** Latest published School life body. Reads through app.public_page_body so a
 * newer unpublished draft never takes the live page offline; null → the
 * caller renders the shipped default. */
export const loadServerSchoolLifeBody = cache(async (): Promise<SchoolLifePageBody | null> => {
  try {
    const res = await contentPublicPageBody(await financeClient(), "school-life");
    if (!res.ok) return null;
    return parseSchoolLifePageBody(res.value?.body);
  } catch {
    return null;
  }
});

/** Anonymous-safe public downloads register. Reads the same rows the anon and
 * authenticated RLS policies allow (`public_approved` and a finalized
 * `clean`/`ready` scan) and strips everything but the safe register
 * metadata. */
export const loadServerPublicDownloads = cache(async (): Promise<DownloadItem[]> => {
  const result = await contentListPublicDownloads(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Public downloads could not be loaded.");
  return result.value.map(mapServerPublicDownloadRow);
});

function parseServerPageBody(value: unknown): string[] {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const object = value as { blocks?: unknown };
    if (Array.isArray(object.blocks)) {
      return object.blocks
        .map((block) => (typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : ""))
        .filter(Boolean);
    }
  }
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

export async function loadServerSupport(scope: "mine" | "staff"): Promise<Grievance[]> {
  const result = await serverAdapterOperation<ServerSupportRow[]>("support.list", { scope });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Support could not be loaded.");
  /* Requester scope strips staff-private notes/assignment at the boundary. */
  return scope === "mine" ? result.value.map(mapRequesterSupportRow) : result.value.map(mapServerSupportRow);
}

export async function loadServerNotifications(audience: NotificationAudience = "family"): Promise<NotificationItem[]> {
  const result = await serverAdapterOperation<ServerNotificationRow[]>("notifications.list");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Notifications could not be loaded.");
  return result.value.map((item) => ({ id: item.id, version: item.version ?? 1, kind: notificationKind(item), text: item.body ? `${item.title} — ${item.body}` : item.title, atIso: item.created_at, unread: item.read_at === null, href: notificationHref(item, audience) }));
}

export async function loadServerAudit(): Promise<AuditEvent[]> {
  const result = await serverAdapterOperation<ServerAuditEventRow[]>("audit.list", { limit: 100 });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Audit could not be loaded.");
  return result.value.map(mapServerAuditEvent);
}

/**
 * First page of the live audit register (newest first) plus the cursor for
 * walking older history. Uses the paginated projection so the page can load
 * beyond the first page instead of silently stopping at a cap.
 */
export async function loadServerAuditPage(limit = 50): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const result = await serverAdapterOperation<ServerAuditEventRow[]>("audit.listPage", { limit, cursor: null });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Audit could not be loaded.");
  const events = result.value.map(mapServerAuditEvent);
  const last = events[events.length - 1];
  return { events, nextCursor: events.length === limit && last !== undefined ? last.timestampIso : null };
}

export type ServerDocumentProjection = { ref: string; ownerReference?: string; category: string; filename: string; processingState: string; mimeType: string; sizeBytes: number };

export async function loadServerDocuments(ownerDomain: string, ownerRecordId: string): Promise<ServerDocumentProjection[]> {
  const result = await serverAdapterOperation<Array<{ reference?: string; ref?: string; ownerReference?: string; category: string; filename?: string; safe_filename?: string; processingState?: string; status?: string; mimeType?: string; mime_type?: string; sizeBytes?: number; size_bytes?: number }>>("documents.list", { ownerDomain, ownerRecordId });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Documents could not be loaded.");
  return result.value.map((row) => ({ ref: row.ref ?? row.reference ?? "", ownerReference: row.ownerReference, category: row.category, filename: row.filename ?? row.safe_filename ?? "", processingState: row.processingState ?? row.status ?? "pending_scan", mimeType: row.mimeType ?? row.mime_type ?? "", sizeBytes: row.sizeBytes ?? row.size_bytes ?? 0 }));
}
