import type { ServiceError, ServiceResult } from "@fass/contracts";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

import { parseOperation } from "./common";
import { academicsModule } from "./academics";
import { admissionsModule } from "./admissions";
import { dataExportModule } from "./data-exports";
import { dataImportModule } from "./data-imports";
import { financeModule } from "./finance";
import { identityModule } from "./identity";
import { operationsModule } from "./operations";
import type { AdapterContext, AdapterModule, AdapterOperation } from "./types";

export const adapterModules: readonly AdapterModule[] = [
  admissionsModule,
  financeModule,
  academicsModule,
  operationsModule,
  identityModule,
  dataImportModule,
  dataExportModule,
];

const operationIndex = new Map<string, AdapterOperation>();
for (const adapterModule of adapterModules) {
  for (const operation of adapterModule.operations) operationIndex.set(operation.name, operation);
}

export function parseAdapterOperation(value: unknown): { operation: AdapterOperation; payload: unknown } | null {
  if (typeof value !== "object" || value === null || !("op" in value)) return null;
  const opName = (value as { op?: unknown }).op;
  if (typeof opName !== "string") return null;
  const operation = operationIndex.get(opName);
  if (operation === undefined) return null;
  const adapterModule = adapterModules.find((candidate) => candidate.operations.includes(operation));
  if (adapterModule === undefined) return null;
  const parsed = parseOperation(adapterModule, value);
  return parsed === null ? null : { operation: parsed, payload: (value as { payload?: unknown }).payload };
}

type RefTable =
  | "admission_applications"
  | "academic_years"
  | "grades"
  | "grade_sections"
  | "invoices"
  | "payment_attempts"
  | "payments"
  | "job_applications"
  | "content_items"
  | "notices"
  | "support_requests"
  | "documents"
  | "result_batches"
  | "result_entry_sheets"
  | "result_entry_sheet_rosters"
  | "result_entry_sheet_components"
  | "result_publications"
  | "result_report_releases"
  | "result_rosters"
  | "result_correction_requests"
  | "timetable_versions"
  | "timetable_publications"
  | "timetable_overrides"
  | "exam_schedule_versions"
  | "staff_assignments"
  | "staff_members"
  | "role_grants"
  | "students"
  | "enrollments"
  | "rooms"
  | "subjects";

async function resolveReference(supabase: SupabaseClient<Database>, table: RefTable, reference: string): Promise<string> {
  const query = (supabase as unknown as { from: (name: string) => { select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }> } } } }).from(table).select("id").eq("reference", reference).maybeSingle();
  const { data, error } = await query;
  if (error !== null || data === null || typeof (data as { id?: unknown }).id !== "string") {
    throw new ReferenceResolutionError("not-found", "The requested record was not found.");
  }
  return (data as { id: string }).id;
}

async function resolveGradeCode(supabase: SupabaseClient<Database>, code: string): Promise<string> {
  const { data, error } = await (supabase as unknown as { from: (name: string) => { select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }> } } } }).from("grades").select("id").eq("code", code).maybeSingle();
  if (error !== null || data === null || typeof (data as { id?: unknown }).id !== "string") throw new ReferenceResolutionError("not-found", "The requested grade was not found.");
  return (data as { id: string }).id;
}

async function resolveField(
  supabase: SupabaseClient<Database>,
  payload: Record<string, unknown>,
  idKey: string,
  refKey: string,
  table: RefTable,
): Promise<void> {
  if (typeof payload[idKey] === "string" && payload[idKey] !== "") return;
  if (typeof payload[refKey] !== "string" || payload[refKey] === "") return;
  payload[idKey] = await resolveReference(supabase, table, payload[refKey]);
}

async function resolveColumn(supabase: SupabaseClient<Database>, table: RefTable, column: string, value: string): Promise<string> {
  const query = (supabase as unknown as { from: (name: string) => { select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }> } } } }).from(table).select("id").eq(column, value).maybeSingle();
  const { data, error } = await query;
  if (error !== null || data === null || typeof (data as { id?: unknown }).id !== "string") throw new ReferenceResolutionError("not-found", "The requested timetable reference was not found.");
  return (data as { id: string }).id;
}

