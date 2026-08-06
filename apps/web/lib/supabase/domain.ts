/**
 * Server-only domain service implementations (plan.md §10).
 *
 * Every operation:
 * - Runs with the request-scoped user client (RLS applied) or calls the
 *   transactional `app` RPCs for commands;
 * - Returns the `ServiceResult<T>` envelope from `packages/contracts` with
 *   the canonical error codes (stale-version, conflict, duplicate, forbidden,
 *   not-found, validation, retryable, unauthenticated, unavailable);
 * - Never trusts client-supplied authorization: the actor is resolved by
 *   `getServerActor()` and each record is re-authorized by RLS/RPC checks.
 *
 * These functions are the ONLY application path to protected data in the
 * Supabase adapter. The demo adapter remains the isolated fallback.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ErrorCode,
  ServiceResult,
} from "@fass/contracts";

import type { Database, Json } from "@/lib/supabase/database.types";
import { callAppRpc, type RpcError } from "@/lib/supabase/rpc";

/* ------------------------------------------------------------------ */
/* Error mapping                                                        */
/* ------------------------------------------------------------------ */

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly retryable?: boolean;

  constructor(code: ErrorCode, message: string, field?: string, retryable?: boolean) {
    super(message);
    this.code = code;
    this.field = field;
    this.retryable = retryable;
  }
}

const RPC_ERROR_PATTERNS: Array<{ match: RegExp; code: ErrorCode }> = [
  { match: /version mismatch/i, code: "stale-version" },
  { match: /not in an editable state|only .* can|must be accepted before|not paid|amount mismatch|already settled/i, code: "conflict" },
  { match: /already responded|duplicate/i, code: "duplicate" },
  { match: /not the .* owner|not authorized|role and aal2 required|cannot decide their own|cannot publish/i, code: "forbidden" },
  { match: /not found|no offer exists|no approved fee schedule|no grade section/i, code: "not-found" },
  { match: /invalid/i, code: "validation" },
];

function mapRpcError(error: RpcError | null, fallback: ErrorCode = "unavailable"): DomainError {
  const message = error?.message ?? "The service did not respond.";
  const match = RPC_ERROR_PATTERNS.find((pattern) => pattern.match.test(message));
  const transient = /Transient|network|ECONNRESET|fetch failed/i.test(message);
  return new DomainError(
    match?.code ?? (transient ? "retryable" : fallback),
    message,
    undefined,
    match?.code === "retryable" || transient,
  );
}

async function result<T>(fn: () => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof DomainError) {
      return {
        ok: false,
        errors: [
          { code: error.code, message: error.message, field: error.field ?? null, retryable: error.retryable },
        ],
      };
    }
    const message = error instanceof Error ? error.message : "Unexpected service error.";
    return { ok: false, errors: [{ code: "unavailable", message, field: null }] };
  }
}

function requireRow<T>(row: T | null | undefined, label: string): T {
  if (row === null || row === undefined) throw new DomainError("not-found", `${label} not found`);
  return row;
}

/* ------------------------------------------------------------------ */
/* Admissions                                                           */
/* ------------------------------------------------------------------ */

export type AdmissionDraftInput = {
  academicYearId: string;
  gradeId: string;
  studentName: string;
  parentName: string;
  parentContact?: string | null;
  draft: Record<string, unknown>;
  schemaVersion?: number;
};

