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
  AcademicYear,
  ErrorCode,
  FamilyCapability,
  GuardianStudentLink,
  GradeSection,
  Enrollment,
  ServiceResult,
} from "@fass/contracts";

import type { Database, Json } from "@/lib/supabase/database.types";
import { callAppRpc, type RpcError } from "@/lib/supabase/rpc";
import type { PolicySnapshot, SchoolConfiguration } from "@/modules/services/school-config";

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
  { match: /already responded|duplicate|already used|already exists|already linked|pending staff invitation/i, code: "duplicate" },
  { match: /not the .* owner|not authorized|role and aal2 required|cannot decide their own|cannot publish|does not match|not bound|not granted|not linked|active guardian account required/i, code: "forbidden" },
  { match: /expired|revoked|no longer valid/i, code: "conflict" },
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
    const { data, error } = await callAppRpc<Json>(supabase, "admissions_save_draft_v2", {
      p_application_id: null,
      p_academic_year_id: input.academicYearId,
      p_grade_id: input.gradeId,
      p_student_name: input.studentName,
      p_parent_name: input.parentName,
      p_parent_contact: input.parentContact ?? null,
      p_draft: input.draft,
      p_schema_version: input.schemaVersion ?? 1,
      p_expected_version: null,
      p_expected_draft_version: null,
    });
    if (error !== null) throw mapRpcError(error);
    const application = requireRow(data, "admission draft") as Record<string, unknown>;
    return {
      id: String(application.id),
      ref: String(application.reference),
      status: String(application.status),
      version: typeof application.version === "number" ? application.version : 0,
    };
  });
}

export function admissionSaveDraft(
  supabase: SupabaseClient<Database>,
  input: {
    applicationId?: string | null;
    academicYearId?: string | null;
    gradeId?: string | null;
    studentName?: string | null;
    parentName?: string | null;
    parentContact?: string | null;
    draft: Record<string, unknown>;
    schemaVersion?: number;
    expectedVersion?: number | null;
    expectedDraftVersion?: number | null;
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<{
      id: string;
      reference: string;
      version: number;
      status: string;
      updatedAt: string;
    }>(supabase, "admissions_save_draft_v2", {
      p_application_id: input.applicationId ?? null,
      p_academic_year_id: input.academicYearId ?? null,
      p_grade_id: input.gradeId ?? null,
      p_student_name: input.studentName ?? null,
      p_parent_name: input.parentName ?? null,
      p_parent_contact: input.parentContact ?? null,
      p_draft: input.draft,
      p_schema_version: input.schemaVersion ?? 1,
      p_expected_version: input.expectedVersion ?? null,
      p_expected_draft_version: input.expectedDraftVersion ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "admission draft");
  });
}

export function admissionListMine(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("admission_applications")
      .select(
        "id, reference, academic_year_id, grade_id, current_status, student_name, parent_name, parent_contact, version, submitted_at, created_at, academic_years(label, starts_on, ends_on, status), grades(label), admission_drafts(draft, schema_version, expires_at, updated_at), admission_application_versions(id, version, snapshot, schema_version, created_at), admission_events(event_type, visible_to_applicant, copy, created_at), admission_reviews(officer_account_id, created_at), admission_offers(id, grade_id, academic_year_id, conditions, expires_at, fee_required, admission_invoice_ref, response, responded_at, decided_by_account_id, version)",
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
    expectedVersion?: number | null;
  },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "admissions_decide_v2", {
      p_application_id: input.applicationId,
      p_action: input.action,
      p_visible_reason: input.visibleReason ?? null,
      p_private_note: input.privateNote ?? null,
      p_conditions: input.conditions ?? {},
      p_expires_at: input.expiresAt ?? null,
      p_expected_version: input.expectedVersion ?? null,
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

export function admissionWithdraw(
  supabase: SupabaseClient<Database>,
  input: { applicationId: string; expectedVersion?: number | null; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "admissions_withdraw", {
      p_application_id: input.applicationId,
      p_expected_version: input.expectedVersion ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "admission withdrawal");
  });
}

export function admissionListStaffQueue(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("admission_applications")
      .select(
        "id, reference, academic_year_id, grade_id, current_status, student_name, parent_name, parent_contact, version, submitted_at, created_at, academic_years(label, starts_on, ends_on, status), grades(label), admission_drafts(draft, schema_version, expires_at, updated_at), admission_application_versions(id, version, snapshot, schema_version, created_at), admission_events(event_type, visible_to_applicant, copy, created_at), admission_reviews(officer_account_id, created_at), admission_offers(id, grade_id, academic_year_id, conditions, expires_at, fee_required, admission_invoice_ref, response, responded_at, decided_by_account_id, version)",
      )
      .not("current_status", "eq", "draft")
      .order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

/** Safe, configuration-only admission projection. It contains no applicant
 * identity or staff-review data and is therefore suitable for applicant
 * forms after the server has established the session. */
export function admissionConfiguration(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "admission_configuration", {});
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "admission configuration");
  });
}

/** Public-safe configuration projection used by the public admissions page.
 * The SQL function exposes only academic labels/window metadata and document
 * constraints; applicant records remain behind authenticated RLS. */
export function admissionPublicConfiguration(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "admission_public_configuration", {});
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "admission configuration");
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
        "id, reference, student_id, academic_year_id, schedule_version_id, applicant_ref, term, status, issue_date, due_date, version, students(people(display_name)), invoice_items(label, amount_paise, kind), ledger_entries(reference, entry_type, amount_paise, reason, created_by_account_id, created_at), payment_allocations(amount_paise, payments(id, reference, amount_paise, provider_txn_id, attempt_id, paid_at, created_at, payment_attempts(method, provider_order_ref))), receipts(reference, issued_at, payment_id)",
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
      .select("id, reference, payment_id, invoice_id, issued_at, payments(amount_paise, payment_attempts(method)), invoices(reference, student_id)")
      .order("issued_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function financeListAttempts(supabase: SupabaseClient<Database>, invoiceRef: string) {
  return result(async () => {
    const { data, error } = await supabase
      .from("payment_attempts")
      .select("id, reference, amount_paise, method, status, failure_reason, provider_order_ref, created_at, updated_at, invoices!inner(reference)")
      .eq("invoices.reference", invoiceRef)
      .order("created_at", { ascending: true });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function financeGetAttempt(supabase: SupabaseClient<Database>, attemptRef: string) {
  return result(async () => {
    const { data, error } = await supabase
      .from("payment_attempts")
      .select("id, reference, amount_paise, method, status, failure_reason, provider_order_ref, created_at, updated_at, invoices!inner(reference)")
      .eq("reference", attemptRef)
      .maybeSingle();
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "payment attempt");
  });
}

export type FinanceAttemptProjectionRow = {
  id: string;
  reference: string;
  amount_paise: number;
  method: string;
  status: string;
  failure_reason: string | null;
  provider_order_ref: string | null;
  provider_code?: string | null;
  idempotency_key?: string | null;
  created_at: string;
  updated_at: string;
  invoices: { reference: string; student_id: string | null; academic_year_id?: string | null } | null;
};

export function financeListAllAttempts(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("payment_attempts")
      .select("id, reference, amount_paise, method, status, failure_reason, provider_order_ref, provider_code, idempotency_key, created_at, updated_at, invoices(reference, student_id, academic_year_id)")
      .order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []) as unknown as FinanceAttemptProjectionRow[];
  });
}

export type FinanceReconciliationProjectionRow = {
  id: string;
  reference: string;
  run_at: string;
  status: string;
  summary: Json | null;
  created_by_account_id: string | null;
  reconciliation_evidence: Array<{ id: string; reference: string; provider_code: string; provider_event_id: string; provider_txn_id: string | null; invoice_reference: string | null; amount_paise: number; state: string; evidence: Json; imported_at: string }>;
  reconciliation_exceptions: Array<{ id: string; evidence_id: string | null; kind: string; detail: Json | null; status: string; resolution_reason: string | null; version: number; created_at: string; resolved_at: string | null }>;
};

export function financeListReconciliationProjection(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("reconciliation_runs")
      .select("id, reference, run_at, status, summary, created_by_account_id, reconciliation_evidence(id, reference, provider_code, provider_event_id, provider_txn_id, invoice_reference, amount_paise, state, evidence, imported_at), reconciliation_exceptions(id, evidence_id, kind, detail, status, resolution_reason, version, created_at, resolved_at)")
      .order("run_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []) as unknown as FinanceReconciliationProjectionRow[];
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

export function financeIssueAdmissionInvoice(
  supabase: SupabaseClient<Database>,
  input: { applicationId: string; scheduleVersionId?: string | null },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "finance_issue_admission_invoice", {
      p_application_id: input.applicationId,
      p_schedule_version_id: input.scheduleVersionId ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return { invoiceRef: requireRow(data, "invoice") };
  });
}

export type FinanceConcessionInput = {
  invoiceId: string;
  amountPaise: number;
  reason: string;
  type: string;
};

export function financeApplyConcession(supabase: SupabaseClient<Database>, input: FinanceConcessionInput) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_request_adjustment", {
      p_invoice_id: input.invoiceId,
      p_amount_paise: input.amountPaise,
      p_kind: input.type === "concession" ? "concession" : input.type === "write_off" ? "write_off" : "adjustment",
      p_reason: input.reason,
      p_expected_invoice_version: (input as FinanceConcessionInput & { expectedVersion?: number }).expectedVersion ?? null,
      p_idempotency_key: (input as FinanceConcessionInput & { idempotencyKey?: string }).idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    const row = requireRow(data, "finance adjustment") as Record<string, unknown>;
    return { concessionId: typeof row.id === "string" ? row.id : null, reference: row.reference, status: row.status, version: row.version };
  });
}

export function financeListAdjustments(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("finance_adjustment_requests")
      .select("id, reference, invoice_id, invoices(reference), kind, amount_paise, reason, status, requested_by_account_id, approved_by_account_id, decided_at, posted_at, version, created_at")
      .order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []).map((row) => ({
      id: row.id,
      ref: row.reference,
      invoiceRef: row.invoices?.reference ?? "",
      type: row.kind,
      amountPaise: row.amount_paise,
      reason: row.reason,
      requestedBy: row.requested_by_account_id,
      requestedAtIso: row.created_at,
      status: row.status === "requested" ? "pending" : row.status,
      decidedBy: row.approved_by_account_id,
      decidedAtIso: row.decided_at,
      decisionReason: null,
      postedAtIso: row.posted_at,
      version: row.version,
    }));
  });
}

export type FinanceRefundInput = {
  paymentId: string;
  amountPaise: number;
  reason: string;
};