/** Resolve display references at the authenticated server boundary. UUIDs are
 * still accepted for internal/server loaders during the migration window, but
 * browser commands can send only a public reference and never need database IDs.
 */
export async function resolveAdapterReferences(
  supabase: SupabaseClient<Database>,
  op: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload = { ...input };
  switch (op) {
    case "admissions.saveDraft":
    case "admissions.createDraft":
      if (typeof payload.academicYearId !== "string" && typeof payload.academicYearRef === "string") payload.academicYearId = await resolveReference(supabase, "academic_years", payload.academicYearRef);
      if (typeof payload.gradeId !== "string" && typeof payload.gradeRef === "string") payload.gradeId = await resolveGradeCode(supabase, payload.gradeRef);
      await resolveField(supabase, payload, "applicationId", "applicationRef", "admission_applications");
      break;
    case "admissions.submit":
    case "admissions.requestChanges":
    case "admissions.reviewAdvance":
    case "admissions.decide":
    case "admissions.respondOffer":
    case "admissions.withdraw":
    case "enrollment.readiness":
    case "enrollment.convert":
      await resolveField(supabase, payload, "applicationId", "applicationRef", "admission_applications");
      break;
    case "finance.issueAdmissionInvoice":
      await resolveField(supabase, payload, "applicationId", "applicationRef", "admission_applications");
      break;
    case "finance.applyConcession":
      await resolveField(supabase, payload, "invoiceId", "invoiceRef", "invoices");
      break;
    case "finance.requestRefund":
      await resolveField(supabase, payload, "paymentId", "paymentRef", "payments");
      break;
    case "context.family":
      await resolveField(supabase, payload, "studentId", "studentRef", "students");
      break;
    case "links.request":
      await resolveField(supabase, payload, "studentId", "studentRef", "students");
      break;
    case "results.getBatch":
    case "results.listVersions":
    case "results.publish":
    case "results.submitMarks":
    case "results.moderate":
    case "results.saveDraft":
      if (typeof payload.sheetId !== "string" && typeof payload.sheetRef === "string") await resolveField(supabase, payload, "sheetId", "sheetRef", "result_entry_sheets");
      if (typeof payload.sheetId !== "string" && typeof payload.batchId !== "string" && typeof payload.batchRef === "string") await resolveField(supabase, payload, "sheetId", "batchRef", "result_entry_sheets");
      if (typeof payload.batchId !== "string" && typeof payload.sheetId === "string") payload.batchId = payload.sheetId;
      if (Array.isArray(payload.marks)) {
        payload.marks = await Promise.all((payload.marks as unknown[]).map(async (mark) => {
          if (typeof mark !== "object" || mark === null) return mark;
          const next = { ...(mark as Record<string, unknown>) };
          if (typeof next.rosterId !== "string" && typeof next.rosterRef === "string") next.rosterId = await resolveReference(supabase, "result_entry_sheet_rosters", next.rosterRef);
          if (typeof next.componentId !== "string" && typeof next.componentRef === "string") next.componentId = await resolveReference(supabase, "result_entry_sheet_components", next.componentRef);
          return next;
        }));
      }
      break;
    case "results.withdraw":
    case "results.correctionRequest":
      await resolveField(supabase, payload, "publicationId", "publicationRef", "result_publications");
      break;
    case "results.correctionDecide":
      await resolveField(supabase, payload, "requestId", "requestRef", "result_correction_requests" as RefTable);
      break;
    case "results.listReleases":
      await resolveField(supabase, payload, "studentId", "studentRef", "students");
      break;
    case "results.getRelease":
      await resolveField(supabase, payload, "releaseId", "releaseRef", "result_report_releases");
      break;
    case "results.publishRelease":
      await resolveField(supabase, payload, "studentId", "studentRef", "students");
      await resolveField(supabase, payload, "enrollmentId", "enrollmentRef", "enrollments" as RefTable);
      await resolveField(supabase, payload, "academicYearId", "academicYearRef", "academic_years");
      if (Array.isArray(payload.publicationRefs)) {
        payload.publicationIds = await Promise.all((payload.publicationRefs as unknown[]).map((ref) => resolveReference(supabase, "result_publications", String(ref))));
      }
      break;
    case "results.requestCorrection":
      await resolveField(supabase, payload, "releaseId", "releaseRef", "result_report_releases");
      await resolveField(supabase, payload, "publicationId", "publicationRef", "result_publications");
      break;
    case "results.approveCorrection":
      await resolveField(supabase, payload, "requestId", "requestRef", "result_correction_requests");
      break;
    case "timetable.effective":
    case "timetable.listOverrides":
    case "timetable.listDateSheets":
    case "timetable.saveDraft":
    case "timetable.saveOverride":
    case "timetable.saveDateSheet":
      await resolveField(supabase, payload, "gradeSectionId", "gradeSectionRef", "grade_sections");
      if (op === "timetable.saveDraft") await resolveField(supabase, payload, "versionId", "versionRef", "timetable_versions");
      if (op === "timetable.saveDateSheet") await resolveField(supabase, payload, "versionId", "versionRef", "exam_schedule_versions");
      if (Array.isArray(payload.periods)) {
        payload.periods = await Promise.all((payload.periods as unknown[]).map(async (period) => {
          if (typeof period !== "object" || period === null) return period;
          const next = { ...(period as Record<string, unknown>) };
          if (typeof next.subjectId !== "string" && typeof next.subjectRef === "string" && next.subjectRef !== "") {
            try { next.subjectId = await resolveColumn(supabase, "subjects", "code", next.subjectRef); }
            catch { next.subjectId = await resolveColumn(supabase, "subjects", "name", next.subjectRef); }
          }
          if (typeof next.teacherAssignmentId !== "string" && typeof next.teacherAssignmentRef === "string" && next.teacherAssignmentRef !== "") next.teacherAssignmentId = await resolveReference(supabase, "staff_assignments", next.teacherAssignmentRef);
          if (typeof next.roomId !== "string" && typeof next.roomRef === "string" && next.roomRef !== "") next.roomId = await resolveColumn(supabase, "rooms", "code", next.roomRef);
          return next;
        }));
      }
      break;
    case "timetable.revokeOverride":
      await resolveField(supabase, payload, "overrideId", "overrideRef", "timetable_overrides");
      break;
    case "timetable.validateDraft":
    case "timetable.publish":
      await resolveField(supabase, payload, "versionId", "versionRef", "timetable_versions");
      break;
    case "timetable.publishDateSheet":
      await resolveField(supabase, payload, "versionId", "versionRef", "exam_schedule_versions");
      break;
    case "content.unpublish":
      await resolveField(supabase, payload, "contentItemId", "contentItemRef", "content_items");
      break;
    case "content.publishVersion":
    case "content.reviewVersion":
      /* Content versions are immutable rows without a public reference. The
       * version reference is accepted only when it is already an internal id;
       * generated UI links use the content item reference instead. */
      break;
    case "content.publishNotice":
      await resolveField(supabase, payload, "noticeId", "noticeRef", "notices");
      break;
    case "jobs.submit":
    case "jobs.decide":
    case "jobs.decideV2":
    case "jobs.saveDraft":
    case "jobs.withdraw":
    case "jobs.assignReviewer":
    case "jobs.saveScorecard":
    case "jobs.retentionStatus":
      await resolveField(supabase, payload, "applicationId", "applicationRef", "job_applications");
      break;
    case "support.respond":
    case "support.reopen":
    case "support.assign":
      await resolveField(supabase, payload, "requestId", "requestRef", "support_requests");
      break;
    case "documents.list":
      if (typeof payload.ownerRecordId !== "string" && typeof payload.ownerRecordRef === "string") {
        const table = payload.ownerDomain === "admission_application"
          ? "admission_applications"
          : payload.ownerDomain === "job_application"
            ? "job_applications"
            : payload.ownerDomain === "invoice"
              ? "invoices"
              : payload.ownerDomain === "student"
                ? "students"
                : "documents";
        payload.ownerRecordId = await resolveReference(supabase, table as RefTable, payload.ownerRecordRef);
      }
      break;
    case "notifications.markRead":
      /* Notification rows intentionally expose no public reference. */
      break;
    case "staffInvites.create":
    case "staff.profileChange":
      if (Array.isArray(payload.assignments)) {
        payload.assignments = await Promise.all((payload.assignments as unknown[]).map(async (assignment) => {
          if (typeof assignment !== "object" || assignment === null) return assignment;
          const next = { ...(assignment as Record<string, unknown>) };
          if (typeof next.academicYearId !== "string" && typeof next.academicYearRef === "string") next.academicYearId = await resolveReference(supabase, "academic_years", next.academicYearRef);
          if (typeof next.gradeSectionId !== "string" && typeof next.gradeSectionRef === "string") next.gradeSectionId = await resolveReference(supabase, "grade_sections", next.gradeSectionRef);
          if (typeof next.subjectId !== "string" && typeof next.subjectRef === "string") next.subjectId = await resolveReference(supabase, "subjects", next.subjectRef);
          return next;
        }));
      }
      break;
    case "users.revokeRole":
      await resolveField(supabase, payload, "grantId", "grantRef", "role_grants");
      break;
    case "assignments.end":
      await resolveField(supabase, payload, "assignmentId", "assignmentRef", "staff_assignments");
      break;
    case "context.staff":
      await resolveField(supabase, payload, "roleGrantId", "roleGrantRef", "role_grants");
      break;
    default:
      break;
  }
  return payload;
}

