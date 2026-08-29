import "server-only";

import { cookies } from "next/headers";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverAdapterCall } from "@/lib/supabase/adapter-server";
import { getServerActor } from "@/lib/auth/actor";
import { admissionPublicConfiguration, contentListPublic, financeListAllAttempts, financeListMyInvoices, financeListMyReceipts, financeListReconciliationProjection, jobsListPublishedVacancies, resolveFamilyContext, resolveStaffContext, type FinanceAttemptProjectionRow, type FinanceReconciliationProjectionRow } from "@/lib/supabase/domain";
import type { ServerFamilyContextResponse } from "@/modules/services/family-context";
import type { ServerStaffContextResponse } from "@/modules/services/staff-context";
import {
  invoiceSummary,
  mapServerInvoice,
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
import type { AdmissionConfiguration } from "@/modules/services/school-config";
import type { NotificationItem, NotificationKind } from "@/modules/notifications/demo";

async function financeClient() {
  return createSupabaseServerClient();
}

/** Request-scoped family context for protected Server Components. */
export async function loadServerFamilyContext(): Promise<ServerFamilyContextResponse> {
  const client = await createSupabaseServerClient();
  const cookieStore = await cookies();
  const result = await resolveFamilyContext(client, {
    studentId: cookieStore.get("fass-active-student")?.value,
  });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Family context could not be loaded.");
  return result.value as unknown as ServerFamilyContextResponse;
}

/** Request-scoped staff context for protected Server Components. */
export async function loadServerStaffContext(): Promise<ServerStaffContextResponse> {
  const actor = await getServerActor();
  if (actor === null) throw new Error("Staff context requires an authenticated account.");
  if (actor.aal !== "aal2") throw new Error("Staff verification is required.");
  const client = await createSupabaseServerClient();
  const cookieStore = await cookies();
  const result = await resolveStaffContext(client, actor.personId, cookieStore.get("fass-active-workspace")?.value);
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Staff context could not be loaded.");
  return result.value as unknown as ServerStaffContextResponse;
}

export async function loadServerInvoices(studentId?: string): Promise<InvoiceView[]> {
  const client = await financeClient();
  const [invoiceResult, receiptResult] = await Promise.all([financeListMyInvoices(client), financeListMyReceipts(client)]);
  if (!invoiceResult.ok) throw new Error(invoiceResult.errors[0]?.message ?? "Invoices could not be loaded.");
  if (!receiptResult.ok) throw new Error(receiptResult.errors[0]?.message ?? "Receipts could not be loaded.");
  const receipts = (receiptResult.value as unknown as ServerReceiptRow[]).map(mapServerReceipt);
  return (invoiceResult.value as unknown as ServerInvoiceRow[])
    .filter((row) => studentId === undefined || row.student_id === studentId)
    .map((row) => {
    const invoice = mapServerInvoice(row);
    const totals = invoiceSummary(invoice);
    return {
      invoice,
      studentId: invoice.studentId,
      studentName: "Linked student",
      status: invoice.status,
      ...totals,
      payments: invoice.payments,
      receipts: receipts.filter((receipt) => receipt.invoiceRef === invoice.ref),
      ledgerEntries: [],
    } satisfies InvoiceView;
    });
}

export async function loadServerActiveStudentInvoices(): Promise<InvoiceView[]> {
  const contextResult = await resolveFamilyContext(await financeClient());
  if (!contextResult.ok) throw new Error(contextResult.errors[0]?.message ?? "Family context could not be loaded.");
  return loadServerInvoices(contextResult.value.activeStudentId ?? undefined);
}

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
  const result = await serverAdapterCall<ServerJobRow[]>("jobs.staffQueue");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Applications could not be loaded.");
  return result.value.map(mapServerJob);
}

export async function loadServerJobByRef(reference: string): Promise<JobApplicationRecord | null> {
  const result = await serverAdapterCall<ServerJobRow[]>("jobs.listMine");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Job application could not be loaded.");
  const row = result.value.find((candidate) => candidate.reference === reference);
  return row ? mapServerJob(row) : null;
}

export async function loadServerAdmissions(): Promise<ApplicationRecord[]> {
  const result = await serverAdapterCall<ServerAdmissionRow[]>("admissions.staffQueue");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Admissions could not be loaded.");
  return result.value.map((row) => mapServerApplication(row));
}

export async function loadServerAdmissionByRef(reference: string): Promise<ApplicationRecord | null> {
  const result = await serverAdapterCall<ServerAdmissionRow[]>("admissions.listMine");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Application could not be loaded.");
  const row = result.value.find((candidate) => candidate.reference === reference);
  return row ? mapServerApplication(row) : null;
}