export function financeRequestRefund(supabase: SupabaseClient<Database>, input: FinanceRefundInput) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_request_refund_v2", {
      p_payment_id: input.paymentId,
      p_amount_paise: input.amountPaise,
      p_reason: input.reason,
      p_expected_version: (input as FinanceRefundInput & { expectedVersion?: number }).expectedVersion ?? null,
      p_idempotency_key: (input as FinanceRefundInput & { idempotencyKey?: string }).idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    const row = requireRow(data, "refund request") as Record<string, unknown>;
    return { refundRequestId: typeof row.id === "string" ? row.id : null, reference: row.reference, status: row.status, version: row.version };
  });
}

export function financeListRefunds(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("refund_requests")
      .select("id, reference, payment_id, payments(reference, payment_allocations(invoices(reference))), refunds(reference, provider_ref, status, updated_at), amount_paise, reason, status, requested_by_account_id, approver_account_id, decided_at, version, created_at")
      .order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []).map((row) => {
      const allocations = row.payments?.payment_allocations ?? [];
      const refund = row.refunds;
      return {
        id: row.id,
        ref: row.reference,
        paymentRef: row.payments?.reference ?? "",
        invoiceRef: allocations[0]?.invoices?.reference ?? "",
        amountPaise: row.amount_paise,
        reason: row.reason,
        requestedBy: row.requested_by_account_id,
        requestedAtIso: row.created_at,
        status: row.status === "requested" ? "pending" : row.status === "processed" ? "posted" : row.status,
        decidedBy: row.approver_account_id,
        decidedAtIso: row.decided_at,
        decisionReason: null,
        providerRefundRef: refund?.provider_ref ?? null,
        postedAtIso: refund?.status === "confirmed" ? refund.updated_at : null,
        version: row.version,
      };
    });
  });
}

export function financeListReconciliationRuns(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("reconciliation_runs")
      .select("id, reference, run_at, status, summary, created_by_account_id")
      .order("run_at", { ascending: false });
    if (error !== null) throw mapRpcError(error as RpcError);
    return data;
  });
}

export function financeCreateAdjustment(
  supabase: SupabaseClient<Database>,
  input: { invoiceId: string; amountPaise: number; kind: "concession" | "adjustment" | "write_off"; reason: string; expectedVersion: number; idempotencyKey?: string },
) {
  return financeApplyConcession(supabase, { invoiceId: input.invoiceId, amountPaise: input.amountPaise, reason: input.reason, type: input.kind } as FinanceConcessionInput & { expectedVersion: number; idempotencyKey?: string });
}

export function financeApproveAdjustment(
  supabase: SupabaseClient<Database>,
  input: { adjustmentId: string; expectedVersion: number; approve: boolean; reason?: string | null },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_approve_adjustment", {
      p_adjustment_id: input.adjustmentId,
      p_expected_version: input.expectedVersion,
      p_approve: input.approve,
      p_reason: input.reason ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "finance adjustment decision");
  });
}

export function financePostAdjustment(
  supabase: SupabaseClient<Database>,
  input: { adjustmentId: string; expectedVersion: number; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_post_adjustment", {
      p_adjustment_id: input.adjustmentId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "posted finance adjustment");
  });
}

export function financeApproveRefund(
  supabase: SupabaseClient<Database>,
  input: { refundRequestId: string; expectedVersion: number; approve: boolean; reason?: string | null },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_approve_refund", {
      p_refund_request_id: input.refundRequestId,
      p_expected_version: input.expectedVersion,
      p_approve: input.approve,
      p_reason: input.reason ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "refund decision");
  });
}

export function financePostRefund(
  supabase: SupabaseClient<Database>,
  input: { refundRequestId: string; expectedVersion: number; providerRef?: string | null },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_post_refund", {
      p_refund_request_id: input.refundRequestId,
      p_expected_version: input.expectedVersion,
      p_provider_ref: input.providerRef ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "posted refund");
  });
}

export function financeStartReconciliation(supabase: SupabaseClient<Database>, idempotencyKey?: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_reconciliation_start", { p_idempotency_key: idempotencyKey ?? null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "reconciliation run");
  });
}

export function financeImportReconciliation(
  supabase: SupabaseClient<Database>,
  input: { runId: string; evidence: Json; expectedVersion?: number; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_reconciliation_import", {
      p_run_id: input.runId,
      p_evidence: input.evidence,
      p_expected_version: input.expectedVersion ?? 1,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "reconciliation evidence");
  });
}

export function financeResolveReconciliation(
  supabase: SupabaseClient<Database>,
  input: { exceptionId: string; resolutionReason: string; expectedVersion: number; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_reconciliation_resolve", {
      p_exception_id: input.exceptionId,
      p_resolution_reason: input.resolutionReason,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "reconciliation exception");
  });
}

/* ------------------------------------------------------------------ */
/* Careers                                                              */
/* ------------------------------------------------------------------ */

export function jobsSubmit(
  supabase: SupabaseClient<Database>,
  input: { applicationId: string; snapshot: Record<string, unknown>; expectedVersion: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "jobs_submit", {
      p_application_id: input.applicationId,
      p_snapshot: input.snapshot,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { versionId: requireRow(data, "version") };
  });
}

