import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverAdapterOperation } from "@/lib/supabase/adapter-server";
import { getServerActor } from "@/lib/auth/actor";
import { admissionPublicConfiguration, contentListPublic, financeListAllAttempts, financeListMyInvoices, financeListMyReceipts, financeListReconciliationProjection, jobsListPublishedVacancies, resolveFamilyContext, resolveStaffContext, type FinanceAttemptProjectionRow, type FinanceReconciliationProjectionRow } from "@/lib/supabase/domain";
import type { ServerFamilyContextResponse } from "@/modules/services/family-context";
import type { ServerStaffContextResponse } from "@/modules/services/staff-context";
import {
  mapServerInvoiceView,
  mapServerReceipt,
  type ServerInvoiceRow,
  type ServerReceiptRow,
} from "@/modules/services/finance-server-map";
import type { InvoiceView, Receipt } from "@/modules/services/finance";
import type { Vacancy } from "@/modules/content/demo";
import { mapServerContentRow, type ContentNotice, type ServerContentRow } from "@/modules/services/content";
import { mapServerJob, type JobApplicationRecord, type ServerJobRow } from "@/modules/services/careers";
import { mapServerApplication, type ApplicationRecord, type ServerAdmissionRow } from "@/modules/services/admissions";
import { mapServerSupportRow, type Grievance, type ServerSupportRow } from "@/modules/services/support";
import type { AdmissionConfiguration, AdmissionWindow, AdmissionDocumentRequirement, SchoolGrade } from "@/modules/services/school-config";
import type { AcademicYear } from "@fass/contracts";
import type { NotificationItem } from "@/modules/notifications/demo";
import { notificationHref, notificationKind, type ServerNotificationRow } from "@/modules/services/notifications";

async function financeClient() {
  return createSupabaseServerClient();
}