/** Public-safe configuration loader; it does not call the authenticated
 * adapter route, so public admissions pages never self-fetch or invent data. */
export async function loadServerPublicAdmissionConfiguration(): Promise<AdmissionConfiguration> {
  const result = await admissionPublicConfiguration(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Admission configuration could not be loaded.");
  return result.value as unknown as AdmissionConfiguration;
}

export async function loadServerReceipts(): Promise<Receipt[]> {
  const result = await financeListMyReceipts(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Receipts could not be loaded.");
  return (result.value as unknown as ServerReceiptRow[]).map(mapServerReceipt);
}

export async function loadServerPaymentAttempts(): Promise<FinanceAttemptProjectionRow[]> {
  const result = await financeListAllAttempts(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Payment attempts could not be loaded.");
  return result.value;
}

export async function loadServerReconciliationProjection(): Promise<FinanceReconciliationProjectionRow[]> {
  const result = await financeListReconciliationProjection(await financeClient());
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Reconciliation could not be loaded.");
  return result.value;
}

/** Results/timetable/remaining-domain loaders keep protected Server
 * Components on the server adapter boundary; they never issue an
 * unauthenticated relative fetch or seed client fixtures in Supabase mode. */
export async function loadServerResultsBatches(): Promise<unknown[]> {
  const result = await serverAdapterCall<unknown[]>("results.listBatches");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Results could not be loaded.");
  return result.value;
}

export async function loadServerResultBatch(batchId: string): Promise<unknown> {
  const result = await serverAdapterCall<unknown>("results.getBatch", { batchRef: batchId });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Result batch could not be loaded.");
  return result.value;
}

export async function loadServerResultVersions(batchRef: string): Promise<unknown[]> {
  const result = await serverAdapterCall<unknown[]>("results.listVersions", { sheetRef: batchRef });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Result versions could not be loaded.");
  return result.value;
}

export async function loadServerResultPublications(studentId?: string): Promise<unknown[]> {
  const result = await serverAdapterCall<unknown[]>("results.listReleases", studentId ? { studentRef: studentId } : {});
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Published results could not be loaded.");
  return result.value;
}

export async function loadServerTimetable(gradeSectionId: string): Promise<unknown | null> {
  const result = await serverAdapterCall<unknown | null>("timetable.effective", { gradeSectionRef: gradeSectionId });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Timetable could not be loaded.");
  return result.value;
}

export async function loadServerContent(scope: "public" | "family" | "staff"): Promise<ContentNotice[]> {
  const result = await serverAdapterCall<ServerContentRow[]>("content.list", { scope });
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

export async function loadServerSupport(scope: "mine" | "staff"): Promise<Grievance[]> {
  const result = await serverAdapterCall<ServerSupportRow[]>("support.list", { scope });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Support could not be loaded.");
  return result.value.map(mapServerSupportRow);
}

export async function loadServerNotifications(): Promise<NotificationItem[]> {
  const result = await serverAdapterCall<Array<{ id: string; version?: number; kind: string; title: string; body: string | null; read_at: string | null; created_at: string }>>("notifications.list");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Notifications could not be loaded.");
  return result.value.map((item) => ({ id: item.id, version: item.version ?? 1, kind: item.kind as NotificationKind, text: item.body ? `${item.title} — ${item.body}` : item.title, atIso: item.created_at, unread: item.read_at === null }));
}

export async function loadServerAudit(): Promise<unknown[]> {
  const result = await serverAdapterCall<unknown[]>("audit.list", { limit: 100 });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Audit could not be loaded.");
  return result.value;
}

export type ServerDocumentProjection = { ref: string; ownerReference?: string; category: string; filename: string; processingState: string; mimeType: string; sizeBytes: number };

export async function loadServerDocuments(ownerDomain: string, ownerRecordId: string): Promise<ServerDocumentProjection[]> {
  const result = await serverAdapterCall<Array<{ reference?: string; ref?: string; ownerReference?: string; category: string; filename?: string; safe_filename?: string; processingState?: string; status?: string; mimeType?: string; mime_type?: string; sizeBytes?: number; size_bytes?: number }>>("documents.list", { ownerDomain, ownerRecordId });
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Documents could not be loaded.");
  return result.value.map((row) => ({ ref: row.ref ?? row.reference ?? "", ownerReference: row.ownerReference, category: row.category, filename: row.filename ?? row.safe_filename ?? "", processingState: row.processingState ?? row.status ?? "pending_scan", mimeType: row.mimeType ?? row.mime_type ?? "", sizeBytes: row.sizeBytes ?? row.size_bytes ?? 0 }));
}