export function jobsDecide(
  supabase: SupabaseClient<Database>,
  input: {
    applicationId: string;
    action: "shortlist" | "interview" | "offer" | "not_selected";
    reason?: string | null;
    privateNote?: string | null;
    scheduledAt?: string | null;
  },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "jobs_decide", {
      p_application_id: input.applicationId,
      p_action: input.action,
      p_reason: input.reason ?? null,
      p_private_note: input.privateNote ?? null,
      p_scheduled_at: input.scheduledAt ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Guardian link verification                                           */
/* ------------------------------------------------------------------ */

export function linksApprove(
  supabase: SupabaseClient<Database>,
  input: { linkId: string; expectedVersion: number },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "links_approve", {
      p_link_id: input.linkId,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function linksReject(
  supabase: SupabaseClient<Database>,
  input: { linkId: string; reason: string; expectedVersion: number },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "links_reject", {
      p_link_id: input.linkId,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function guardianLinksRequest(
  supabase: SupabaseClient<Database>,
  input: { studentId: string; relationshipLabel: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "guardian_links_request", {
      p_student_id: input.studentId,
      p_relationship_label: input.relationshipLabel,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "guardian link request");
  });
}

export function linksRestrict(
  supabase: SupabaseClient<Database>,
  input: { linkId: string; reason: string; expectedVersion: number },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "links_restrict", {
      p_link_id: input.linkId,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function linksRevoke(
  supabase: SupabaseClient<Database>,
  input: { linkId: string; reason: string; expectedVersion: number },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "links_revoke", {
      p_link_id: input.linkId,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function linksCapabilitiesSet(
  supabase: SupabaseClient<Database>,
  input: { linkId: string; capabilities: FamilyCapability[]; expectedVersion: number },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "links_capabilities_set", {
      p_link_id: input.linkId,
      p_capabilities: input.capabilities,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export type ServerLinkSummary = {
  link: GuardianStudentLink;
  guardianName: string;
  studentName: string;
};

function mapServerLinkRow(row: {
  id: string;
  reference: string;
  guardian_id: string;
  student_id: string;
  relationship_label: string;
  status: string;
  verification_source: string;
  approved_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  restriction_reason: string | null;
  rejection_reason: string | null;
  contact_priority: number;
  is_emergency_contact: boolean;
  is_billing_contact: boolean;
  version: number;
  guardian_name?: string | null;
  student_name?: string | null;
  guardian_link_capabilities?: Array<{ capability: string }> | null;
}): ServerLinkSummary {
  return {
    link: {
      id: row.id,
      ref: row.reference,
      guardianId: row.guardian_id,
      studentId: row.student_id,
      relationshipLabel: row.relationship_label,
      status: row.status as GuardianStudentLink["status"],
      verificationSource: row.verification_source as GuardianStudentLink["verificationSource"],
      approvedByPersonId: null,
      approvedAtIso: row.approved_at,
      effectiveFromIso: row.effective_from ?? new Date(0).toISOString(),
      effectiveToIso: row.effective_to,
      restrictionReason: row.restriction_reason,
      rejectionReason: row.rejection_reason,
      contactPriority: row.contact_priority,
      isEmergencyContact: row.is_emergency_contact,
      isBillingContact: row.is_billing_contact,
      capabilities: (row.guardian_link_capabilities ?? []).map((value) => value.capability as FamilyCapability),
      version: row.version,
    },
    guardianName: row.guardian_name ?? "Unknown guardian",
    studentName: row.student_name ?? "Unknown student",
  };
}

export function linksList(supabase: SupabaseClient<Database>, status: "pending_verification" | "active") {
  return result<ServerLinkSummary[]>(async () => {
    const { data, error } = await supabase
      .from("guardian_student_links")
      .select("id, reference, guardian_id, student_id, relationship_label, status, verification_source, approved_at, effective_from, effective_to, restriction_reason, rejection_reason, contact_priority, is_emergency_contact, is_billing_contact, version, guardian_link_capabilities(capability), guardians(people(display_name)), students(people(display_name))")
      .eq("status", status)
      .order("created_at", { ascending: true });
    if (error !== null) throw mapRpcError(error);
    const rows = (data ?? []) as unknown as Array<Parameters<typeof mapServerLinkRow>[0] & { guardians?: { people: { display_name: string } | null } | null; students?: { people: { display_name: string } | null } | null }>;
    return rows.map((row) => mapServerLinkRow({ ...row, guardian_name: row.guardians?.people?.display_name, student_name: row.students?.people?.display_name }));
  });
}

export function linksListMine(supabase: SupabaseClient<Database>) {
  return result<GuardianStudentLink[]>(async () => {
    const { data, error } = await supabase
      .from("guardian_student_links")
      .select("id, reference, guardian_id, student_id, relationship_label, status, verification_source, approved_at, effective_from, effective_to, restriction_reason, rejection_reason, contact_priority, is_emergency_contact, is_billing_contact, version, guardian_link_capabilities(capability)")
      .eq("status", "pending_verification");
    if (error !== null) throw mapRpcError(error);
    return ((data ?? []) as unknown as Array<Parameters<typeof mapServerLinkRow>[0]>).map((row) => mapServerLinkRow(row).link);
  });
}

/* ------------------------------------------------------------------ */
/* Support                                                              */
/* ------------------------------------------------------------------ */

export function supportRespond(
  supabase: SupabaseClient<Database>,
  input: { requestId: string; body: string; isPrivate?: boolean; expectedVersion?: number; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "support_respond_v2", {
      p_request_id: input.requestId,
      p_body: input.body,
      p_private: input.isPrivate ?? false,
      p_expected_version: input.expectedVersion ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "support response");
  });
}

/* ------------------------------------------------------------------ */
/* Content                                                              */
/* ------------------------------------------------------------------ */

export function contentPublishNotice(supabase: SupabaseClient<Database>, noticeId: string) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "content_publish_notice", {
      p_notice_id: noticeId,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Enrollment                                                           */
/* ------------------------------------------------------------------ */

export function enrollmentReadiness(supabase: SupabaseClient<Database>, applicationId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "enrollment_readiness", {
      p_application_id: applicationId,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "enrollment readiness");
  });
}

export function enrollmentConvert(supabase: SupabaseClient<Database>, applicationId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "enrollment_convert", {
      p_application_id: applicationId,
    });
    if (error !== null) throw mapRpcError(error);
    const conversion = requireRow(data, "conversion");
    const studentId = typeof conversion.student === "string" ? conversion.student : null;
    const enrollmentId = typeof conversion.enrollment === "string" ? conversion.enrollment : null;
    const [student, enrollment] = await Promise.all([
      studentId === null ? Promise.resolve({ data: null, error: null }) : supabase.from("students").select("reference").eq("id", studentId).maybeSingle(),
      enrollmentId === null ? Promise.resolve({ data: null, error: null }) : supabase.from("enrollments").select("reference").eq("id", enrollmentId).maybeSingle(),
    ]);
    return {
      ...conversion,
      studentRef: student.data?.reference ?? studentId ?? "",
      enrollmentRef: enrollment.data?.reference ?? enrollmentId ?? "",
      linkRef: typeof conversion.guardian_link === "string" ? conversion.guardian_link : null,
    };
  });
}

export function resolveFamilyContext(
  supabase: SupabaseClient<Database>,
  input: { studentId?: string } = {},
  actor?: { accountId: string; personId: string; displayName: string },
) {
  return result(async () => {
    let accountId = actor?.accountId ?? null;
    let personId = actor?.personId ?? null;
    let displayName = actor?.displayName ?? "Guardian";
    if (actor === undefined) {
      const { data: user } = await supabase.auth.getUser();
      const { data: account } = user.user
        ? await supabase.from("user_accounts").select("id, person_id, people(display_name)").eq("id", user.user.id).maybeSingle()
        : { data: null };
      accountId = account?.id ?? null;
      personId = account?.person_id ?? null;
      displayName = account?.people?.display_name ?? "Guardian";
    }

    const [linksResult, enrollmentsResult, guardianResult, preferenceResult] = await Promise.all([
      supabase
        .from("guardian_student_links")
        .select(
          "id, reference, guardian_id, student_id, relationship_label, status, verification_source, approved_at, effective_from, effective_to, restriction_reason, rejection_reason, contact_priority, is_emergency_contact, is_billing_contact, version, students(id, reference, status, people(display_name)), guardian_link_capabilities(capability)",
        )
        .eq("status", "active"),
      supabase
        .from("enrollments")
        .select("id, reference, student_id, academic_year_id, grade_section_id, status, effective_from, effective_to, grade_sections(id, reference, section_label, academic_year_id, status, grades(label)), academic_years(id, reference, label, starts_on, ends_on, status)")
        .eq("status", "active"),
      personId
        ? supabase.from("guardians").select("id").eq("person_id", personId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      accountId
        ? supabase
            .from("account_context_preferences")
            .select("active_student_id")
            .eq("account_id", accountId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const { data: links, error } = linksResult;
    if (error !== null) throw mapRpcError(error);
    const { data: enrollments, error: enrollmentError } = enrollmentsResult;
    if (enrollmentError !== null) throw mapRpcError(enrollmentError);
    const guardian = guardianResult.data;

    /* The HttpOnly selection cookie is only a cache hint. The account-owned
     * preference is the durable default and is revalidated against the active
     * link below on every request. */
    const preference = preferenceResult.data;

    type RawLink = {
      id: string;
      reference: string;
      guardian_id: string;
      student_id: string;
      relationship_label: string;
      status: string;
      verification_source: string;
      approved_at: string | null;
      effective_from: string | null;
      effective_to: string | null;
      restriction_reason: string | null;
      rejection_reason: string | null;
      contact_priority: number;
      is_emergency_contact: boolean;
      is_billing_contact: boolean;
      version: number;
      students: { id: string; reference: string; status: string; people: { display_name: string } | null } | null;
      guardian_link_capabilities: Array<{ capability: string }>;
    };
    type RawEnrollment = {
      id: string;
      reference: string;
      student_id: string;
      academic_year_id: string;
      grade_section_id: string;
      status: string;
      effective_from: string;
      effective_to: string | null;
      grade_sections: { id: string; reference: string; section_label: string; academic_year_id: string; status: string; grades: { label: string } | null } | null;
      academic_years: { id: string; reference: string; label: string; starts_on: string; ends_on: string; status: string } | null;
    };
    const rawLinks = (links ?? []) as unknown as RawLink[];
    const rawEnrollments = (enrollments ?? []) as unknown as RawEnrollment[];
    const contexts = rawLinks.flatMap((link) => {
      const enrollment = rawEnrollments.find((candidate) => candidate.student_id === link.student_id);
      if (enrollment === null || enrollment === undefined || link.students === null || enrollment.grade_sections === null || enrollment.academic_years === null) return [];
      return [{
        student: { id: link.students.id, ref: link.students.reference, personId: link.students.id, status: "active" as const, displayName: link.students.people?.display_name ?? "Student" },
        link: {
          id: link.id, ref: link.reference, guardianId: link.guardian_id, studentId: link.student_id,
          relationshipLabel: link.relationship_label, status: "active" as const, verificationSource: link.verification_source as GuardianStudentLink["verificationSource"],
          approvedByPersonId: null, approvedAtIso: link.approved_at, effectiveFromIso: link.effective_from ?? new Date(0).toISOString(), effectiveToIso: link.effective_to,
          restrictionReason: link.restriction_reason, rejectionReason: link.rejection_reason, contactPriority: link.contact_priority,
          isEmergencyContact: link.is_emergency_contact, isBillingContact: link.is_billing_contact,
          capabilities: link.guardian_link_capabilities.map((capability) => capability.capability as FamilyCapability), version: link.version,
        },
        enrollment: { id: enrollment.id, ref: enrollment.reference, studentId: enrollment.student_id, academicYearId: enrollment.academic_year_id, gradeSectionId: enrollment.grade_section_id, status: enrollment.status as Enrollment["status"], effectiveFromIso: enrollment.effective_from, effectiveToIso: enrollment.effective_to },
        gradeSection: { id: enrollment.grade_sections.id, ref: enrollment.grade_sections.reference, gradeLabel: enrollment.grade_sections.grades?.label ?? "Class", sectionLabel: enrollment.grade_sections.section_label, academicYearId: enrollment.grade_sections.academic_year_id, status: enrollment.grade_sections.status === "active" ? "active" : "archived" },
        academicYear: { id: enrollment.academic_years.id, ref: enrollment.academic_years.reference, label: enrollment.academic_years.label, startsOn: enrollment.academic_years.starts_on, endsOn: enrollment.academic_years.ends_on, status: enrollment.academic_years.status as AcademicYear["status"] },
      }];
    });
    const requestedStudentId = input.studentId ?? preference?.active_student_id ?? undefined;
    const selected = requestedStudentId !== undefined
      ? contexts.find((context) => context.student.id === requestedStudentId)
      : contexts[0];
    if (input.studentId !== undefined && selected === undefined) throw new DomainError("forbidden", "That student is not linked to this account.");

    return {
      accountId,
      personId,
      displayName,
      guardianId: guardian?.id ?? null,
      activeStudentId: selected?.student.id ?? null,
      activeEnrollmentId: selected?.enrollment.id ?? null,
      academicYearId: selected?.academicYear.id ?? null,
      contexts,
    };
  });
}

/* ------------------------------------------------------------------ */
/* School configuration                                                  */
/* ------------------------------------------------------------------ */

export function schoolConfigRead(
  supabase: SupabaseClient<Database>,
  input: { academicYearId?: string } = {},
) {
  return result<SchoolConfiguration>(async () => {
    const [yearsResult, gradesResult, sectionsResult, subjectsResult, periodsResult, assignmentsResult, roomsResult, policyResult] = await Promise.all([
      supabase.from("academic_years").select("id, reference, label, starts_on, ends_on, status").order("starts_on", { ascending: false }),
      supabase.from("grades").select("id, code, label, sort_order").order("sort_order"),
      supabase
        .from("grade_sections")
        .select("id, reference, academic_year_id, section_label, status, grades(code, label, sort_order)")
        .order("section_label"),
      supabase.from("subjects").select("id, code, name").order("code"),
      supabase
        .from("period_definitions")
        .select("id, academic_year_id, day_of_week, period_number, starts_at, ends_at")
        .order("day_of_week")
        .order("period_number"),
      supabase.from("teaching_assignments").select("id, reference, grade_section_id, subject_id, staff_members(people(display_name))").eq("status", "active"),
      supabase.from("rooms").select("id, code, label").order("code"),
      supabase.from("settings_versions").select("version, status, policy").order("version", { ascending: false }).limit(1),
    ]);
    const firstError = [
      yearsResult.error,
      gradesResult.error,
      sectionsResult.error,
      subjectsResult.error,
      periodsResult.error,
      assignmentsResult.error,
      roomsResult.error,
      policyResult.error,
    ].find((error): error is NonNullable<typeof error> => error !== null);
    if (firstError !== undefined) throw mapRpcError(firstError);

    const years = (yearsResult.data ?? []).map((year) => ({
      id: year.id,
      ref: year.reference,
      label: year.label,
      startsOn: year.starts_on,
      endsOn: year.ends_on,
      status: year.status as SchoolConfiguration["academicYears"][number]["status"],
    }));
    const selectedYearId = input.academicYearId ?? years.find((year) => year.status === "current")?.id;
    const sections = (sectionsResult.data ?? []) as unknown as Array<{
      id: string;
      reference: string;
      academic_year_id: string;
      section_label: string;
      status: string;
      grades: { code: string; label: string; sort_order: number } | null;
    }>;
    const policyRow = (policyResult.data?.[0] ?? null) as { version: number; status: string; policy: Json } | null;
    return {
      academicYears: years,
      grades: (gradesResult.data ?? []).map((grade) => ({
        id: grade.id,
        ref: grade.code,
        code: grade.code,
        label: grade.label,
        sortOrder: grade.sort_order,
      })),
      gradeSections: sections
        .filter((section) => selectedYearId === undefined || section.academic_year_id === selectedYearId)
        .map((section) => ({
          id: section.id,
          ref: section.reference,
          gradeLabel: section.grades?.label ?? "Class",
          sectionLabel: section.section_label,
          academicYearId: section.academic_year_id,
          status: section.status === "active" ? "active" : "archived",
        })),
      subjects: (subjectsResult.data ?? []).map((subject) => ({ id: subject.id, code: subject.code, name: subject.name })),
      periods: (periodsResult.data ?? [])
        .filter((period) => selectedYearId === undefined || period.academic_year_id === selectedYearId)
        .map((period) => ({
          id: period.id,
          academicYearId: period.academic_year_id,
          dayOfWeek: period.day_of_week,
          periodNumber: period.period_number,
          startsAt: period.starts_at,
          endsAt: period.ends_at,
        })),
      assignments: ((assignmentsResult.data ?? []) as unknown as Array<{ id: string; reference: string; grade_section_id: string | null; subject_id: string | null; staff_members: { people: { display_name: string } | null } | null }>).map((assignment) => ({ id: assignment.id, ref: assignment.reference, gradeSectionId: assignment.grade_section_id, subjectId: assignment.subject_id, teacherName: assignment.staff_members?.people?.display_name ?? assignment.reference })),
      rooms: (roomsResult.data ?? []).map((room) => ({ id: room.id, code: room.code, label: room.label })),
      policy: policyRow === null
        ? null
        : {
            version: policyRow.version,
            status: policyRow.status as PolicySnapshot["status"],
            values: typeof policyRow.policy === "object" && policyRow.policy !== null && !Array.isArray(policyRow.policy)
              ? policyRow.policy as Record<string, unknown>
              : {},
          },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Results and timetable                                                */
/* ------------------------------------------------------------------ */

/** JSON projections returned by migration 000028. These are intentionally
 * server-only rows; browser contracts use the mapped service shapes below. */
export type ResultEntrySheetProjection = Record<string, unknown>;
export type ResultReportReleaseProjection = Record<string, unknown>;

export function resultsListEntrySheets(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json[]>(supabase, "results_entry_sheet_list", {});
    if (error !== null) throw mapRpcError(error);
    return (data ?? []) as unknown as ResultEntrySheetProjection[];
  });
}

export function resultsGetEntrySheet(supabase: SupabaseClient<Database>, sheetId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_entry_sheet_get", { p_sheet_id: sheetId });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "result entry sheet") as unknown as ResultEntrySheetProjection;
  });
}

export function resultsListEntrySheetVersions(supabase: SupabaseClient<Database>, sheetId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json[]>(supabase, "results_entry_sheet_versions_list", { p_sheet_id: sheetId });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []) as unknown as ResultEntrySheetProjection[];
  });
}

export function resultsListReportReleases(supabase: SupabaseClient<Database>, studentId?: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json[]>(supabase, "results_report_release_list", { p_student_id: studentId ?? null });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []) as unknown as ResultReportReleaseProjection[];
  });
}

export function resultsGetReportRelease(supabase: SupabaseClient<Database>, releaseId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_report_release_get", { p_release_id: releaseId });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "result report release") as unknown as ResultReportReleaseProjection;
  });
}

export function resultsEntrySheetCreate(
  supabase: SupabaseClient<Database>,
  input: { examDefinitionId: string; gradeSectionId: string; subjectId: string; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_entry_sheet_create", {
      p_exam_definition_id: input.examDefinitionId,
      p_grade_section_id: input.gradeSectionId,
      p_subject_id: input.subjectId,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "result entry sheet") as unknown as ResultEntrySheetProjection;
  });
}