export class ReferenceResolutionError extends Error {
  readonly code: ServiceError["code"];
  constructor(code: ServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function statusForServiceResult(result: ServiceResult<unknown>): number {
  if (result.ok) return 200;
  const code = result.errors[0]?.code;
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "not-found": return 404;
    case "stale-version":
    case "conflict":
    case "duplicate": return 409;
    case "retryable":
    case "unavailable": return 503;
    case "validation":
    default: return 400;
  }
}

function safeMessage(error: ServiceError): string {
  if (/sql|postgres|postgrest|relation|column|constraint|stack|secret|token|provider|fetch failed|econn/i.test(error.message)) {
    return error.code === "forbidden" ? "You do not have access to this record." : "The operation could not be completed.";
  }
  return error.message.length > 240 ? "The operation could not be completed." : error.message;
}

function authoritativeState(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "currentState")) return record.currentState;
  if (Object.prototype.hasOwnProperty.call(record, "state")) return record.state;
  if (Object.prototype.hasOwnProperty.call(record, "status")) return record.status;
  return undefined;
}

export function withCorrelation(result: ServiceResult<unknown>, correlationRef: string): ServiceResult<unknown> {
  if (result.ok) {
    const value = result.value as { version?: unknown; currentVersion?: unknown } | null;
    const currentVersion = typeof result.currentVersion === "number"
      ? result.currentVersion
      : typeof value?.currentVersion === "number"
        ? value.currentVersion
        : typeof value?.version === "number"
          ? value.version
          : undefined;
    const currentState = result.currentState ?? authoritativeState(result.value);
    return {
      ...result,
      correlationRef,
      httpStatus: 200,
      retryable: false,
      ...(currentVersion === undefined ? {} : { currentVersion }),
      ...(currentState === undefined ? {} : { currentState }),
    };
  }
  const errors = result.errors.map((error) => ({ ...error, message: safeMessage(error) }));
  const found = errors[0]?.message.match(/found\s+(\d+)/i)?.[1];
  const httpStatus = statusForServiceResult({ ...result, errors });
  return {
    ...result,
    errors,
    correlationRef,
    httpStatus,
    retryable: errors.some((error) => error.retryable === true) || httpStatus >= 500,
    ...(found === undefined && result.currentVersion === undefined ? {} : { currentVersion: result.currentVersion ?? Number(found) }),
    ...(result.currentState === undefined ? {} : { currentState: result.currentState }),
  };
}