export function admissionCreateDraft(supabase: SupabaseClient<Database>, actorAccountId: string, input: AdmissionDraftInput) {
  return result(async () => {
    const { data: application, error } = await supabase
      .from("admission_applications")
      .insert({
        owner_account_id: actorAccountId,
        academic_year_id: input.academicYearId,
        grade_id: input.gradeId,
        current_status: "draft",
        student_name: input.studentName,
        parent_name: input.parentName,
        parent_contact: input.parentContact ?? null,
      })
      .select("id, reference, current_status, version")
      .single();
    if (error !== null) throw mapRpcError(error);

    const { error: draftError } = await supabase.from("admission_drafts").insert({
      application_id: application.id,
      draft: input.draft as unknown as Json,
      schema_version: input.schemaVersion ?? 1,
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (draftError !== null) throw mapRpcError(draftError);

    return {
      id: application.id,
      ref: application.reference,
      status: application.current_status,
      version: application.version,
    };
  });
}

export function admissionListMine(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("admission_applications")
      .select(
        "id, reference, academic_year_id, grade_id, current_status, student_name, parent_name, version, submitted_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function admissionSubmit(
  supabase: SupabaseClient<Database>,
  input: { applicationId: string; snapshot: Record<string, unknown>; expectedVersion: number; schemaVersion?: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "admissions_submit", {
      p_application_id: input.applicationId,
      p_snapshot: input.snapshot,
      p_expected_version: input.expectedVersion,
      p_schema_version: input.schemaVersion ?? 1,
    });
    if (error !== null) throw mapRpcError(error);
    return { versionId: requireRow(data, "version") };
  });
}

export function admissionRequestChanges(
  supabase: SupabaseClient<Database>,
  input: { applicationId: string; visibleReason: string; privateNote?: string | null },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "admissions_request_changes", {
      p_application_id: input.applicationId,
      p_visible_reason: input.visibleReason,
      p_private_note: input.privateNote ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function admissionReviewAdvance(
  supabase: SupabaseClient<Database>,
  input: { applicationId: string; action: "under_review" | "assessment"; visibleReason?: string | null; privateNote?: string | null },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "admissions_review_advance", {
      p_application_id: input.applicationId,
      p_action: input.action,
      p_visible_reason: input.visibleReason ?? null,
      p_private_note: input.privateNote ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function admissionDecide(
  supabase: SupabaseClient<Database>,
  input: {
    applicationId: string;
    action: "offer" | "waitlist" | "decline";
    visibleReason?: string | null;
    privateNote?: string | null;
    conditions?: Record<string, unknown>;
    expiresAt?: string | null;
  },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "admissions_decide", {
      p_application_id: input.applicationId,
      p_action: input.action,
      p_visible_reason: input.visibleReason ?? null,
      p_private_note: input.privateNote ?? null,
      p_conditions: input.conditions ?? {},
      p_expires_at: input.expiresAt ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function admissionRespondOffer(
  supabase: SupabaseClient<Database>,
  input: { applicationId: string; response: "accepted" | "declined"; offerVersion: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string | null>(supabase, "admissions_respond_offer", {
      p_application_id: input.applicationId,
      p_response: input.response,
      p_offer_version: input.offerVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { invoiceRef: data ?? null };
  });
}

export function admissionListStaffQueue(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("admission_applications")
      .select(
        "id, reference, academic_year_id, grade_id, current_status, student_name, parent_name, version, submitted_at, created_at",
      )
      .not("current_status", "eq", "draft")
      .order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

/* ------------------------------------------------------------------ */
/* Finance                                                              */
/* ------------------------------------------------------------------ */

export function financeListMyInvoices(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("invoices")
      .select(
        "id, reference, student_id, academic_year_id, schedule_version_id, applicant_ref, term, status, issue_date, due_date, version, invoice_items(label, amount_paise, kind), receipts(reference, issued_at)",
      )
      .order("issue_date", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function financeListMyReceipts(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("receipts")
      .select("id, reference, payment_id, invoice_id, issued_at")
      .order("issued_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function financePostPayment(
  supabase: SupabaseClient<Database>,
  input: { invoiceRef: string; attemptRef: string; providerTxnId: string; amountPaise: number; method?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "finance_post_sandbox_payment", {
      p_invoice_ref: input.invoiceRef,
      p_attempt_reference: input.attemptRef,
      p_provider_txn_id: input.providerTxnId,
      p_amount_paise: input.amountPaise,
      p_method: input.method ?? "sandbox",
    });
    if (error !== null) throw mapRpcError(error);
    return { receiptRef: requireRow(data, "receipt") };
  });
}

/* ------------------------------------------------------------------ */
/* Enrollment                                                           */
/* ------------------------------------------------------------------ */

export function enrollmentConvert(supabase: SupabaseClient<Database>, applicationId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "enrollment_convert", {
      p_application_id: applicationId,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "conversion");
  });
}

export function resolveFamilyContext(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data: links, error } = await supabase
      .from("guardian_student_links")
      .select(
        "id, reference, student_id, relationship_label, status, verification_source, contact_priority, students(id, reference, status, people(display_name)), guardian_link_capabilities(capability)",
      )
      .eq("status", "active");
    if (error !== null) throw mapRpcError(error);

    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("id, reference, student_id, academic_year_id, grade_section_id, status, effective_from")
      .eq("status", "active");

    return {
      links: (links ?? []).map((link) => ({
        id: link.id,
        ref: link.reference,
        studentId: link.student_id,
        relationshipLabel: link.relationship_label,
        verificationSource: link.verification_source,
        contactPriority: link.contact_priority,
        studentRef: link.students?.reference ?? null,
        displayName: link.students?.people?.display_name ?? null,
        capabilities: (link.guardian_link_capabilities ?? []).map((c) => c.capability),
      })),
      enrollments: (enrollments ?? []).map((enrollment) => ({
        id: enrollment.id,
        ref: enrollment.reference,
        studentId: enrollment.student_id,
        academicYearId: enrollment.academic_year_id,
        gradeSectionId: enrollment.grade_section_id,
        status: enrollment.status,
        effectiveFrom: enrollment.effective_from,
      })),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Results and timetable                                                */
/* ------------------------------------------------------------------ */

export function resultsListBatches(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("result_batches")
      .select("id, reference, exam_definition_id, grade_section_id, subject_id, status, version, created_at");
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function resultsPublish(
  supabase: SupabaseClient<Database>,
  input: { batchId: string; expectedVersion: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "results_publish_batch", {
      p_batch_id: input.batchId,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { publicationRef: requireRow(data, "publication") };
  });
}

export function timetableListVersions(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("timetable_versions")
      .select("id, reference, grade_section_id, status, version, effective_from, effective_to, created_at");
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function timetablePublish(supabase: SupabaseClient<Database>, input: { versionId: string; note?: string | null }) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "timetable_publish_version", {
      p_version_id: input.versionId,
      p_note: input.note ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return { publicationRef: requireRow(data, "publication") };
  });
}

/* ------------------------------------------------------------------ */
/* Staff workspace context                                              */
/* ------------------------------------------------------------------ */

export function resolveStaffContext(supabase: SupabaseClient<Database>, personId: string) {
  return result(async () => {
    const { data: member, error } = await supabase
      .from("staff_members")
      .select("id, reference, employment_status, title")
      .eq("person_id", personId)
      .maybeSingle();
    if (error !== null) throw mapRpcError(error);
    if (member === null) throw new DomainError("forbidden", "No staff record for this account");

    const nowIso = new Date().toISOString();
    const { data: assignments } = await supabase
      .from("staff_assignments")
      .select(
        "id, reference, role_grant_id, academic_year_id, grade_section_id, subject_id, status, effective_from, effective_to, subjects(code, name)",
      )
      .eq("staff_member_id", member.id)
      .eq("status", "active")
      .lte("effective_from", nowIso)
      .or(`effective_to.is.null,effective_to.gt.${nowIso}`);

    return {
      staffMemberId: member.id,
      staffRef: member.reference,
      title: member.title,
      assignments: (assignments ?? []).map((assignment) => ({
        id: assignment.id,
        ref: assignment.reference,
        roleGrantId: assignment.role_grant_id,
        academicYearId: assignment.academic_year_id,
        gradeSectionId: assignment.grade_section_id,
        subjectId: assignment.subject_id,
        subjectCode: assignment.subjects?.code ?? null,
        subjectName: assignment.subjects?.name ?? null,
      })),
    };
  });
}