export function resultsEntrySheetSaveDraft(
  supabase: SupabaseClient<Database>,
  input: { sheetId: string; marks: Json; expectedVersion: number; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_entry_sheet_save_draft", {
      p_sheet_id: input.sheetId,
      p_marks: input.marks,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "result entry sheet draft") as unknown as ResultEntrySheetProjection;
  });
}

export function resultsEntrySheetSubmit(
  supabase: SupabaseClient<Database>,
  input: { sheetId: string; expectedVersion: number; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_entry_sheet_submit", {
      p_sheet_id: input.sheetId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "submitted result entry sheet") as unknown as ResultEntrySheetProjection;
  });
}

export function resultsEntrySheetModerate(
  supabase: SupabaseClient<Database>,
  input: { sheetId: string; outcome: "approved" | "returned"; note?: string | null; expectedVersion: number; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_entry_sheet_moderate", {
      p_sheet_id: input.sheetId,
      p_outcome: input.outcome,
      p_note: input.note ?? null,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "moderated result entry sheet") as unknown as ResultEntrySheetProjection;
  });
}

export function resultsEntrySheetPublish(
  supabase: SupabaseClient<Database>,
  input: { sheetId: string; expectedVersion: number; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_entry_sheet_publish", {
      p_sheet_id: input.sheetId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "result publication") as unknown as ResultEntrySheetProjection;
  });
}

export function resultsReportReleasePublish(
  supabase: SupabaseClient<Database>,
  input: { studentId: string; enrollmentId: string; academicYearId: string; term: string; publicationIds: Json; expectedVersion?: number | null; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_report_release_publish", {
      p_student_id: input.studentId,
      p_enrollment_id: input.enrollmentId,
      p_academic_year_id: input.academicYearId,
      p_term: input.term,
      p_publication_ids: input.publicationIds,
      p_expected_version: input.expectedVersion ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "report release") as unknown as ResultReportReleaseProjection;
  });
}

export function resultsRequestCorrection(
  supabase: SupabaseClient<Database>,
  input: { releaseId: string; publicationId: string; reason: string; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_request_correction", {
      p_release_id: input.releaseId,
      p_publication_id: input.publicationId,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "correction request") as unknown as ResultReportReleaseProjection;
  });
}

export function resultsApproveCorrection(
  supabase: SupabaseClient<Database>,
  input: { requestId: string; expectedVersion: number; idempotencyKey?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_approve_correction", {
      p_request_id: input.requestId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "correction approval") as unknown as ResultEntrySheetProjection;
  });
}

export function resultsListBatches(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("result_batches")
      .select("id, reference, exam_definition_id, grade_section_id, subject_id, status, version, created_at, updated_at, exam_definitions(term, academic_year_id, grade_sections(section_label, grades(label)), assessment_components(id, name, max_marks, sort_order, subjects(name, code))), result_rosters(id, student_id, enrollment_id, students(reference, people(display_name)), mark_entries(id, roster_id, component_id, obtained, absent, remark)), result_batch_versions(id, version, status, note, created_at, created_by_account_id), result_events(event_type, visible_to_family, copy, created_at)");
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function resultsGetBatch(supabase: SupabaseClient<Database>, batchId: string) {
  return result(async () => {
    const { data, error } = await supabase
      .from("result_batches")
      .select("id, reference, exam_definition_id, grade_section_id, subject_id, status, version, created_at, updated_at, exam_definitions(term, academic_year_id, grade_sections(section_label, grades(label)), assessment_components(id, name, max_marks, sort_order, subjects(name, code))), result_rosters(id, student_id, enrollment_id, students(reference, people(display_name)), mark_entries(id, roster_id, component_id, obtained, absent, remark)), result_batch_versions(id, version, status, note, created_at, created_by_account_id), result_events(event_type, visible_to_family, copy, created_at)")
      .eq("id", batchId)
      .maybeSingle();
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "result batch");
  });
}