async function requireServerActor() {
  const pathname = (await headers()).get("x-fass-pathname") ?? "/";
  const actor = await getServerActor();
  if (actor === null) {
    const signInPath = pathname.startsWith("/staff") ? "/sign-in/staff" : "/sign-in";
    redirect(`${signInPath}?next=${encodeURIComponent(pathname)}`);
  }
  if (pathname.startsWith("/staff") && actor.aal !== "aal2") {
    redirect(`/sign-in/totp?next=${encodeURIComponent(pathname)}`);
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

export const loadServerActiveStudentInvoices = cache(async (): Promise<InvoiceView[]> => {
  const context = await loadServerFamilyContext();
  return loadServerInvoices(context.activeStudentId ?? undefined);
});

export async function loadServerVacancies(): Promise<Vacancy[]> {
  const result = await jobsListPublishedVacancies(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Vacancies could not be loaded.");
  return result.value.map((row) => {
    const terms = row.terms;
    const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const titleSlug = row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    return {
      slug: titleSlug,
      title: row.title,
      department: row.department ?? "School office",
      location: typeof terms.location === "string" ? terms.location : "Faiz Aam School",
      type: terms.type === "Non-teaching" ? "Non-teaching" : "Teaching",
      qualifications: stringArray(terms.qualifications),
      documents: stringArray(terms.documents),
      deadlineIso: typeof terms.deadlineIso === "string" ? terms.deadlineIso : new Date().toISOString(),
      status: "open",
      description: typeof terms.description === "string" ? terms.description : "Published vacancy details.",
    } satisfies Vacancy;
  });
}

export async function loadServerJobs(): Promise<JobApplicationRecord[]> {
  const result = await serverAdapterOperation<ServerJobRow[]>("jobs.staffQueue");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Applications could not be loaded.");
  return result.value.map(mapServerJob);
}

export async function loadServerJobByRef(reference: string): Promise<JobApplicationRecord | null> {
  const result = await serverAdapterOperation<ServerJobRow[]>("jobs.listMine");
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
  const result = await serverAdapterOperation<ServerAdmissionRow[]>("admissions.listMine");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Application could not be loaded.");
  const row = result.value.find((candidate) => candidate.reference === reference);
  return row ? mapServerApplication(row) : null;
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

export async function loadServerReceipts(): Promise<Receipt[]> {
  await requireServerActor();
  const result = await financeListMyReceipts(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Receipts could not be loaded.");
  return (result.value as unknown as ServerReceiptRow[]).map(mapServerReceipt);
}

export async function loadServerPaymentAttempts(): Promise<FinanceAttemptProjectionRow[]> {
  await requireServerActor();
  const result = await financeListAllAttempts(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Payment attempts could not be loaded.");
  return result.value;
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
export async function loadServerResultsBatches(): Promise<unknown[]> {
  const result = await serverAdapterOperation<unknown[]>("results.listBatches");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Results could not be loaded.");
  return result.value;
}

export async function loadServerResultBatch(batchId: string): Promise<unknown> {
  const result = await serverAdapterOperation<unknown>("results.getBatch", { batchRef: batchId });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Result batch could not be loaded.");
  return result.value;
}

export async function loadServerResultVersions(batchRef: string): Promise<unknown[]> {
  const result = await serverAdapterOperation<unknown[]>("results.listVersions", { sheetRef: batchRef });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Result versions could not be loaded.");
  return result.value;
}

export async function loadServerResultPublications(studentId?: string): Promise<unknown[]> {
  const result = await serverAdapterOperation<unknown[]>("results.listReleases", studentId ? { studentRef: studentId } : {});
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Published results could not be loaded.");
  return result.value;
}

export async function loadServerTimetable(gradeSectionId: string): Promise<unknown | null> {
  const result = await serverAdapterOperation<unknown | null>("timetable.effective", { gradeSectionRef: gradeSectionId });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Timetable could not be loaded.");
  return result.value;
}

export async function loadServerContent(scope: "public" | "family" | "staff"): Promise<ContentNotice[]> {
  const result = await serverAdapterOperation<ServerContentRow[]>("content.list", { scope });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Content could not be loaded.");
  return (result.value as unknown as ServerContentRow[]).map(mapServerContentRow);
}

/** Anonymous public content never traverses the authenticated adapter route.
 * Supabase RLS/SECURITY DEFINER projections return only published public rows. */
export async function loadServerPublicContent(): Promise<ContentNotice[]> {
  const result = await contentListPublic(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Public content could not be loaded.");
  return (result.value as unknown as ServerContentRow[]).map(mapServerContentRow);
}

/** Published public page body for one route slug, or null when the page is
 * not published. Falls back to nothing so the route can keep its concept
 * copy until the school publishes a managed page. */
export async function loadServerPublicPageBody(slug: string): Promise<{ title: string; body: string[]; updatedAtIso: string | null } | null> {
  const result = await contentListPublic(await financeClient());
  if (!result.ok) return null;
  const row = (result.value as unknown as ServerContentRow[]).find(
    (candidate) => candidate.kind === "page" && candidate.slug === slug && candidate.current_status === "published",
  );
  if (!row) return null;
  const { mapServerPublicPageRow } = await import("@/modules/services/content");
  const page = mapServerPublicPageRow(row);
  if (page.reviewStatus !== "published") return null;
  const versionRow = [...(row.content_versions ?? [])].sort((left, right) => right.version - left.version)[0];
  if (!versionRow) return null;
  const parsed = parseServerPageBody(versionRow.body);
  return {
    title: versionRow.title,
    body: parsed.length > 0 ? parsed : ["Published school page."],
    updatedAtIso: versionRow.published_at ?? versionRow.created_at,
  };
}

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
  return result.value.map(mapServerSupportRow);
}

export async function loadServerNotifications(): Promise<NotificationItem[]> {
  const result = await serverAdapterOperation<ServerNotificationRow[]>("notifications.list");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Notifications could not be loaded.");
  return result.value.map((item) => ({ id: item.id, version: item.version ?? 1, kind: notificationKind(item), text: item.body ? `${item.title} — ${item.body}` : item.title, atIso: item.created_at, unread: item.read_at === null, href: notificationHref(item) }));
}

export async function loadServerAudit(): Promise<unknown[]> {
  const result = await serverAdapterOperation<unknown[]>("audit.list", { limit: 100 });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Audit could not be loaded.");
  return result.value;
}

export type ServerDocumentProjection = { ref: string; ownerReference?: string; category: string; filename: string; processingState: string; mimeType: string; sizeBytes: number };

export async function loadServerDocuments(ownerDomain: string, ownerRecordId: string): Promise<ServerDocumentProjection[]> {
  const result = await serverAdapterOperation<Array<{ reference?: string; ref?: string; ownerReference?: string; category: string; filename?: string; safe_filename?: string; processingState?: string; status?: string; mimeType?: string; mime_type?: string; sizeBytes?: number; size_bytes?: number }>>("documents.list", { ownerDomain, ownerRecordId });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Documents could not be loaded.");
  return result.value.map((row) => ({ ref: row.ref ?? row.reference ?? "", ownerReference: row.ownerReference, category: row.category, filename: row.filename ?? row.safe_filename ?? "", processingState: row.processingState ?? row.status ?? "pending_scan", mimeType: row.mimeType ?? row.mime_type ?? "", sizeBytes: row.sizeBytes ?? row.size_bytes ?? 0 }));
}