export function resultsListVersions(supabase: SupabaseClient<Database>, batchId: string) {
  return result(async () => {
    const { data, error } = await supabase
      .from("result_batch_versions")
      .select("id, batch_id, version, status, note, created_at, created_by_account_id")
      .eq("batch_id", batchId)
      .order("version", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function resultsListPublications(supabase: SupabaseClient<Database>, studentId?: string) {
  return result(async () => {
    let query = supabase
      .from("result_publications")
      .select("id, reference, batch_id, version, status, published_at, withdrawn_at, withdrawal_reason, result_publication_items(student_id, snapshot)")
      .neq("status", "withdrawn")
      .order("published_at", { ascending: false });
    if (studentId !== undefined) query = query.eq("result_publication_items.student_id", studentId);
    const { data, error } = await query;
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function resultsSaveDraft(
  supabase: SupabaseClient<Database>,
  input: { batchId: string; marks: MarkEntryInput[]; expectedVersion: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_save_draft", {
      p_batch_id: input.batchId,
      p_marks: input.marks as unknown as Json,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "result draft");
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

export type MarkEntryInput = {
  rosterId: string;
  componentId: string;
  obtained?: number | null;
  absent?: boolean;
  remark?: string | null;
};

export function resultsSubmitMarks(
  supabase: SupabaseClient<Database>,
  input: { batchId: string; marks: MarkEntryInput[]; expectedVersion: number },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "results_submit_marks", {
      p_batch_id: input.batchId,
      p_marks: input.marks,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function resultsModerate(
  supabase: SupabaseClient<Database>,
  input: { batchId: string; outcome: "approved" | "returned"; note?: string | null; expectedVersion: number },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "results_moderate", {
      p_batch_id: input.batchId,
      p_outcome: input.outcome,
      p_note: input.note ?? null,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function resultsWithdraw(
  supabase: SupabaseClient<Database>,
  input: { publicationId: string; reason: string },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "results_withdraw", {
      p_publication_id: input.publicationId,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function resultsCorrectionRequest(
  supabase: SupabaseClient<Database>,
  input: { publicationId: string; reason: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "results_correction_request", {
      p_publication_id: input.publicationId,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return { requestId: requireRow(data, "correction request") };
  });
}

export function resultsCorrectionDecide(
  supabase: SupabaseClient<Database>,
  input: { requestId: string; outcome: "approved" | "rejected"; note?: string | null },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "results_correction_decide", {
      p_request_id: input.requestId,
      p_outcome: input.outcome,
      p_note: input.note ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "correction decision");
  });
}

export type TimetableOverrideProjection = {
  id: string;
  reference: string;
  grade_section_id: string;
  override_date: string;
  day_of_week: number;
  period_number: number;
  kind: string;
  subject_id: string | null;
  room_id: string | null;
  substitute_teacher_assignment_id: string | null;
  substitute_teaching_assignment_id: string | null;
  note: string | null;
  created_at: string;
  created_by_account_id?: string | null;
  updated_at?: string;
  version: number;
  revoked_at: string | null;
  revoked_by_account_id?: string | null;
  revocation_reason: string | null;
  subjects?: { name: string } | null;
  rooms?: { label: string } | null;
  teaching_assignments?: {
    reference?: string;
    staff_members?: { people?: { display_name: string } | null } | null;
  } | null;
  staff_assignments?: {
    reference?: string;
    staff_members?: { people?: { display_name: string } | null } | null;
  } | null;
};

export type ExamScheduleProjection = {
  id: string;
  reference: string;
  grade_section_id: string;
  version: number;
  status: string;
  created_at: string;
  published_at?: string | null;
  published_by_account_id?: string | null;
  publication_note?: string | null;
  exam_schedule_entries?: Array<{
    id: string;
    exam_date: string;
    subject_id: string;
    room_id: string | null;
    starts_at: string;
    ends_at: string;
    subjects?: { name: string } | null;
    rooms?: { label: string } | null;
  }>;
};

export function timetableListVersions(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("timetable_versions")
      .select("id, reference, grade_section_id, status, version, revision, effective_from, effective_to, created_at, updated_at, timetable_periods(id, day_of_week, period_number, starts_at, ends_at, subject_id, teacher_assignment_id, teaching_assignment_id, room_id, kind, subjects(name), teaching_assignments(staff_members(people(display_name))), staff_assignments(staff_members(people(display_name))), rooms(label)), timetable_publications(reference, published_at, note)");
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function timetableGetEffective(supabase: SupabaseClient<Database>, gradeSectionId: string) {
  return result(async () => {
    const { data, error } = await supabase
      .from("timetable_versions")
      .select("id, reference, grade_section_id, status, version, revision, effective_from, effective_to, created_at, updated_at, timetable_periods(id, day_of_week, period_number, starts_at, ends_at, subject_id, teacher_assignment_id, teaching_assignment_id, room_id, kind, subjects(name), teaching_assignments(staff_members(people(display_name))), staff_assignments(staff_members(people(display_name))), rooms(label)), timetable_publications(reference, published_at, note)")
      .eq("grade_section_id", gradeSectionId)
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

/** RLS-backed override history. Guardians see only active rows for their
 * academics-capable linked section; scoped timetable staff can also see the
 * revoked history. */
export function timetableListOverrides(supabase: SupabaseClient<Database>, gradeSectionId: string) {
  return result(async () => {
    const { data, error } = await supabase
      .from("timetable_overrides")
      .select("id, reference, grade_section_id, override_date, day_of_week, period_number, kind, subject_id, room_id, substitute_teacher_assignment_id, substitute_teaching_assignment_id, note, created_at, created_by_account_id, updated_at, version, revoked_at, revoked_by_account_id, revocation_reason, subjects(name), rooms(label), teaching_assignments(reference, staff_members(people(display_name))), staff_assignments(reference, staff_members(people(display_name)))")
      .eq("grade_section_id", gradeSectionId)
      .order("override_date", { ascending: true })
      .order("period_number", { ascending: true })
      .order("created_at", { ascending: true });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []) as unknown as TimetableOverrideProjection[];
  });
}

/** RLS-backed published exam date sheets for one section. Drafts and
 * superseded rows remain staff history and are not part of the portal read. */
export function examScheduleListPublished(supabase: SupabaseClient<Database>, gradeSectionId: string) {
  return result(async () => {
    const { data, error } = await supabase
      .from("exam_schedule_versions")
      .select("id, reference, grade_section_id, version, status, created_at, published_at, published_by_account_id, publication_note, exam_schedule_entries(id, exam_date, subject_id, room_id, starts_at, ends_at, subjects(name), rooms(label))")
      .eq("grade_section_id", gradeSectionId)
      .eq("status", "published")
      .order("version", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []) as unknown as ExamScheduleProjection[];
  });
}

export function timetableSaveDraft(
  supabase: SupabaseClient<Database>,
  input: { gradeSectionId: string; versionId?: string | null; periods: Json; expectedRevision?: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "timetable_save_draft", {
      p_grade_section_id: input.gradeSectionId,
      p_version_id: input.versionId ?? null,
      p_periods: input.periods,
      p_expected_revision: input.expectedRevision ?? 0,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "timetable draft");
  });
}

export function timetableValidateDraft(supabase: SupabaseClient<Database>, versionId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "timetable_validate_draft", { p_version_id: versionId });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "timetable validation");
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

export function timetableSaveOverride(
  supabase: SupabaseClient<Database>,
  input: { gradeSectionId: string; overrideDate: string; dayOfWeek: number; periodNumber: number; kind: string; subjectId?: string | null; roomId?: string | null; substituteTeacherAssignmentId?: string | null; note?: string | null },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "timetable_save_override", {
      p_grade_section_id: input.gradeSectionId,
      p_override_date: input.overrideDate,
      p_day_of_week: input.dayOfWeek,
      p_period_number: input.periodNumber,
      p_kind: input.kind,
      p_subject_id: input.subjectId ?? null,
      p_room_id: input.roomId ?? null,
      p_substitute_teacher_assignment_id: input.substituteTeacherAssignmentId ?? null,
      p_note: input.note ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return { reference: requireRow(data, "timetable override") };
  });
}

export function timetableRevokeOverride(
  supabase: SupabaseClient<Database>,
  input: { overrideId: string; expectedVersion: number; reason: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "timetable_revoke_override", {
      p_override_id: input.overrideId,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "timetable override") as unknown as TimetableOverrideProjection;
  });
}

export function examScheduleSaveDraft(supabase: SupabaseClient<Database>, input: { gradeSectionId: string; entries: Json; versionId?: string | null }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "exam_schedule_save_draft", {
      p_grade_section_id: input.gradeSectionId,
      p_entries: input.entries,
      p_version_id: input.versionId ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "exam date sheet draft");
  });
}

export function examSchedulePublish(supabase: SupabaseClient<Database>, input: { versionId: string; note?: string | null }) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "exam_schedule_publish", { p_version_id: input.versionId, p_note: input.note ?? null });
    if (error !== null) throw mapRpcError(error);
    return { reference: requireRow(data, "exam date sheet") };
  });
}

/* ------------------------------------------------------------------ */
/* Staff workspace context                                              */
/* ------------------------------------------------------------------ */

export function resolveStaffContext(
  supabase: SupabaseClient<Database>,
  personId: string,
  roleGrantId?: string,
  actor?: { accountId: string; personId: string; displayName: string },
) {
  return result(async () => {
    const account = actor === undefined
      ? (await supabase
          .from("user_accounts")
          .select("id, person_id, people(display_name)")
          .eq("person_id", personId)
          .maybeSingle()).data
      : { id: actor.accountId, person_id: actor.personId, people: { display_name: actor.displayName } };
    if (account === null) throw new DomainError("forbidden", "No account for this staff record");

    const nowIso = new Date().toISOString();
    const memberPromise = (async () => {
      const withProfile = await supabase
        .from("staff_members")
        .select("id, reference, employment_status, title, access_profile_code, access_profile_version")
        .eq("person_id", personId)
        .maybeSingle();
      if (withProfile.error === null || !withProfile.error.message.includes("access_profile_code")) return withProfile;
      const legacy = await supabase
        .from("staff_members")
        .select("id, reference, employment_status, title")
        .eq("person_id", personId)
        .maybeSingle();
      return {
        data: legacy.data === null ? null : { ...legacy.data, access_profile_code: null, access_profile_version: null },
        error: legacy.error,
      };
    })();
    const [memberResult, preferenceResult, grantsResult, academicYearResult] = await Promise.all([
      memberPromise,
      supabase
        .from("account_context_preferences")
        .select("active_role_grant_id")
        .eq("account_id", account.id)
        .maybeSingle(),
      supabase
        .from("role_grants")
        .select("id, reference, account_id, role_code, status, granted_by_account_id, reason, effective_from, effective_to, version")
        .eq("account_id", account.id)
        .eq("status", "active")
        .lte("effective_from", nowIso)
        .or(`effective_to.is.null,effective_to.gt.${nowIso}`),
      supabase
        .from("academic_years")
        .select("id, reference, label, starts_on, ends_on, status")
        .eq("status", "current")
        .maybeSingle(),
    ]);
    const { data: member, error } = memberResult;
    if (error !== null) throw mapRpcError(error);
    if (member === null) throw new DomainError("forbidden", "No staff record for this account");
    const preference = preferenceResult.data;
    const { data: grants, error: grantsError } = grantsResult;
    if (grantsError !== null) throw mapRpcError(grantsError);
    const requestedRoleGrantId = roleGrantId ?? preference?.active_role_grant_id ?? undefined;
    const selectedGrant = requestedRoleGrantId === undefined
      ? grants?.[0]
      : grants?.find((grant) => grant.id === requestedRoleGrantId);
    if (selectedGrant === undefined) throw new DomainError("forbidden", "That staff workspace is not granted to this account");
    const { data: assignments } = await supabase
      .from("staff_assignments")
      .select(
        "id, reference, role_grant_id, academic_year_id, grade_section_id, subject_id, status, effective_from, effective_to, subjects(code, name), grade_sections(section_label, grades(label))",
      )
      .eq("staff_member_id", member.id)
      .eq("role_grant_id", selectedGrant.id)
      .eq("status", "active")
      .lte("effective_from", nowIso)
      .or(`effective_to.is.null,effective_to.gt.${nowIso}`);

    return {
      accountId: account.id,
      personId,
      displayName: account.people?.display_name ?? "Staff member",
      staffMemberId: member.id,
      staffRef: member.reference,
      title: member.title,
      accessProfileCode: member.access_profile_code ?? null,
      accessProfileVersion: member.access_profile_version ?? null,
      activeRoleGrantId: selectedGrant.id,
      activeRole: selectedGrant.role_code,
      grantedWorkspaceCount: grants?.length ?? 0,
      grants: grants ?? [],
      assignments: (assignments ?? []).map((assignment) => ({
        id: assignment.id,
        reference: assignment.reference,
        role_grant_id: assignment.role_grant_id,
        academic_year_id: assignment.academic_year_id,
        grade_section_id: assignment.grade_section_id,
        subject_id: assignment.subject_id,
        status: assignment.status,
        effective_from: assignment.effective_from,
        effective_to: assignment.effective_to,
        ref: assignment.reference,
        roleGrantId: assignment.role_grant_id,
        academicYearId: assignment.academic_year_id,
        gradeSectionId: assignment.grade_section_id,
        subjectId: assignment.subject_id,
        subjectCode: assignment.subjects?.code ?? null,
        subjectName: assignment.subjects?.name ?? null,
        gradeLabel: assignment.grade_sections?.grades?.label ?? null,
        sectionLabel: assignment.grade_sections?.section_label ?? null,
      })),
      academicYear: academicYearResult.data,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Staff identity lifecycle (migration 000017)                          */
/* ------------------------------------------------------------------ */

export type RoleGrantInput = {
  accountId: string;
  roleCode: string;
  reason: string;
  academicYearIds?: string[];
  gradeSectionIds?: string[];
  subjectIds?: string[];
};

export function rolesGrant(supabase: SupabaseClient<Database>, input: RoleGrantInput) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "roles_grant", {
      p_account_id: input.accountId,
      p_role_code: input.roleCode,
      p_reason: input.reason,
      p_academic_year_ids: input.academicYearIds ?? [],
      p_grade_section_ids: input.gradeSectionIds ?? [],
      p_subject_ids: input.subjectIds ?? [],
    });
    if (error !== null) throw mapRpcError(error);
    return { grantRef: requireRow(data, "grant") };
  });
}

export function rolesRevoke(
  supabase: SupabaseClient<Database>,
  input: { grantId: string; reason: string; expectedVersion: number },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "roles_revoke", {
      p_grant_id: input.grantId,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function assignmentsCreate(
  supabase: SupabaseClient<Database>,
  input: {
    staffMemberId: string;
    roleGrantId: string;
    academicYearId: string;
    gradeSectionId?: string | null;
    subjectId?: string | null;
    effectiveFrom?: string | null;
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "assignments_create", {
      p_staff_member_id: input.staffMemberId,
      p_role_grant_id: input.roleGrantId,
      p_academic_year_id: input.academicYearId,
      p_grade_section_id: input.gradeSectionId ?? null,
      p_subject_id: input.subjectId ?? null,
      p_effective_from: input.effectiveFrom ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return { assignmentRef: requireRow(data, "assignment") };
  });
}

export function assignmentsEnd(
  supabase: SupabaseClient<Database>,
  input: { assignmentId: string; reason: string; expectedVersion: number },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "assignments_end", {
      p_assignment_id: input.assignmentId,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function invitesCreate(
  supabase: SupabaseClient<Database>,
  input: { contact: string; expiresAt: string; purpose?: "guardian" | "applicant" | "job_applicant" | "staff" },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "invites_create", {
      p_contact: input.contact,
      p_expires_at: input.expiresAt,
      p_purpose: input.purpose ?? "staff",
    });
    if (error !== null) throw mapRpcError(error);
    return { oneTimeRef: requireRow(data, "invitation reference") };
  });
}

export function staffInvitesCreate(
  supabase: SupabaseClient<Database>,
  input: {
    contact: string;
    expiresAt: string;
    displayName: string;
    roleCode: string;
    reason: string;
    academicYearIds?: string[];
    gradeSectionIds?: string[];
    subjectIds?: string[];
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "staff_invites_create", {
      p_contact: input.contact,
      p_expires_at: input.expiresAt,
      p_display_name: input.displayName,
      p_role_code: input.roleCode,
      p_reason: input.reason,
      p_academic_year_ids: input.academicYearIds ?? [],
      p_grade_section_ids: input.gradeSectionIds ?? [],
      p_subject_ids: input.subjectIds ?? [],
    });
    if (error !== null) throw mapRpcError(error);
    return { oneTimeRef: requireRow(data, "staff invitation reference") };
  });
}

export function staffInvitesAccept(
  supabase: SupabaseClient<Database>,
  input: { invitationReference: string; oneTimeRef: string; givenName: string; familyName: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<{
      accountId: string;
      staffMemberId: string;
      grantId: string;
      grantRef: string;
      roleCode?: string;
    }>(supabase, "staff_invites_accept", {
      p_invitation_reference: input.invitationReference,
      p_one_time_ref: input.oneTimeRef,
      p_given_name: input.givenName,
      p_family_name: input.familyName,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "staff invitation acceptance");
  });
}

/** Provider-backed profile invitation record. The new flow deliberately
 * returns no manual token; Auth's verified invitation email is the acceptance
 * credential. Role/scope arrays remain for the legacy compatibility RPC. */
export function staffInvitesCreateProfileRecord(
  supabase: SupabaseClient<Database>,
  input: {
    contact: string;
    expiresAt: string;
    displayName: string;
    title?: string;
    profileCode: string;
    reason: string;
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "staff_invites_create_profile", {
      p_contact: input.contact,
      p_expires_at: input.expiresAt,
      p_display_name: input.displayName,
      p_title: input.title ?? null,
      p_profile_code: input.profileCode,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "staff invitation");
  });
}

export function staffInvitesAttachProvider(
  supabase: SupabaseClient<Database>,
  input: { invitationReference: string; providerSubject: string; providerInvitationRef?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "staff_invites_attach_provider", {
      p_invitation_reference: input.invitationReference,
      p_provider_subject: input.providerSubject,
      p_provider_invitation_ref: input.providerInvitationRef ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "provider invitation");
  });
}

export function staffInvitesMarkProviderFailed(
  supabase: SupabaseClient<Database>,
  input: { invitationReference: string; reason: string },
) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "staff_invites_mark_provider_failed", {
      p_invitation_reference: input.invitationReference,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function staffInvitesAcceptAuth(
  supabase: SupabaseClient<Database>,
  input: { invitationReference: string; givenName: string; familyName: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "staff_invites_accept", {
      p_invitation_reference: input.invitationReference,
      p_given_name: input.givenName,
      p_family_name: input.familyName,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "staff invitation acceptance");
  });
}

export function staffProfilesList(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "staff_profiles_list", {});
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "staff profiles");
  });
}

export function staffInvitesCreateProfile(
  supabase: SupabaseClient<Database>,
  input: {
    contact: string;
    expiresAt: string;
    displayName: string;
    title?: string;
    profileCode: string;
    reason: string;
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "staff_invites_create_profile", {
      p_contact: input.contact,
      p_expires_at: input.expiresAt,
      p_display_name: input.displayName,
      p_title: input.title ?? null,
      p_profile_code: input.profileCode,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "staff profile invitation");
  });
}

export function staffProfileChange(
  supabase: SupabaseClient<Database>,
  input: {
    accountId: string;
    profileCode: string;
    reason: string;
    expectedVersion: number;
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "staff_profile_change", {
      p_account_id: input.accountId,
      p_profile_code: input.profileCode,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "staff profile change");
  });
}

/* ------------------------------------------------------------------ */
/* Teaching staff (non-login records, migration 000043)                 */
/* ------------------------------------------------------------------ */

export function teachingStaffCreate(
  supabase: SupabaseClient<Database>,
  input: { displayName: string; title: string; reason: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "teaching_staff_create", {
      p_display_name: input.displayName,
      p_title: input.title,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "teaching staff record");
  });
}

export function teachingAssignmentCreate(
  supabase: SupabaseClient<Database>,
  input: {
    staffMemberId: string;
    academicYearId: string;
    gradeSectionId: string;
    subjectId: string;
    effectiveFrom?: string | null;
    reason: string;
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "teaching_assignment_create", {
      p_staff_member_id: input.staffMemberId,
      p_academic_year_id: input.academicYearId,
      p_grade_section_id: input.gradeSectionId,
      p_subject_id: input.subjectId,
      p_effective_from: input.effectiveFrom ?? null,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "teaching assignment");
  });
}

export function teachingAssignmentEnd(
  supabase: SupabaseClient<Database>,
  input: { assignmentId: string; reason: string; expectedVersion: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "teaching_assignment_end", {
      p_assignment_id: input.assignmentId,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "teaching assignment end");
  });
}

export function teachingStaffList(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "teaching_staff_list", {});
    if (error !== null) throw mapRpcError(error);
    return Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
  });
}

/* ------------------------------------------------------------------ */
/* School-data imports (migration 000044)                               */
/* ------------------------------------------------------------------ */

export function dataImportCreateBatch(
  supabase: SupabaseClient<Database>,
  input: {
    academicYearId: string;
    sourceSystem: string;
    sourceDocumentId?: string | null;
    authorityConfirmation: true;
    privacyConfirmation: true;
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "data_import_create_batch", {
      p_academic_year_id: input.academicYearId,
      p_source_system: input.sourceSystem,
      p_source_document_id: input.sourceDocumentId ?? null,
      p_authority_confirmation: input.authorityConfirmation,
      p_privacy_confirmation: input.privacyConfirmation,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "import batch");
  });
}

export function dataImportSetState(
  supabase: SupabaseClient<Database>,
  input: { batchId: string; newState: string; expectedVersion: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "data_import_set_state", {
      p_batch_id: input.batchId,
      p_new_state: input.newState,
      p_expected_version: input.expectedVersion,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "import batch state");
  });
}

export function dataImportStoreRows(
  supabase: SupabaseClient<Database>,
  batchId: string,
  rows: Array<Record<string, unknown>>,
) {
  return result(async () => {
    const { data, error } = await callAppRpc<number>(supabase, "data_import_store_rows", {
      p_batch_id: batchId,
      p_rows: rows,
    });
    if (error !== null) throw mapRpcError(error);
    return { count: Number(data ?? 0) };
  });
}

export function dataImportPreview(supabase: SupabaseClient<Database>, batchId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "data_import_preview", {
      p_batch_id: batchId,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "import preview");
  });
}

export function dataImportCommit(
  supabase: SupabaseClient<Database>,
  input: {
    batchId: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    confirmedCreateCount: number;
    confirmedUpdateCount: number;
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "data_import_commit", {
      p_batch_id: input.batchId,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
      p_confirmed_create_count: input.confirmedCreateCount,
      p_confirmed_update_count: input.confirmedUpdateCount,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "import commit");
  });
}

export function dataImportCancel(
  supabase: SupabaseClient<Database>,
  input: { batchId: string; expectedVersion: number; reason: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "data_import_cancel", {
      p_batch_id: input.batchId,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "import cancel");
  });
}

export function dataImportReport(supabase: SupabaseClient<Database>, batchId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "data_import_report", {
      p_batch_id: batchId,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "import report");
  });
}

export function dataImportListBatches(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "data_import_list_batches", {});
    if (error !== null) throw mapRpcError(error);
    return Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
  });
}

export function dataImportListIssues(
  supabase: SupabaseClient<Database>,
  batchId: string,
  severity?: "error" | "warning",
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "data_import_list_issues", {
      p_batch_id: batchId,
      p_severity: severity ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
  });
}

/* ------------------------------------------------------------------ */
/* Protected data exports (migration 000046)                            */
/* ------------------------------------------------------------------ */

export function dataExportRequest(
  supabase: SupabaseClient<Database>,
  input: {
    domain: string;
    filters: Record<string, unknown>;
    columns: string[];
    format: string;
    purpose: string;
    reason: string;
  },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "data_export_request", {
      p_domain: input.domain,
      p_filters: input.filters,
      p_columns: input.columns,
      p_format: input.format,
      p_purpose: input.purpose,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "export request");
  });
}

export function dataExportList(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "data_export_list", {});
    if (error !== null) throw mapRpcError(error);
    return Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
  });
}

export function dataExportCancel(
  supabase: SupabaseClient<Database>,
  input: { requestReference: string; reason: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "data_export_cancel", {
      p_request_reference: input.requestReference,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "export cancel");
  });
}

export function applicantRegister(
  supabase: SupabaseClient<Database>,
  input: { authUserId: string; contact: string; givenName: string; familyName: string; purpose?: "student_admission" | "job_application" },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "applicant_register", {
      p_auth_user_id: input.authUserId,
      p_contact: input.contact,
      p_given_name: input.givenName,
      p_family_name: input.familyName,
      p_purpose: input.purpose ?? "student_admission",
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "applicant registration");
  });
}

export function contextFamilySelect(
  supabase: SupabaseClient<Database>,
  input: { studentId: string; expectedVersion?: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "context_family_select", {
      p_student_id: input.studentId,
      p_expected_version: input.expectedVersion ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "family context");
  });
}

export function contextStaffSelect(
  supabase: SupabaseClient<Database>,
  input: { roleGrantId: string; expectedVersion?: number },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Record<string, unknown>>(supabase, "context_staff_select", {
      p_role_grant_id: input.roleGrantId,
      p_expected_version: input.expectedVersion ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "staff context");
  });
}

export function accountHasStaffGrant(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<boolean>(supabase, "account_has_staff_grant", {});
    if (error !== null) throw mapRpcError(error);
    return data === true;
  });
}

export function accountSuspend(supabase: SupabaseClient<Database>, input: { accountId: string; reason: string }) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "accounts_suspend", {
      p_account_id: input.accountId,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function accountReactivate(supabase: SupabaseClient<Database>, input: { accountId: string; reason: string }) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "accounts_reactivate", {
      p_account_id: input.accountId,
      p_reason: input.reason,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function invitesRevoke(supabase: SupabaseClient<Database>, invitationRef: string) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "invites_revoke", {
      p_invitation_reference: invitationRef,
    });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

/**
 * Admin account directory (RLS-filtered): accounts with their grants and
 * staff records. Visible to any aal2 staff member per the B1 read policies.
 */
export type AdminDirectoryRow = {
  id: string;
  status: string;
  verified_contact: string | null;
  mfa_status?: string | null;
  mfa_verified_at?: string | null;
  people: { display_name: string } | null;
  staff_members: Array<{
    id: string;
    reference: string;
    title: string;
    employment_status: string;
    access_profile_code?: string | null;
    access_profile_version?: number | null;
  }>;
  role_grants: Array<{
    reference: string;
    role_code: string;
    status: string;
    version: number;
    effective_from: string;
    effective_to: string | null;
  }>;
  assignments?: Array<{
    id: string;
    reference: string;
    status: string;
    version: number;
    effective_from: string;
    effective_to: string | null;
    academic_year_id: string;
    academic_year_label?: string;
    grade_section_id: string;
    grade_label?: string;
    section_label?: string;
    subject_id: string;
    subject_name?: string;
  }>;
  account_invitations?: Array<{
    reference: string;
    contact: string;
    status: string;
    expires_at: string;
    provider_state: string;
    profile_code?: string | null;
  }>;
};

export function usersListAdmin(supabase: SupabaseClient<Database>) {
  return result<AdminDirectoryRow[]>(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "users_admin_list", {});
    if (error !== null) throw mapRpcError(error);
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => {
      const value = (row ?? {}) as Record<string, unknown>;
      const personName = typeof value.name === "string" ? value.name : null;
      return {
        id: typeof value.id === "string" ? value.id : "",
        status: typeof value.status === "string" ? value.status : "invited",
        verified_contact: typeof value.verified_contact === "string" ? value.verified_contact : null,
        mfa_status: typeof value.mfa_status === "string" ? value.mfa_status : null,
        mfa_verified_at: typeof value.mfa_verified_at === "string" ? value.mfa_verified_at : null,
        people: personName === null ? null : { display_name: personName },
        staff_members: Array.isArray(value.staff_members) ? value.staff_members as AdminDirectoryRow["staff_members"] : [],
        role_grants: Array.isArray(value.role_grants) ? value.role_grants as AdminDirectoryRow["role_grants"] : [],
        assignments: Array.isArray(value.assignments) ? value.assignments as AdminDirectoryRow["assignments"] : [],
        account_invitations: Array.isArray(value.account_invitations) ? value.account_invitations as AdminDirectoryRow["account_invitations"] : [],
      } satisfies AdminDirectoryRow;
    });
  });
}

export function markMfaVerified(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "accounts_mark_mfa_verified", {});
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "MFA verification");
  });
}

export function recordAuthEvent(
  supabase: SupabaseClient<Database>,
  event: "signed_in" | "signed_out" | "password_changed",
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "accounts_record_auth_event", { p_event: event });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "auth event");
  });
}

/* ------------------------------------------------------------------ */
/* Payment attempt lifecycle (migration 000019)                         */
/* ------------------------------------------------------------------ */

export function financeCreateAttempt(
  supabase: SupabaseClient<Database>,
  input: { invoiceRef: string; amountPaise: number; method: string; idempotencyKey?: string; providerCode?: string },
) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(
      supabase,
      "finance_create_attempt_v2",
      {
        p_invoice_ref: input.invoiceRef,
        p_amount_paise: input.amountPaise,
        p_method: input.method,
        p_idempotency_key: input.idempotencyKey ?? `checkout:${input.invoiceRef}:${input.amountPaise}:${input.method}`,
        p_provider_code: input.providerCode ?? "sandbox",
      },
    );
    if (error !== null) throw mapRpcError(error);
    const row = requireRow(data, "attempt") as Record<string, unknown>;
    return { attemptRef: String(row.attemptRef ?? ""), providerOrderRef: String(row.providerOrderRef ?? ""), status: String(row.status ?? "created"), version: Number(row.version ?? 1), replayed: row.replayed === true };
  });
}

export function financeRefreshAttempt(supabase: SupabaseClient<Database>, attemptRef: string, expectedVersion?: number) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "finance_refresh_attempt_v2", {
      p_attempt_reference: attemptRef,
      p_expected_version: expectedVersion ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    const row = requireRow(data, "attempt status") as Record<string, unknown>;
    return { status: String(row.status ?? ""), version: Number(row.version ?? 1), replayed: row.replayed === true };
  });
}

/* ------------------------------------------------------------------ */
/* Careers reads and draft creation (jobs_submit/decide live in 000015) */
/* ------------------------------------------------------------------ */

export type PublishedVacancy = {
  vacancyId: string;
  versionId: string;
  reference: string;
  title: string;
  department: string | null;
  terms: Record<string, unknown>;
};

export function jobsListPublishedVacancies(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("job_vacancies")
      .select("id, reference, title, department, job_vacancy_versions(id, version, terms)")
      .eq("current_status", "published")
      .order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []).map((vacancy) => {
      const versions = [...(vacancy.job_vacancy_versions ?? [])].sort((a, b) => b.version - a.version);
      const latest = requireRow(versions[0], "vacancy version");
      const row: PublishedVacancy = {
        vacancyId: vacancy.id,
        versionId: latest.id,
        reference: vacancy.reference,
        title: vacancy.title,
        department: vacancy.department,
        terms: latest.terms as Record<string, unknown>,
      };
      return row;
    });
  });
}

export function jobsCreateDraftApplication(
  supabase: SupabaseClient<Database>,
  input: { vacancyVersionId?: string; vacancyRef?: string; applicantName: string },
) {
  return result(async () => {
    let vacancyVersionId = input.vacancyVersionId;
    if (vacancyVersionId === undefined && input.vacancyRef !== undefined) {
      const { data: vacancy, error: vacancyError } = await supabase
        .from("job_vacancies")
        .select("id, job_vacancy_versions(id, version)")
        .eq("reference", input.vacancyRef)
        .eq("current_status", "published")
        .maybeSingle();
      if (vacancyError !== null) throw mapRpcError(vacancyError);
      const versions = [...(vacancy?.job_vacancy_versions ?? [])].sort((a, b) => b.version - a.version);
      vacancyVersionId = versions[0]?.id;
    }
    if (vacancyVersionId === undefined) throw new DomainError("not-found", "Vacancy not found");
    const { data, error } = await callAppRpc<Json>(supabase, "jobs_create_draft", {
      p_vacancy_version_id: vacancyVersionId,
      p_applicant_name: input.applicantName,
    });
    if (error !== null) throw mapRpcError(error);
    const row = requireRow(data, "job draft");
    const value = row as Record<string, unknown>;
    return {
      id: String(value.id),
      ref: String(value.reference),
      status: String(value.status),
      version: typeof value.version === "number" ? value.version : 0,
    };
  });
}

export function jobsListMine(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("job_applications")
      .select("id, reference, applicant_name, owner_account_id, vacancy_id, current_status, version, created_at, job_vacancies(title, reference), job_application_drafts(draft, schema_version, expires_at, updated_at), job_application_versions(version, snapshot), job_events(event_type, visible_to_applicant, copy, created_at), job_interviews(scheduled_at, notes, outcome)")
      .order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function jobsListStaffQueue(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase
      .from("job_applications")
      .select("id, reference, applicant_name, owner_account_id, vacancy_id, current_status, version, created_at, job_vacancies(title, reference), job_application_drafts(draft, schema_version, expires_at, updated_at), job_application_versions(version, snapshot), job_events(event_type, visible_to_applicant, copy, created_at), job_interviews(scheduled_at, notes, outcome), job_review_assignments(reviewer_account_id, status, assigned_at), job_scorecards(score, notes, created_by_account_id, created_at)")
      .not("current_status", "eq", "draft")
      .order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function jobsSaveDraft(supabase: SupabaseClient<Database>, input: { applicationId: string; draft: Json; schemaVersion?: number; expectedVersion?: number | null; expectedDraftVersion?: number | null }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "jobs_save_draft_v2", {
      p_application_id: input.applicationId,
      p_draft: input.draft,
      p_schema_version: input.schemaVersion ?? 1,
      p_expected_version: input.expectedVersion ?? null,
      p_expected_draft_version: input.expectedDraftVersion ?? null,
    });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "job draft");
  });
}

export function jobsWithdraw(supabase: SupabaseClient<Database>, input: { applicationId: string; expectedVersion?: number | null }) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "jobs_withdraw", { p_application_id: input.applicationId, p_expected_version: input.expectedVersion ?? null });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function jobsAssignReviewer(supabase: SupabaseClient<Database>, input: { applicationId: string; reviewerAccountId: string }) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "jobs_assign_reviewer", { p_application_id: input.applicationId, p_reviewer_account_id: input.reviewerAccountId });
    if (error !== null) throw mapRpcError(error);
    return { assignmentId: requireRow(data, "review assignment") };
  });
}

export function jobsSaveScorecard(supabase: SupabaseClient<Database>, input: { applicationId: string; score: number; notes?: string | null }) {
  return result(async () => {
    const { data, error } = await callAppRpc<string>(supabase, "jobs_save_scorecard", { p_application_id: input.applicationId, p_score: input.score, p_notes: input.notes ?? null });
    if (error !== null) throw mapRpcError(error);
    return { scorecardId: requireRow(data, "scorecard") };
  });
}

export function jobsRetentionStatus(supabase: SupabaseClient<Database>, applicationId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "jobs_retention_status", { p_application_id: applicationId });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "job retention");
  });
}

export function jobsDecideV2(supabase: SupabaseClient<Database>, input: { applicationId: string; action: string; reason?: string | null; privateNote?: string | null; scheduledAt?: string | null; expectedVersion?: number | null }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "jobs_decide_v2", { p_application_id: input.applicationId, p_action: input.action, p_reason: input.reason ?? null, p_private_note: input.privateNote ?? null, p_scheduled_at: input.scheduledAt ?? null, p_expected_version: input.expectedVersion ?? null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "job decision");
  });
}

/* ------------------------------------------------------------------ */
/* Content, support, settings, audit, notifications, documents          */
/* ------------------------------------------------------------------ */

export function contentList(supabase: SupabaseClient<Database>, scope: "public" | "staff" | "family" = "public") {
  return result(async () => {
    const query = supabase.from("content_items").select("id, reference, kind, slug, current_status, version, current_version_id, updated_at, content_versions(id, version, title, body, review_status, published_at, created_at, author_account_id, reviewed_by_account_id, approved_at), notices(id, reference, category, urgent, status, published_at, expires_at, scheduled_at, starts_at, unpublished_at, notice_audiences(audience, role_code, academic_year_id, grade_section_id, student_id))");
    const { data, error } = scope === "public" ? await query.in("current_status", ["published", "expired"]) : await query;
    if (error !== null) throw mapRpcError(error);
    return (data ?? []) as unknown as Array<Record<string, unknown>>;
  });
}

export function contentSaveDraft(supabase: SupabaseClient<Database>, input: { contentItemId?: string | null; kind: string; slug: string; title: string; body: Json; expectedVersion?: number | null }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "content_save_draft_v2", { p_content_item_id: input.contentItemId ?? null, p_kind: input.kind, p_slug: input.slug, p_title: input.title, p_body: input.body, p_expected_version: input.expectedVersion ?? null, p_idempotency_key: (input as typeof input & { idempotencyKey?: string }).idempotencyKey ?? null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "content draft");
  });
}

export function contentReviewVersion(supabase: SupabaseClient<Database>, input: { versionId: string; outcome: "in_review" | "approved" }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, input.outcome === "approved" ? "content_approve_version" : "content_request_review", { p_version_id: input.versionId, p_expected_version: null, p_idempotency_key: null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "content review");
  });
}

export function contentPublishVersion(supabase: SupabaseClient<Database>, versionId: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "content_publish_version_v2", { p_version_id: versionId, p_expected_version: null, p_scheduled_at: null, p_expires_at: null, p_idempotency_key: null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "published content");
  });
}

export function contentUnpublish(supabase: SupabaseClient<Database>, input: { contentItemId: string; reason: string }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "content_unpublish_v2", { p_content_item_id: input.contentItemId, p_reason: input.reason, p_expected_version: (input as typeof input & { expectedVersion?: number }).expectedVersion ?? null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "unpublished content");
  });
}

export function contentRequestReview(supabase: SupabaseClient<Database>, input: { versionId: string; expectedVersion?: number; idempotencyKey?: string }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "content_request_review", { p_version_id: input.versionId, p_expected_version: input.expectedVersion ?? null, p_idempotency_key: input.idempotencyKey ?? null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "content review");
  });
}

export function contentApproveVersion(supabase: SupabaseClient<Database>, input: { versionId: string; expectedVersion?: number; idempotencyKey?: string }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "content_approve_version", { p_version_id: input.versionId, p_expected_version: input.expectedVersion ?? null, p_idempotency_key: input.idempotencyKey ?? null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "content approval");
  });
}

export function contentPublishVersionV2(supabase: SupabaseClient<Database>, input: { versionId: string; expectedVersion?: number; scheduledAt?: string | null; expiresAt?: string | null; idempotencyKey?: string }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "content_publish_version_v2", { p_version_id: input.versionId, p_expected_version: input.expectedVersion ?? null, p_scheduled_at: input.scheduledAt ?? null, p_expires_at: input.expiresAt ?? null, p_idempotency_key: input.idempotencyKey ?? null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "published content");
  });
}

export function contentListPublic(supabase: SupabaseClient<Database>) {
  return contentList(supabase, "public");
}

export function supportCreate(supabase: SupabaseClient<Database>, input: { category: string; subject: string; body: string; priority?: string }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "support_create", { p_category: input.category, p_subject: input.subject, p_body: input.body, p_priority: input.priority ?? "normal" });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "support request");
  });
}

export function supportPublicIntake(supabase: SupabaseClient<Database>, input: { category: string; subject: string; body: string; contact: string; requesterName?: string | null; intakeKey?: string | null; captchaProvider?: string; captchaVerifiedAt?: string }) {
  return result(async () => {
    if (!input.captchaProvider || !input.captchaVerifiedAt) throw new DomainError("forbidden", "CAPTCHA verification is required.");
    const { data, error } = await callAppRpc<Json>(supabase, "support_public_intake_v2", { p_category: input.category, p_subject: input.subject, p_body: input.body, p_contact: input.contact, p_requester_name: input.requesterName ?? null, p_intake_key_hash: input.intakeKey ?? null, p_captcha_provider: input.captchaProvider, p_captcha_verified_at: input.captchaVerifiedAt });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "public support request");
  });
}

export function supportList(supabase: SupabaseClient<Database>, scope: "mine" | "staff") {
  return result(async () => {
    const { data, error } = await supabase.from("support_requests").select("id, reference, requester_account_id, requester_name, requester_contact, category, subject, status, priority, assignee_account_id, version, created_at, updated_at, support_messages(id, author_account_id, body, is_staff, created_at), support_private_notes(id, author_account_id, body, created_at), support_events(event_type, detail, created_at)").order("updated_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return scope === "mine" ? (data ?? []).map((row) => ({ ...row, support_private_notes: [] })) : data;
  });
}

export function supportReopen(supabase: SupabaseClient<Database>, input: { requestId: string; expectedVersion: number }) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "support_reopen", { p_request_id: input.requestId, p_expected_version: input.expectedVersion });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function supportAssign(supabase: SupabaseClient<Database>, input: { requestId: string; assigneeAccountId: string; expectedVersion: number }) {
  return result(async () => {
    const { error } = await callAppRpc<null>(supabase, "support_assign", { p_request_id: input.requestId, p_assignee_account_id: input.assigneeAccountId, p_expected_version: input.expectedVersion });
    if (error !== null) throw mapRpcError(error);
    return { ok: true };
  });
}

export function supportSetStatus(supabase: SupabaseClient<Database>, input: { requestId: string; status: "open" | "assigned" | "in_progress" | "resolved" | "closed"; expectedVersion: number; reason?: string | null; resolutionCode?: string | null }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "support_set_status", { p_request_id: input.requestId, p_status: input.status, p_expected_version: input.expectedVersion, p_reason: input.reason ?? null, p_resolution_code: input.resolutionCode ?? null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "support status");
  });
}

export function settingsRead(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "settings_read_effective", {});
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function settingsReadLatest(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "settings_read_latest", {});
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function settingsSave(supabase: SupabaseClient<Database>, input: { policy: Json; reason: string; expectedVersion: number }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "settings_save_v2", { p_policy: input.policy, p_reason: input.reason, p_expected_version: input.expectedVersion });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "settings version");
  });
}

export function settingsApprove(supabase: SupabaseClient<Database>, input: { settingsId: string; expectedVersion: number; effectiveFrom?: string | null }) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "settings_approve", { p_settings_id: input.settingsId, p_expected_version: input.expectedVersion, p_effective_from: input.effectiveFrom ?? null });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "settings approval");
  });
}

export function auditList(supabase: SupabaseClient<Database>, limit = 100) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json[]>(supabase, "audit_list", { p_limit: limit });
    if (error !== null) throw mapRpcError(error);
    return data ?? [];
  });
}

export function auditListPage(supabase: SupabaseClient<Database>, input: { limit?: number; cursor?: string | null; actorAccountId?: string | null; action?: string | null; targetType?: string | null; outcome?: string | null } = {}) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json[]>(supabase, "audit_list_page", { p_limit: input.limit ?? 50, p_cursor: input.cursor ?? null, p_actor_account_id: input.actorAccountId ?? null, p_action: input.action ?? null, p_target_type: input.targetType ?? null, p_outcome: input.outcome ?? null });
    if (error !== null) throw mapRpcError(error);
    return data ?? [];
  });
}

export function notificationsList(supabase: SupabaseClient<Database>) {
  return result(async () => {
    const { data, error } = await supabase.from("in_app_notifications").select("id, version, kind, title, body, target_type, target_reference, read_at, created_at, source_event_id").order("created_at", { ascending: false });
    if (error !== null) throw mapRpcError(error);
    return data;
  });
}

export function notificationMarkRead(supabase: SupabaseClient<Database>, notificationId: string, expectedVersion = 1) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json>(supabase, "notifications_mark_read", { p_notification_id: notificationId, p_expected_version: expectedVersion });
    if (error !== null) throw mapRpcError(error);
    return requireRow(data, "notification");
  });
}

export function notificationsMarkAll(supabase: SupabaseClient<Database>, expectedVersion?: number) {
  return result(async () => {
    const { data, error } = await callAppRpc<number>(supabase, "notifications_mark_all", { p_expected_version: expectedVersion ?? null });
    if (error !== null) throw mapRpcError(error);
    return { count: data ?? 0 };
  });
}

export function documentsList(supabase: SupabaseClient<Database>, ownerDomain?: string, ownerRecordId?: string) {
  return result(async () => {
    const { data, error } = await callAppRpc<Json[]>(supabase, "documents_projection_list", { p_owner_domain: ownerDomain ?? null, p_owner_record_id: ownerRecordId ?? null });
    if (error !== null) throw mapRpcError(error);
    return (data ?? []).map((row) => row as Record<string, unknown>);
  });
}
