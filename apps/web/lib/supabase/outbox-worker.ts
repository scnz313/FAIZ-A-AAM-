/**
 * Database outbox worker (plan.md §8, §11 B6).
 *
 * Runs server-side with the admin client (secret key — the sanctioned
 * service-role path): claims a bounded batch with `app.claim_outbox`
 * (FOR UPDATE SKIP LOCKED), dispatches each event by kind, and transitions
 * it to delivered (success or permanent failure) or back to pending with
 * exponential backoff (transient failure, `app.fail_outbox`).
 *
 * Rules enforced here:
 * - Domain success never rolls back because email/PDF work failed
 *   (plan.md §8) — a permanent delivery failure leaves the event failed and
 *   records the failure on the `notification_deliveries` row for ops review.
 * - `notification_deliveries` carries the unique
 *   (event_id, recipient, channel, template_version) constraint; re-runs
 *   never create duplicate deliveries.
 * - `email_suppressions` (hash) stop non-essential mail before sending.
 * - Recipients resolve from the record itself, never from the event payload
 *   supplied by a caller.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { createResendSender, type EmailSender } from "@/lib/email/resend";
import {
  applicationSubmittedEmail,
  applicationChangesRequestedEmail,
  applicationDecisionEmail,
  contentNoticeEmail,
  enrollmentCompleteEmail,
  examDateSheetEmail,
  invoiceIssuedEmail,
  jobApplicationStatusEmail,
  jobApplicationSubmittedEmail,
  guardianWelcomeEmail,
  linkStatusEmail,
  noticePublishedEmail,
  offerExtendedEmail,
  paymentStatusEmail,
  refundStatusEmail,
  receiptAvailableEmail,
  resultCorrectionEmail,
  resultEntryReviewEmail,
  resultsPublishedEmail,
  resultWithdrawnEmail,
  securityUpdateEmail,
  supportResponseEmail,
  timetableOverrideEmail,
  timetablePublishedEmail,
} from "@/lib/email/templates";
import { callAppRpc } from "@/lib/supabase/rpc";
import { providerEnvReadiness } from "@/lib/supabase/env";
import { PdfTransientError, generateReceiptPdf, generateReportCardPdf, generatedObjectKey, type GeneratedPdf } from "@/lib/pdf/adapter";
import { generateCsv } from "@/lib/exports/csv-generator";
import { parseCsv } from "@/lib/imports/csv-parser";
import { shapeSourceRows } from "@/modules/imports/source-rows";
import { SupabaseStorageProvider } from "@/lib/documents/providers";
import { createConfiguredDocumentScanner, detectContentType, ManualScanDeferredError, type DocumentScanner, type ScanInput, type StorageProvider } from "@/modules/services/document-providers";

export type OutboxEventRow = {
  id: string;
  event_key: string;
  kind: string;
  target_type: string;
  target_reference: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  next_attempt_at?: string;
};

/**
 * Protected data export generation (Phase 10.6): claims the generation
 * lease, reads the domain rows through bounded domain-specific queries
 * (no arbitrary SQL), generates a formula-safe CSV, uploads it as a
 * private generated document, and marks the request ready with the
 * artifact document ID. Failures are transient (retryable) or permanent.
 */
async function dispatchDataImportParse(
  admin: SupabaseClient<Database>,
  event: OutboxEventRow,
  storage: StorageProvider,
): Promise<DispatchOutcome> {
  const batchRef = event.target_reference;

  // 1. Fetch the batch and its source document
  const { data: batch, error: batchError } = await admin
    .from("data_import_batches")
    .select("id, reference, state, source_document_id")
    .eq("reference", batchRef)
    .maybeSingle();
  if (batchError !== null || batch === null) {
    return { kind: "permanent", error: `import batch ${batchRef} not found` };
  }
  if (batch.state !== "scanning") {
    return { kind: "delivered", providerIds: [`import:${batchRef}:already-processed`] };
  }
  if (batch.source_document_id === null) {
    return { kind: "permanent", error: `import batch ${batchRef} has no source document` };
  }

  // 2. Download the source document bytes from Storage
  const { data: doc, error: docError } = await admin
    .from("documents")
    .select("storage_bucket, object_key, safe_filename, mime_type, size_bytes")
    .eq("id", batch.source_document_id)
    .maybeSingle();
  if (docError !== null || doc === null) {
    return { kind: "permanent", error: `source document for batch ${batchRef} not found` };
  }

  /* A storage read failure is a provider/transport problem, not a bad file.
   * It must stay transient: recording it as a scan error would move the
   * batch to `mapping` and the retry would then see a non-scanning state. */
  let bytes: Uint8Array;
  try {
    const stat = await storage.stat({
      bucket: doc.storage_bucket,
      objectKey: doc.object_key,
    });
    bytes = stat.bytes;
  } catch (error) {
    const message = error instanceof Error ? error.message : "source document could not be read";
    return { kind: "transient", error: `import batch ${batchRef} source document could not be read: ${message}` };
  }

  try {
    // 3. Parse the CSV server-side with bounded limits
    const parsed = parseCsv(bytes);

    /* Canonical camelCase field names are the commit contract; the shared
     * shaper also normalizes contacts/names deterministically. */
    const rows = shapeSourceRows(parsed).map((row) => ({ ...row, status: "pending" }));

    /* Store rows in bounded chunks: one 10k-row JSON payload can exceed the
     * platform request-body limit, and the RPC upserts on
     * (batch_id, row_number), so a retry re-sends each chunk idempotently. */
    const STORE_CHUNK_ROWS = 500;
    for (let offset = 0; offset < rows.length; offset += STORE_CHUNK_ROWS) {
      const chunk = rows.slice(offset, offset + STORE_CHUNK_ROWS);
      const { error: rowsError } = await callAppRpc<number>(admin, "data_import_store_rows", {
        p_batch_id: batch.id,
        p_rows: chunk,
      });
      if (rowsError !== null) return { kind: "transient", error: rowsError.message };
    }

    // 4. Record scan results (headers are a JSON array, never a JSON string)
    const { error: scanError } = await callAppRpc<Record<string, unknown>>(
      admin, "data_import_record_scan", {
        p_batch_id: batch.id,
        p_row_count: parsed.rows.length,
        p_column_count: parsed.headers.length,
        p_headers: parsed.headers,
        p_encoding: "utf-8",
      },
    );
    if (scanError !== null) {
      return { kind: "transient", error: scanError.message };
    }

    return { kind: "delivered", providerIds: [`import:${batchRef}:${parsed.rows.length}rows`] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown import parse error";
    // Record the scan error so the UI can show it
    await callAppRpc<Record<string, unknown>>(admin, "data_import_record_scan", {
      p_batch_id: batch.id,
      p_row_count: 0,
      p_column_count: 0,
      p_headers: [],
      p_encoding: "utf-8",
      p_error: message,
    });
    return { kind: "permanent", error: message };
  }
}

async function dispatchDataExportGenerate(
  admin: SupabaseClient<Database>,
  event: OutboxEventRow,
  storage: StorageProvider,
): Promise<DispatchOutcome> {
  const reference = event.target_reference;
  const { data: claimed, error: claimError } = await callAppRpc<Record<string, unknown>>(
    admin, "data_export_claim_generation", { p_request_reference: reference },
  );
  if (claimError !== null) return { kind: "transient", error: claimError.message };

  const { data: request, error: requestError } = await admin
    .from("data_export_requests")
    .select("id, domain, format, filters, columns")
    .eq("reference", reference)
    .maybeSingle();
  if (requestError !== null || request === null) {
    return { kind: "permanent", error: `export request ${reference} not found` };
  }

  /* A transient failure after the claim must release the request back to
     'requested'; otherwise every later attempt is refused with "not
     generatable (state: generating)" and the export wedges forever. */
  const release = async (): Promise<string | null> => {
    const result = await callAppRpc<Record<string, unknown>>(admin, "data_export_release_generation", { p_request_reference: reference });
    return result.error === null ? null : result.error.message;
  };

  try {
    const rows = await readExportRows(admin, request.domain as string, (request.filters ?? {}) as Record<string, unknown>);
    const columns = normalizeExportColumns(request.domain as string, (request.columns ?? []) as string[]);
    const csv = generateCsv({ columns, rows });
    const checksum = sha256(csv);
    const objectKey = `exports/${reference}.csv`;
    await storage.upload({
      bucket: "fass-generated-documents",
      objectKey,
      bytes: new TextEncoder().encode(csv),
      contentType: "text/csv; charset=utf-8",
      /* A retry after a partial failure must overwrite the previous object. */
      upsert: true,
    });
    /* Idempotent document row: a retry after a partial insert reuses the
       existing row for this object key instead of failing. */
    let documentId: string | null = null;
    const { data: existingDocument } = await (admin as unknown as SupabaseClient)
      .from("documents")
      .select("id, checksum")
      .eq("object_key", objectKey)
      .maybeSingle();
    if (existingDocument) {
      documentId = existingDocument.id;
      if (existingDocument.checksum !== checksum) {
        await (admin as unknown as SupabaseClient)
          .from("documents")
          .update({ checksum, size_bytes: Buffer.byteLength(csv, "utf8") })
          .eq("id", existingDocument.id);
      }
    } else {
      const inserted = await (admin as unknown as SupabaseClient)
        .from("documents")
        .insert({
          owner_domain: "data_export",
          owner_record_id: request.id,
          category: "generated_export",
          storage_bucket: "fass-generated-documents",
          object_key: objectKey,
          safe_filename: `${reference}.csv`,
          mime_type: "text/csv",
          size_bytes: Buffer.byteLength(csv, "utf8"),
          checksum,
          actual_mime_type: "text/csv",
          actual_size_bytes: Buffer.byteLength(csv, "utf8"),
          checksum_verified: true,
          scan_status: "ready",
          visibility: "private",
          finalized_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (inserted.error !== null || inserted.data === null) {
        const releaseError = await release();
        return { kind: "transient", error: `${inserted.error?.message ?? "export document row unavailable"}${releaseError === null ? "" : ` (release failed: ${releaseError})`}` };
      }
      documentId = inserted.data.id;
    }
    const { error: readyError } = await callAppRpc<Record<string, unknown>>(
      admin, "data_export_mark_ready",
      { p_request_reference: reference, p_row_count: rows.length, p_document_id: documentId },
    );
    if (readyError !== null) {
      const releaseError = await release();
      return { kind: "transient", error: `${readyError.message}${releaseError === null ? "" : ` (release failed: ${releaseError})`}` };
    }
    await (admin as unknown as SupabaseClient).from("data_export_requests").update({ artifact_checksum: checksum }).eq("reference", reference);
    return { kind: "delivered", providerIds: [`export:${reference}:${rows.length}rows`] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown export generation error";
    await callAppRpc<Record<string, unknown>>(admin, "data_export_mark_failed", {
      p_request_reference: reference, p_error: message,
    });
    return { kind: "permanent", error: message };
  }
}

/** Bounded, domain-specific export reads — no arbitrary SQL or dynamic
 * column interpolation. Each domain selects only its allowlisted columns. */
async function readExportRows(
  admin: SupabaseClient<Database>,
  domain: string,
  filters: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const EXPORT_MAX_ROWS = 50_000;
  const PAGE_SIZE = 1000;
  const filterValues = (allowed: string[]): Array<[string, string]> =>
    Object.entries(filters)
      .filter(([key, value]) => allowed.includes(key) && typeof value === "string")
      .map(([key, value]) => [key, value as string]);
  const finish = async (
    query: ReturnType<SupabaseClient<Database>["from"]>,
    aliases: Record<string, string>,
  ): Promise<Array<Record<string, unknown>>> => {
    /* Keyset the read in 1000-row pages: a server-side PostgREST row cap must
     * never silently truncate an export. The generator still fails visibly
     * above EXPORT_MAX_ROWS. */
    const rows: Array<Record<string, unknown>> = [];
    for (let from = 0; from <= EXPORT_MAX_ROWS + PAGE_SIZE; from += PAGE_SIZE) {
      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
      if (error !== null) throw new Error(error.message);
      const page = (data ?? []) as Array<Record<string, unknown>>;
      rows.push(...page.map((row) => applyExportColumnAliases(flattenExportRow(row), aliases)));
      if (page.length < PAGE_SIZE) break;
    }
    return rows;
  };
  switch (domain) {
    case "students": {
      let query = admin.from("students").select("reference, people(display_name), status, school_student_number, enrollments(status, grade_sections(grades(label), section_label), academic_years(label))");
      for (const [key, value] of filterValues(["status"])) query = query.eq(key, value);
      return finish(query, {
        people_display_name: "display_name",
        enrollments_status: "enrollment_status",
        enrollments_grade_sections_grades_label: "grade_label",
        enrollments_grade_sections_section_label: "section_label",
        enrollments_academic_years_label: "academic_year_label",
      });
    }
    case "guardians": {
      let query = admin.from("guardians").select("reference, people(display_name), status, guardian_student_links(count)");
      for (const [key, value] of filterValues(["status"])) query = query.eq(key, value);
      return finish(query, {
        people_display_name: "display_name",
        guardian_student_links_count: "linked_children_count",
      });
    }
    case "guardian_student_links": {
      let query = admin.from("guardian_student_links").select("reference, guardians(people(display_name)), students(people(display_name)), relationship_label, status, verification_source, effective_from");
      for (const [key, value] of filterValues(["status", "verification_source"])) query = query.eq(key, value);
      return finish(query, {
        guardians_people_display_name: "guardian_display_name",
        students_people_display_name: "student_display_name",
      });
    }
    case "enrollments": {
      let query = admin.from("enrollments").select("reference, students(people(display_name)), grade_sections(grades(label), section_label), academic_years(label), status, effective_from");
      for (const [key, value] of filterValues(["status"])) query = query.eq(key, value);
      return finish(query, {
        students_people_display_name: "student_display_name",
        grade_sections_grades_label: "grade_label",
        grade_sections_section_label: "section_label",
        academic_years_label: "academic_year_label",
      });
    }
    case "admissions": {
      let query = admin.from("admission_applications").select("reference, student_name, parent_name, current_status, grade_sections(grades(label)), academic_years(label), submitted_at");
      for (const [key, value] of filterValues(["current_status"])) query = query.eq(key, value);
      return finish(query, {
        grade_sections_grades_label: "grade_label",
        academic_years_label: "academic_year_label",
      });
    }
    case "invoices": {
      let query = admin.from("invoices").select("reference, students(people(display_name)), term, status, amount_paise, paid_paise, due_date");
      for (const [key, value] of filterValues(["status", "term"])) query = query.eq(key, value);
      return finish(query, { students_people_display_name: "student_display_name" });
    }
    case "results": {
      let query = admin.from("result_report_releases").select("reference, students(people(display_name)), term, status, version, published_at");
      for (const [key, value] of filterValues(["status", "term"])) query = query.eq(key, value);
      return finish(query, { students_people_display_name: "student_display_name" });
    }
    default:
      throw new Error(`export domain ${domain} is not implemented`);
  }
}

/** Flatten nested PostgREST joins into a flat row keyed by allowlisted
 * column names. */
function flattenExportRow(row: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const visit = (prefix: string, value: unknown): void => {
    if (value === null || value === undefined) {
      flat[prefix] = null;
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
        visit(prefix, value[0]);
      } else {
        flat[prefix] = value.join(", ");
      }
      return;
    }
    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        visit(prefix === "" ? key : `${prefix}_${key}`, nested);
      }
      return;
    }
    flat[prefix] = value;
  };
  visit("", row);
  return flat;
}

/** Rename flattened join keys to the catalog column names the SQL allowlist
 * (000060) and the export builder UI agree on. Without this the generated
 * artifact carried values under join-shaped keys and every selected column
 * rendered empty. */
function applyExportColumnAliases(
  row: Record<string, unknown>,
  aliases: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [flat, target] of Object.entries(aliases)) {
    if (Object.prototype.hasOwnProperty.call(out, flat)) {
      out[target] = out[flat];
      delete out[flat];
    }
  }
  return out;
}

/** Normalize requested columns to the domain's allowlist; an empty request
 * means the full default column set. */
function normalizeExportColumns(domain: string, requested: string[]): string[] {
  const allowed = EXPORT_COLUMN_CATALOG[domain] ?? [];
  if (requested.length === 0) return [...allowed];
  return requested.filter((column) => allowed.includes(column));
}

/* Static mirror of the SQL allowlist catalog (000060/000064) for the worker.
 * The database remains the enforcement layer; this list must match exactly. */
const EXPORT_COLUMN_CATALOG: Record<string, string[]> = {
  students: ["reference", "display_name", "status", "school_student_number", "enrollment_status", "grade_label", "section_label", "academic_year_label"],
  guardians: ["reference", "display_name", "status", "linked_children_count"],
  guardian_student_links: ["reference", "guardian_display_name", "student_display_name", "relationship_label", "status", "verification_source", "effective_from"],
  enrollments: ["reference", "student_display_name", "grade_label", "section_label", "academic_year_label", "status", "effective_from"],
  admissions: ["reference", "student_name", "parent_name", "current_status", "grade_label", "academic_year_label", "submitted_at"],
  invoices: ["reference", "student_display_name", "term", "status", "amount_paise", "paid_paise", "due_date"],
  results: ["reference", "student_display_name", "term", "status", "version", "published_at"],
};

export type WorkerSummary = {
  claimed: number;
  delivered: number;
  permanentFailed: number;
  transientFailed: number;
  skippedUnknown: number;
  /** Delivered email events that resolved no recipient (clean no-op). */
  skippedNoRecipients: number;
  /** True when email provider configuration is missing; no work was claimed. */
  emailConfigMissing: boolean;
};

export type Recipient = { accountId: string | null; email: string };

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/* ------------------------------------------------------------------ */
/* Recipient resolution (from the record, never from caller payloads)   */
/* ------------------------------------------------------------------ */

/** Only an `@`-bearing contact is a deliverable address. A phone number in
 *  `verified_contact` is skipped, never handed to the email provider. */
function emailRecipient(accountId: string | null, contact: unknown): Recipient | null {
  if (typeof contact !== "string") return null;
  const email = contact.trim();
  if (email.length === 0 || !email.includes("@")) return null;
  return { accountId, email };
}

async function ownerEmail(admin: SupabaseClient<Database>, applicationRef: string): Promise<Recipient | null> {
  const { data, error } = await admin
    .from("admission_applications")
    .select("owner_account_id, user_accounts(verified_contact)")
    .eq("reference", applicationRef)
    .maybeSingle();
  if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
  if (data === null) return null;
  return emailRecipient(data.owner_account_id, data.user_accounts?.verified_contact);
}

/** Active emails for guardian person ids. Guardians and user_accounts share
 *  `people`, so PostgREST cannot embed one from the other (there is no direct
 *  FK); this is a deliberate two-step resolution. */
async function guardianEmailsForPersons(admin: SupabaseClient<Database>, personIds: string[]): Promise<Recipient[]> {
  const unique = [...new Set(personIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return [];
  const { data, error } = await admin
    .from("user_accounts")
    .select("id, person_id, verified_contact")
    .in("person_id", unique)
    .eq("status", "active");
  if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
  return (data ?? []).flatMap((account) => {
    const recipient = emailRecipient(account.id, account.verified_contact);
    return recipient === null ? [] : [recipient];
  });
}

async function guardianEmailsForStudent(admin: SupabaseClient<Database>, studentId: string): Promise<Recipient[]> {
  const { data, error } = await admin
    .from("guardian_student_links")
    .select("guardians(person_id)")
    .eq("student_id", studentId)
    .eq("status", "active");
  if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
  const personIds = (data ?? []).map((link) => link.guardians?.person_id).filter((id): id is string => typeof id === "string");
  return guardianEmailsForPersons(admin, personIds);
}

async function studentsInSection(admin: SupabaseClient<Database>, gradeSectionId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("enrollments")
    .select("student_id")
    .eq("grade_section_id", gradeSectionId)
    .eq("status", "active");
  if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
  return (data ?? []).map((enrollment) => enrollment.student_id);
}

async function guardianEmailsForLink(admin: SupabaseClient<Database>, linkReference: string): Promise<Recipient[]> {
  const { data, error } = await admin
    .from("guardian_student_links")
    .select("guardians(person_id)")
    .eq("reference", linkReference)
    .maybeSingle();
  if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
  const personId = data?.guardians?.person_id;
  return guardianEmailsForPersons(admin, typeof personId === "string" ? [personId] : []);
}

async function accountEmails(admin: SupabaseClient<Database>, accountIds: string[]): Promise<Recipient[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await admin.from("user_accounts").select("id, verified_contact").in("id", accountIds);
  if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
  return (data ?? []).flatMap((account) => {
    const recipient = emailRecipient(account.id, account.verified_contact);
    return recipient === null ? [] : [recipient];
  });
}

async function staffEmailsForRoles(admin: SupabaseClient<Database>, roles: string[]): Promise<Recipient[]> {
  const { data, error } = await admin.from("role_grants").select("account_id, role_code").in("role_code", roles).eq("status", "active");
  if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
  return accountEmails(admin, [...new Set((data ?? []).map((grant) => grant.account_id))]);
}

async function recipientsForNotice(admin: SupabaseClient<Database>, noticeReference: string): Promise<Recipient[]> {
  const { data: notice, error: noticeError } = await admin.from("notices").select("id").eq("reference", noticeReference).maybeSingle();
  if (noticeError !== null) throw new Error(`recipient lookup failed: ${noticeError.message}`);
  if (!notice) return [];
  const { data: audiences, error: audienceError } = await admin.from("notice_audiences").select("audience, role_code, academic_year_id, grade_section_id, student_id").eq("notice_id", notice.id);
  if (audienceError !== null) throw new Error(`recipient lookup failed: ${audienceError.message}`);
  const accountIds = new Set<string>();
  for (const audience of audiences ?? []) {
    if (audience.audience === "role" && audience.role_code) {
      const roleRecipients = await staffEmailsForRoles(admin, [audience.role_code]);
      roleRecipients.forEach((recipient) => {
        if (recipient.accountId !== null) accountIds.add(recipient.accountId);
      });
      continue;
    }
    let studentIds: string[] = [];
    if (audience.audience === "student" && audience.student_id) studentIds = [audience.student_id];
    if (audience.audience === "grade_section" && audience.grade_section_id) studentIds = await studentsInSection(admin, audience.grade_section_id);
    if (audience.audience === "academic_year" && audience.academic_year_id) {
      const { data: enrollments, error: enrollmentError } = await admin.from("enrollments").select("student_id").eq("academic_year_id", audience.academic_year_id).eq("status", "active");
      if (enrollmentError !== null) throw new Error(`recipient lookup failed: ${enrollmentError.message}`);
      studentIds = (enrollments ?? []).map((enrollment) => enrollment.student_id);
    }
    for (const studentId of studentIds) {
      for (const recipient of await guardianEmailsForStudent(admin, studentId)) {
        if (recipient.accountId !== null) accountIds.add(recipient.accountId);
      }
    }
  }
  return accountEmails(admin, [...accountIds]);
}

export async function resolveRecipients(
  admin: SupabaseClient<Database>,
  event: OutboxEventRow,
): Promise<Recipient[]> {
  const db = admin as unknown as SupabaseClient;
  const target = event.target_reference;
  const seen = new Set<string>();
  const recipients: Recipient[] = [];

  switch (event.target_type) {
    case "admission_application": {
      const owner = await ownerEmail(admin, target);
      if (owner !== null) recipients.push(owner);
      break;
    }
    case "invoice": {
      const { data: invoice, error: invoiceError } = await admin
        .from("invoices")
        .select("student_id, applicant_ref")
        .eq("reference", target)
        .maybeSingle();
      if (invoiceError !== null) throw new Error(`recipient lookup failed: ${invoiceError.message}`);
      if (invoice === null) break;
      if (invoice.applicant_ref !== null) {
        const owner = await ownerEmail(admin, invoice.applicant_ref);
        if (owner !== null) recipients.push(owner);
      } else if (invoice.student_id !== null) {
        recipients.push(...(await guardianEmailsForStudent(admin, invoice.student_id)));
      }
      break;
    }
    case "receipt": {
      const { data: receipt, error: receiptError } = await admin
        .from("receipts")
        .select("invoices(reference)")
        .eq("reference", target)
        .maybeSingle();
      if (receiptError !== null) throw new Error(`recipient lookup failed: ${receiptError.message}`);
      if (receipt?.invoices?.reference !== undefined && receipt.invoices.reference !== null) {
        recipients.push(...(await resolveRecipients(admin, { ...event, target_type: "invoice", target_reference: receipt.invoices.reference })));
      }
      break;
    }
    case "refund_request":
    case "refund_requests": {
      const { data: refund, error: refundError } = await admin
        .from("refund_requests")
        .select("payments(payment_allocations(invoices(reference)))")
        .eq("reference", target)
        .maybeSingle();
      if (refundError !== null) throw new Error(`recipient lookup failed: ${refundError.message}`);
      const allocations = Array.isArray(refund?.payments?.payment_allocations)
        ? refund.payments.payment_allocations
        : refund?.payments?.payment_allocations ? [refund.payments.payment_allocations] : [];
      for (const allocation of allocations) {
        if (allocation.invoices?.reference) recipients.push(...(await resolveRecipients(admin, { ...event, target_type: "invoice", target_reference: allocation.invoices.reference })));
      }
      break;
    }
    case "support_request":
    case "support_requests": {
      const { data: support, error: supportError } = await admin.from("support_requests").select("requester_account_id, assignee_account_id").eq("reference", target).maybeSingle();
      if (supportError !== null) throw new Error(`recipient lookup failed: ${supportError.message}`);
      const accounts = event.event_key.startsWith("email.support")
        ? [support?.requester_account_id]
        : [support?.requester_account_id, support?.assignee_account_id];
      recipients.push(...(await accountEmails(admin, accounts.filter((id): id is string => typeof id === "string"))));
      break;
    }
    case "enrollment": {
      const enrollmentQuery = isUuid(target)
        ? admin.from("enrollments").select("student_id").eq("id", target)
        : admin.from("enrollments").select("student_id").eq("reference", target);
      const { data: enrollment, error: enrollmentError } = await enrollmentQuery.maybeSingle();
      if (enrollmentError !== null) throw new Error(`recipient lookup failed: ${enrollmentError.message}`);
      if (enrollment !== null) recipients.push(...(await guardianEmailsForStudent(admin, enrollment.student_id)));
      break;
    }
    case "student":
    case "students": {
      const { data: student, error: studentError } = await admin.from("students").select("id").eq("reference", target).maybeSingle();
      if (studentError !== null) throw new Error(`recipient lookup failed: ${studentError.message}`);
      if (student) recipients.push(...(await guardianEmailsForStudent(admin, student.id)));
      break;
    }
    case "guardian_student_link":
    case "guardian_links":
    case "guardian_student_links":
      recipients.push(...(await guardianEmailsForLink(admin, target)));
      break;
    case "job_application":
    case "job_applications": {
      /* Public intake applications have no owner account; their contact
         identity is the application's own applicant_email (000105). Until the
         migration is applied the column does not exist, so fall back to the
         account-bound projection rather than failing every job email. */
      const withContact = await admin
        .from("job_applications")
        .select("owner_account_id, applicant_email")
        .eq("reference", target)
        .maybeSingle();
      let row: { owner_account_id: string | null; applicant_email: string | null } | null = withContact.data === null || withContact.data === undefined
        ? null
        : {
            owner_account_id: (withContact.data as { owner_account_id: string | null }).owner_account_id,
            applicant_email: (withContact.data as { applicant_email: string | null }).applicant_email ?? null,
          };
      if (withContact.error !== null) {
        if (!withContact.error.message.includes("applicant_email")) {
          throw new Error(`recipient lookup failed: ${withContact.error.message}`);
        }
        const legacy = await admin
          .from("job_applications")
          .select("owner_account_id")
          .eq("reference", target)
          .maybeSingle();
        if (legacy.error !== null) throw new Error(`recipient lookup failed: ${legacy.error.message}`);
        row = legacy.data === null || legacy.data === undefined
          ? null
          : { owner_account_id: (legacy.data as { owner_account_id: string | null }).owner_account_id, applicant_email: null };
      }
      if (row) {
        if (row.owner_account_id !== null && row.owner_account_id !== undefined) {
          recipients.push(...(await accountEmails(admin, [row.owner_account_id])));
        } else {
          const contact = emailRecipient(null, row.applicant_email);
          if (contact !== null) recipients.push(contact);
        }
      }
      break;
    }
    case "notice":
    case "notices":
    case "content_item":
      recipients.push(...(await recipientsForNotice(admin, target)));
      break;
    case "user_account":
    case "user_accounts": {
      // This account id is attached by a trusted domain command, not supplied
      // by a browser notification caller.
      const accountId = typeof event.payload.accountId === "string" ? event.payload.accountId : isUuid(target) ? target : null;
      if (accountId) recipients.push(...(await accountEmails(admin, [accountId])));
      break;
    }
    case "applicant_identity":
    case "staff_assignment": {
      const accountId = typeof event.payload.accountId === "string" ? event.payload.accountId : null;
      if (accountId) recipients.push(...(await accountEmails(admin, [accountId])));
      break;
    }
    case "account_invitation":
    case "account_invitations": {
      /* Supabase Auth delivers the invitation token at creation
       * (`dispatchStaffInvitation` -> `provider.inviteUser`). This outbox
       * event carries no token, so it is a safe no-op; in particular the
       * inviter must never receive the invitee's invitation. */
      break;
    }
    case "guardian_claim_invitation": {
      const { data: claim, error: claimError } = await db
        .from("guardian_claim_invitations")
        .select("guardian_contact_id")
        .eq("reference", target)
        .maybeSingle();
      if (claimError !== null) throw new Error(`recipient lookup failed: ${claimError.message}`);
      if (claim !== null) {
        const { data: contact, error: contactError } = await db
          .from("guardian_contacts")
          .select("channel, value")
          .eq("id", claim.guardian_contact_id)
          .maybeSingle();
        if (contactError !== null) throw new Error(`recipient lookup failed: ${contactError.message}`);
        if (contact?.channel === "email") {
          const recipient = emailRecipient(null, contact.value);
          if (recipient !== null) recipients.push(recipient);
        }
      }
      break;
    }
    case "result_batch":
    case "result_batches":
    case "result_entry_sheet":
    case "result_entry_sheets":
      recipients.push(...(await staffEmailsForRoles(admin, ["exam_reviewer", "result_publisher"])));
      break;
    case "result_report_release":
    case "result_report_releases": {
      const { data, error } = await db.from("result_report_releases").select("student_id").eq("reference", target).maybeSingle();
      if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
      if (data) recipients.push(...(await guardianEmailsForStudent(admin, data.student_id)));
      break;
    }
    case "exam_schedule_version": {
      const { data, error } = await admin.from("exam_schedule_versions").select("grade_section_id").eq("reference", target).maybeSingle();
      if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
      if (data) for (const studentId of await studentsInSection(admin, data.grade_section_id)) recipients.push(...(await guardianEmailsForStudent(admin, studentId)));
      break;
    }
    case "timetable_override": {
      const { data, error } = await db.from("timetable_overrides").select("grade_section_id").eq("reference", target).maybeSingle();
      if (error !== null) throw new Error(`recipient lookup failed: ${error.message}`);
      if (data) for (const studentId of await studentsInSection(admin, data.grade_section_id)) recipients.push(...(await guardianEmailsForStudent(admin, studentId)));
      break;
    }
    case "result_publication": {
      const { data: publication, error: publicationError } = await db
        .from("result_publications")
        .select("batch_id, source_entry_sheet_id, result_batches(grade_section_id), result_entry_sheets(grade_section_id)")
        .eq("reference", target)
        .maybeSingle();
      if (publicationError !== null) throw new Error(`recipient lookup failed: ${publicationError.message}`);
      const publicationRecord = publication as {
        result_batches?: { grade_section_id?: string } | { grade_section_id?: string }[] | null;
        result_entry_sheets?: { grade_section_id?: string } | { grade_section_id?: string }[] | null;
      } | null;
      const batch = Array.isArray(publicationRecord?.result_batches) ? publicationRecord.result_batches[0] : publicationRecord?.result_batches;
      const sheet = Array.isArray(publicationRecord?.result_entry_sheets) ? publicationRecord.result_entry_sheets[0] : publicationRecord?.result_entry_sheets;
      const gradeSectionId = batch?.grade_section_id ?? sheet?.grade_section_id ?? null;
      if (gradeSectionId !== null) {
        const studentIds = await studentsInSection(admin, gradeSectionId);
        for (const studentId of studentIds) recipients.push(...(await guardianEmailsForStudent(admin, studentId)));
      }
      break;
    }
    case "timetable_publication": {
      const { data: publication, error: publicationError } = await admin
        .from("timetable_publications")
        .select("timetable_versions(grade_section_id)")
        .eq("reference", target)
        .maybeSingle();
      if (publicationError !== null) throw new Error(`recipient lookup failed: ${publicationError.message}`);
      if (publication?.timetable_versions?.grade_section_id !== undefined && publication.timetable_versions.grade_section_id !== null) {
        const studentIds = await studentsInSection(admin, publication.timetable_versions.grade_section_id);
        for (const studentId of studentIds) recipients.push(...(await guardianEmailsForStudent(admin, studentId)));
      }
      break;
    }
    default:
      break;
  }

  const deduped: Recipient[] = [];
  for (const recipient of recipients) {
    const key = `${recipient.accountId}:${recipient.email}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(recipient);
    }
  }
  return deduped;
}

/* ------------------------------------------------------------------ */
/* Template selection by event key prefix                               */
/* ------------------------------------------------------------------ */

export async function renderEmail(admin: SupabaseClient<Database>, event: OutboxEventRow, _recipient: Recipient) {
  const db = admin as unknown as SupabaseClient;
  const key = event.event_key;
  const target = event.target_reference;
  if (key.startsWith("email.application_submitted")) return applicationSubmittedEmail({ applicationRef: target });
  if (key.startsWith("email.application_changes")) return applicationChangesRequestedEmail({ applicationRef: target });
  if (key.startsWith("email.application_decision")) return applicationDecisionEmail({ applicationRef: target, decision: event.payload.decision === "waitlisted" ? "waitlisted" : "declined" });
  if (key.startsWith("email.offer")) {
    const { data } = await admin
      .from("admission_offers")
      .select("expires_at")
      .eq("application_id", (await admin.from("admission_applications").select("id").eq("reference", target).maybeSingle()).data?.id ?? "")
      .maybeSingle();
    const expiresLabel = data?.expires_at
      ? new Date(data.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })
      : "the stated deadline";
    return offerExtendedEmail({ applicationRef: target, expiresLabel });
  }
  if (key.startsWith("email.invoice_issued")) {
    const applicationRef = typeof event.payload.applicationRef === "string" ? event.payload.applicationRef : target;
    const { data: invoice } = await admin.from("invoices").select("applicant_ref").eq("reference", target).maybeSingle();
    return invoiceIssuedEmail({ invoiceRef: target, applicationRef: invoice?.applicant_ref ?? applicationRef });
  }
  if (key.startsWith("email.receipt")) {
    return receiptAvailableEmail({ receiptRef: target });
  }
  if (key.startsWith("email.enrollment_complete")) {
    const enrollmentId = target;
    const { data } = await admin.from("enrollments").select("student_id, students(reference)").eq("id", enrollmentId).maybeSingle();
    return enrollmentCompleteEmail({ studentRef: data?.students?.reference ?? "your child" });
  }
  if (key.startsWith("email.job_submitted")) return jobApplicationSubmittedEmail({ applicationRef: target });
  if (key.startsWith("email.job_offer") || key.startsWith("email.job_status")) {
    /* The rejection/offer email must carry the HR decision reason the
       applicant is entitled to see (owner requirement, 15 Sep 2026). The
       event key ends in `:v<application version>`; resolve exactly that
       decision row so a retried event never picks up a later decision. */
    const versionMatch = /:v(\d+)$/.exec(key);
    const decisionVersion = versionMatch ? Number(versionMatch[1]) : null;
    const payloadStatus = typeof event.payload.status === "string" ? event.payload.status : null;
    const status = payloadStatus === "shortlisted" || payloadStatus === "interview" || payloadStatus === "offered" || payloadStatus === "not_selected"
      ? payloadStatus
      : undefined;
    let reason: string | null = null;
    const { data: application, error: applicationError } = await admin
      .from("job_applications")
      .select("id")
      .eq("reference", target)
      .maybeSingle();
    if (applicationError !== null) throw new Error(`recipient lookup failed: ${applicationError.message}`);
    if (application !== null) {
      const decisionQuery = admin
        .from("job_application_decisions")
        .select("reason, action, version")
        .eq("application_id", application.id);
      const { data: decision } = decisionVersion !== null
        ? await decisionQuery.eq("version", decisionVersion).maybeSingle()
        : await decisionQuery.order("version", { ascending: false }).limit(1).maybeSingle();
      reason = typeof decision?.reason === "string" && decision.reason.trim().length > 0 ? decision.reason.trim() : null;
    }
    return jobApplicationStatusEmail({ applicationRef: target, status, reason });
  }
  if (key.startsWith("email.payment") || key.startsWith("email.finance")) return paymentStatusEmail({ reference: target });
  if (key.startsWith("email.refund")) return refundStatusEmail({ reference: target });
  if (key.startsWith("email.results_published")) {
    const { data } = await admin
      .from("result_publications")
      .select("source_entry_sheet_id, result_entry_sheets(exam_definitions(term), subjects(name)), result_batches(exam_definitions(term), subjects(name))")
      .eq("reference", target)
      .maybeSingle();
    const sheet = Array.isArray(data?.result_entry_sheets) ? data.result_entry_sheets[0] : data?.result_entry_sheets;
    const batch = Array.isArray(data?.result_batches) ? data.result_batches[0] : data?.result_batches;
    const sheetExam = Array.isArray(sheet?.exam_definitions) ? sheet.exam_definitions[0] : sheet?.exam_definitions;
    const batchExam = Array.isArray(batch?.exam_definitions) ? batch.exam_definitions[0] : batch?.exam_definitions;
    return resultsPublishedEmail({
      term: sheetExam?.term ?? batchExam?.term ?? "recent",
      subject: sheet?.subjects?.name ?? batch?.subjects?.name ?? "subject",
    });
  }
  if (key.startsWith("email.result_publication")) {
    /* Sheet-native publications carry their term/subject on the entry sheet;
       never fall back to placeholder copy while the real record is readable. */
    const { data } = await admin
      .from("result_publications")
      .select("source_entry_sheet_id, result_entry_sheets(exam_definitions(term), subjects(name)), result_batches(exam_definitions(term), subjects(name))")
      .eq("reference", target)
      .maybeSingle();
    const sheet = Array.isArray(data?.result_entry_sheets) ? data.result_entry_sheets[0] : data?.result_entry_sheets;
    const batch = Array.isArray(data?.result_batches) ? data.result_batches[0] : data?.result_batches;
    const sheetExam = Array.isArray(sheet?.exam_definitions) ? sheet.exam_definitions[0] : sheet?.exam_definitions;
    const batchExam = Array.isArray(batch?.exam_definitions) ? batch.exam_definitions[0] : batch?.exam_definitions;
    return resultsPublishedEmail({
      term: sheetExam?.term ?? batchExam?.term ?? "recent",
      subject: sheet?.subjects?.name ?? batch?.subjects?.name ?? "subject",
    });
  }
  if (key.startsWith("email.result_report_release")) {
    /* A report release is the multi-subject manifest families read. */
    const { data } = await admin
      .from("result_report_releases")
      .select("term, result_report_release_items(subjects(name))")
      .eq("reference", target)
      .maybeSingle();
    const items = data?.result_report_release_items ?? [];
    const subject = items.length === 1 ? (items[0]?.subjects?.name ?? "Report card") : "Report card";
    return resultsPublishedEmail({ term: data?.term ?? "recent", subject });
  }
  if (key.startsWith("email.results_withdrawn")) return resultWithdrawnEmail({ reference: target });
  if (key.startsWith("email.result_correction") || key.startsWith("email.results_corrected")) return resultCorrectionEmail({ reference: target });
  if (key.startsWith("email.exam_date_sheet")) return examDateSheetEmail({ reference: target });
  if (key.startsWith("email.timetable_override")) return timetableOverrideEmail({ reference: target });
  if (key.startsWith("email.timetable_published")) {
    const { data } = await admin
      .from("timetable_publications")
      .select("timetable_versions(grade_sections(section_label, grades(label)))")
      .eq("reference", target)
      .maybeSingle();
    const section = data?.timetable_versions?.grade_sections;
    return timetablePublishedEmail({
      className: section ? `${section.grades?.label ?? "Class"} ${section.section_label}` : "your class",
    });
  }
  if (key.startsWith("email.link_approved")) return linkStatusEmail({ reference: target, approved: true });
  if (key.startsWith("email.link_rejected")) return linkStatusEmail({ reference: target, approved: false });
  if (key.startsWith("email.link_requested")) return linkStatusEmail({ reference: target, approved: false });
  if (key.startsWith("email.support")) return supportResponseEmail({ threadRef: target });
  if (key.startsWith("email.notice") || key.startsWith("email.content")) return noticePublishedEmail({ reference: target });
  if (key.startsWith("email.guardian_welcome")) {
    const { data: claim } = await db
      .from("guardian_claim_invitations")
      .select("id, guardian_id")
      .eq("reference", target)
      .maybeSingle();
    if (claim === null) return null;
    const [{ data: guardian }, { data: claimLinks }] = await Promise.all([
      db.from("guardians").select("people(display_name)").eq("id", claim.guardian_id).maybeSingle(),
      db.from("guardian_claim_links").select("guardian_student_links(students(people(display_name)))").eq("claim_id", claim.id),
    ]);
    const guardianRow = guardian as { people?: { display_name?: string | null } | null } | null;
    const studentNames = (claimLinks ?? []).flatMap((claimLink) => {
      const row = claimLink as { guardian_student_links?: { students?: { people?: { display_name?: string | null } | null } | null } | null };
      const displayName = row.guardian_student_links?.students?.people?.display_name?.trim();
      return displayName ? [displayName] : [];
    });
    return guardianWelcomeEmail({
      guardianName: guardianRow?.people?.display_name?.trim() || "Guardian",
      studentNames,
    });
  }
  if (key.startsWith("email.staff_invitation")) return null;
  if (key.startsWith("security.")) return securityUpdateEmail({ reference: target });
  if (key.startsWith("email.marks_") || key.startsWith("email.result_entry_sheet_submitted")) return resultEntryReviewEmail({ reference: target });
  if (key.startsWith("content.") || key.startsWith("notice.")) return contentNoticeEmail({ reference: target });
  return null;
}

/* ------------------------------------------------------------------ */
/* Delivery row tracking                                                */
/* ------------------------------------------------------------------ */

async function recordDelivery(
  admin: SupabaseClient<Database>,
  input: { eventId: string; eventKey: string; recipient: Recipient; templateVersion: string },
): Promise<{ id: string; status: string; attempts: number; nextAttemptAt: string | null; failureClass: string | null } | null> {
  const db = admin as unknown as SupabaseClient;
  const deliveryFields = {
    event_id: input.eventId,
    channel: "email",
    template_version: input.templateVersion,
    status: "pending",
    attempts: 0,
  };
  if (input.recipient.accountId === null) {
    /* Accountless recipient (public job applicant, 000105): dedupe by the
       lowercased contact through the partial unique index, because a null
       account id is distinct in the account-bound unique constraint. */
    const contact = input.recipient.email.toLowerCase().trim();
    const inserted = await db
      .from("notification_deliveries")
      .insert({ ...deliveryFields, recipient_account_id: null, recipient_contact: contact })
      .select("id")
      .single();
    if (inserted.error === null && inserted.data !== null) {
      return { id: inserted.data.id, status: "pending", attempts: 0, nextAttemptAt: null, failureClass: null };
    }
    const { data: existing, error: existingError } = await db
      .from("notification_deliveries")
      .select("id, status, attempts, next_attempt_at, failure_class")
      .eq("event_id", input.eventId)
      .is("recipient_account_id", null)
      .eq("recipient_contact", contact)
      .eq("channel", "email")
      .eq("template_version", input.templateVersion)
      .maybeSingle();
    if (existingError !== null) throw new Error(`delivery record lookup failed: ${existingError.message}`);
    if (existing === null) return null;
    return { id: existing.id, status: existing.status, attempts: existing.attempts, nextAttemptAt: existing.next_attempt_at, failureClass: existing.failure_class };
  }

  const { data, error } = await admin
    .from("notification_deliveries")
    .upsert(
      {
        ...deliveryFields,
        recipient_account_id: input.recipient.accountId,
      },
      { onConflict: "event_id,recipient_account_id,channel,template_version", ignoreDuplicates: true },
  )
    .select("id")
    .single();
  if (error === null && data !== null) return { id: data.id, status: "pending", attempts: 0, nextAttemptAt: null, failureClass: null };
  // A duplicate upsert can surface as an empty representation (or a
  // provider-specific conflict code). Always resolve the existing row by its
  // unique tuple rather than treating it as already processed.
  const { data: existing, error: existingError } = await db
    .from("notification_deliveries")
    .select("id, status, attempts, next_attempt_at, failure_class")
    .eq("event_id", input.eventId)
    .eq("recipient_account_id", input.recipient.accountId)
    .eq("channel", "email")
    .eq("template_version", input.templateVersion)
    .maybeSingle();
  if (existingError !== null) throw new Error(`delivery record lookup failed: ${existingError.message}`);
  if (existing === null) return null;
  return { id: existing.id, status: existing.status, attempts: existing.attempts, nextAttemptAt: existing.next_attempt_at, failureClass: existing.failure_class };
}

async function updateDelivery(
  admin: SupabaseClient<Database>,
  deliveryId: string,
  update: { status: string; providerMessageId?: string | null; lastError?: string | null; failureClass?: string | null; attempts: number; nextAttemptAt?: string | null },
) {
  const db = admin as unknown as SupabaseClient;
  const { error } = await db
    .from("notification_deliveries")
    .update({
      status: update.status,
      provider_message_id: update.providerMessageId ?? null,
      last_error: update.lastError ?? null,
      failure_class: update.failureClass ?? null,
      attempts: update.attempts,
      next_attempt_at: update.nextAttemptAt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);
  if (error !== null) throw new Error(`delivery record update failed: ${error.message}`);
}

async function persistGeneratedPdf(
  admin: SupabaseClient<Database>,
  event: OutboxEventRow,
  generated: GeneratedPdf,
): Promise<DispatchOutcome> {
  const db = admin as unknown as SupabaseClient;
  const objectKey = generatedObjectKey(generated.sourceRecordId, generated.checksum, generated.documentType);
  let { data: generation, error: generationError } = await db
    .from("document_generation_records")
    .select("id, reference, object_key, document_id, status, attempts")
    .eq("source_record_id", generated.sourceRecordId)
    .eq("document_type", generated.documentType)
    .eq("template_version", generated.templateVersion)
    .eq("source_checksum", generated.checksum)
    .maybeSingle();
  if (generationError !== null) return { kind: "transient", error: `generation record lookup failed: ${generationError.message}` };
  if (generation?.status === "ready" && generation.document_id) return { kind: "delivered", providerIds: [`generation:${generation.reference}`] };
  if (!generation) {
    const inserted = await db.from("document_generation_records").insert({
      source_domain: generated.documentType,
      source_record_id: generated.sourceRecordId,
      source_reference: generated.sourceReference,
      document_type: generated.documentType,
      template_version: generated.templateVersion,
      source_checksum: generated.checksum,
      storage_bucket: "fass-generated-documents",
      object_key: objectKey,
      status: "pending",
      attempts: 0,
    }).select("id, reference, object_key, document_id, status, attempts").maybeSingle();
    if (inserted.error !== null && !/duplicate|unique/i.test(inserted.error.message)) return { kind: "transient", error: `generation record failed: ${inserted.error.message}` };
    generation = inserted.data;
    if (!generation) {
      const retry = await db.from("document_generation_records").select("id, reference, object_key, document_id, status, attempts").eq("source_record_id", generated.sourceRecordId).eq("document_type", generated.documentType).eq("template_version", generated.templateVersion).eq("source_checksum", generated.checksum).maybeSingle();
      generationError = retry.error;
      generation = retry.data;
    }
  }
  if (!generation) return { kind: "transient", error: "generation record could not be reserved" };
  if (generation.status === "ready" && generation.document_id) return { kind: "delivered", providerIds: [`generation:${generation.reference}`] };

  await db.from("document_generation_records").update({ status: "uploading", attempts: (generation.attempts ?? 0) + 1, last_error: null, object_key: generation.object_key ?? objectKey }).eq("id", generation.id);
  const storage = new SupabaseStorageProvider(admin);
  try {
    try {
      await storage.upload({ bucket: "fass-generated-documents", objectKey: generation.object_key ?? objectKey, bytes: generated.bytes, contentType: "application/pdf", upsert: false });
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "storage upload failed";
      if (!/already exists|duplicate/i.test(message)) return { kind: "transient", error: message };
      const existing = await storage.stat({ bucket: "fass-generated-documents", objectKey: generation.object_key ?? objectKey });
      if (existing.checksumSha256 !== generated.checksum || existing.sizeBytes !== generated.sizeBytes) return { kind: "permanent", error: "existing generated object checksum mismatch" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "generated object verification failed";
    await db.from("document_generation_records").update({ status: "failed", last_error: message }).eq("id", generation.id);
    return { kind: "transient", error: message };
  }

  let documentId: string | null = null;
  let documentReference: string | null = null;
  const { data: existingDocument } = await db.from("documents").select("id, reference, checksum, scan_status").eq("object_key", generation.object_key ?? objectKey).maybeSingle();
  if (existingDocument) {
    documentId = existingDocument.id;
    documentReference = existingDocument.reference;
    if (existingDocument.checksum && existingDocument.checksum !== generated.checksum) return { kind: "permanent", error: "generated document checksum mismatch" };
  } else {
    const insertedDocument = await db.from("documents").insert({
      owner_domain: generated.ownerDomain,
      owner_record_id: generated.ownerRecordId,
      category: generated.documentType === "receipt" ? "generated_receipt" : "generated_report_card",
      object_key: generation.object_key ?? objectKey,
      safe_filename: generated.safeFilename,
      mime_type: "application/pdf",
      size_bytes: generated.sizeBytes,
      checksum: generated.checksum,
      actual_mime_type: "application/pdf",
      actual_size_bytes: generated.sizeBytes,
      checksum_verified: true,
      finalized_at: new Date().toISOString(),
      scan_status: "ready",
      visibility: "private",
      storage_bucket: "fass-generated-documents",
      uploaded_by_account_id: null,
    }).select("id, reference").maybeSingle();
    if (insertedDocument.error !== null && !/duplicate|unique/i.test(insertedDocument.error.message)) return { kind: "transient", error: `document record failed: ${insertedDocument.error.message}` };
    documentId = insertedDocument.data?.id ?? null;
    documentReference = insertedDocument.data?.reference ?? null;
    if (!documentId) {
      const retry = await db.from("documents").select("id, reference").eq("object_key", generation.object_key ?? objectKey).maybeSingle();
      documentId = retry.data?.id ?? null;
      documentReference = retry.data?.reference ?? null;
    }
  }
  if (!documentId || !documentReference) return { kind: "transient", error: "generated document metadata could not be reserved" };

  const linkTable = generated.ownerDomain === "invoice" ? "invoice_documents" : "student_documents";
  const linkColumn = generated.ownerDomain === "invoice" ? "invoice_id" : "student_id";
  await db.from(linkTable).upsert({ [linkColumn]: generated.ownerRecordId, document_id: documentId }, { onConflict: "document_id", ignoreDuplicates: true });
  await db.from("document_processing_events").upsert([
    { document_id: documentId, event_type: "generation_requested", detail: `outbox ${event.event_key}`, idempotency_key: `generation-requested:${generation.id}` },
    { document_id: documentId, event_type: "generated", detail: `template ${generated.templateVersion}, ${generated.sizeBytes} bytes, uploaded to private storage`, idempotency_key: `generated:${generation.id}` },
  ], { onConflict: "idempotency_key", ignoreDuplicates: true });
  await db.from("document_generation_records").update({ status: "ready", document_id: documentId, content_checksum: generated.checksum, ready_at: new Date().toISOString(), last_error: null }).eq("id", generation.id);
  return { kind: "delivered", providerIds: [documentReference] };
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                             */
/* ------------------------------------------------------------------ */

type DispatchOutcome =
  | { kind: "delivered"; providerIds: string[] }
  | { kind: "permanent"; error: string }
  | { kind: "transient"; error: string }
  | { kind: "unknown" };

async function dispatchStorageEvent(
  admin: SupabaseClient<Database>,
  event: OutboxEventRow,
  storage: StorageProvider,
  scanner: DocumentScanner,
): Promise<DispatchOutcome> {
  const db = admin as unknown as SupabaseClient;
  if (event.kind === "storage.orphan_cleanup") {
    let removed = 0;
    for (const bucket of ["fass-private-documents", "fass-generated-documents"]) {
      const objects = await storage.list({ bucket, limit: 100 });
      for (const object of objects) {
        const { data: document } = await db.from("documents").select("id").eq("storage_bucket", bucket).eq("object_key", object.objectKey).maybeSingle();
        if (document) continue;
        const { data: generation } = await db.from("document_generation_records").select("id").eq("storage_bucket", bucket).eq("object_key", object.objectKey).maybeSingle();
        if (generation) continue;
        await db.from("storage_orphan_records").upsert({ bucket, object_key: object.objectKey, status: "discovered", last_seen_at: new Date().toISOString() }, { onConflict: "bucket,object_key", ignoreDuplicates: false });
        await storage.remove({ bucket, objectKey: object.objectKey });
        await db.from("storage_orphan_records").update({ status: "deleted", last_seen_at: new Date().toISOString() }).eq("bucket", bucket).eq("object_key", object.objectKey);
        removed += 1;
      }
    }
    return { kind: "delivered", providerIds: [`orphans:${removed}`] };
  }
  if (event.kind === "document.retention") {
    const { data: candidates, error } = await callAppRpc<unknown[]>(admin, "documents_retention_candidates", { p_limit: 100 });
    if (error !== null) return { kind: "transient", error: error.message };
    for (const candidate of candidates ?? []) {
      const document = candidate as { id?: string; storage_bucket?: string; object_key?: string };
      if (!document.id || !document.storage_bucket || !document.object_key) continue;
      await storage.remove({ bucket: document.storage_bucket, objectKey: document.object_key });
      await callAppRpc(admin, "documents_mark_deleted", { p_document_id: document.id, p_detail: "retention policy reached" });
    }
    return { kind: "delivered", providerIds: [`retention:${candidates?.length ?? 0}`] };
  }
  const documentRef = event.target_reference;
  const { data: document, error: documentError } = await db.from("documents").select("id, reference, object_key, storage_bucket, mime_type, size_bytes, checksum_verified, scan_status, actual_mime_type, actual_size_bytes").eq("reference", documentRef).maybeSingle();
  if (documentError !== null) return { kind: "transient", error: documentError.message };
  if (!document) return { kind: "permanent", error: `document ${documentRef} not found` };
  if (document.scan_status === "ready" || document.scan_status === "clean") return { kind: "delivered", providerIds: [document.reference] };
  let stat;
  try {
    stat = await storage.stat({ bucket: document.storage_bucket, objectKey: document.object_key });
  } catch (error) {
    return { kind: "transient", error: error instanceof Error ? error.message : "storage stat failed" };
  }
  /* The browser finalize boundary may already have attested the stored bytes
   * (checksum + actual MIME). Re-finalising in that case is redundant, and a
   * magic-byte detector that cannot see the declared type (for example a CSV)
   * would fail a record that is already verified. Trust the stored attestation
   * and only finalize when the document is not yet verified. */
  const alreadyVerified = document.checksum_verified === true && typeof document.actual_mime_type === "string" && document.actual_mime_type !== "";
  const actualMimeType = alreadyVerified ? (document.actual_mime_type as string) : detectContentType(stat.bytes);
  if (!alreadyVerified) {
    const finalized = await callAppRpc<{ status: string }>(admin, "documents_finalize_upload", {
      p_document_id: document.id,
      p_actual_mime_type: actualMimeType,
      p_actual_size: stat.sizeBytes,
      p_checksum: stat.checksumSha256,
    });
    if (finalized.error !== null) return { kind: "permanent", error: finalized.error.message };
  }
  let scanResult;
  try {
    /* The storage stat already read the authoritative bytes; pass them to the
     * provider so clamav/http never re-fetch the object. */
    scanResult = await scanner.scan({ bucket: document.storage_bucket, objectKey: document.object_key, declaredMimeType: actualMimeType, sizeBytes: stat.sizeBytes, checksumSha256: stat.checksumSha256, bytes: stat.bytes });
  } catch (error) {
    if (error instanceof ManualScanDeferredError) {
      /* Manual provider: the result arrives only through the authenticated
       * scan callback route. Record the handoff as delivered and leave the
       * document `pending_scan`; nothing here may mark it ready. A later
       * callback flips the document, and the next worker pass sees the
       * terminal scan state on the document row. */
      return { kind: "delivered", providerIds: [`manual:${document.reference}:pending_callback`] };
    }
    return { kind: "transient", error: error instanceof Error ? error.message : "document scan failed" };
  }
  const scanned = await callAppRpc<{ status: string }>(admin, "documents_apply_scan", { p_document_id: document.id, p_status: scanResult.state, p_detail: scanResult.detail ?? null });
  if (scanned.error !== null) return { kind: "transient", error: scanned.error.message };
  return { kind: "delivered", providerIds: [document.reference] };
}

export async function dispatchEvent(
  admin: SupabaseClient<Database>,
  event: OutboxEventRow,
  sender: EmailSender | undefined,
  storage: StorageProvider,
  scanner: DocumentScanner,
): Promise<DispatchOutcome> {
  if (event.kind === "content.publish") {
    const { error } = await callAppRpc<number>(admin, "content_publish_due", {});
    return error === null ? { kind: "delivered", providerIds: ["content.publish"] } : { kind: "transient", error: error.message };
  }
  if (event.kind === "content.expire") {
    const { error } = await callAppRpc<number>(admin, "content_expire_due", {});
    return error === null ? { kind: "delivered", providerIds: ["content.expire"] } : { kind: "transient", error: error.message };
  }
  if (event.kind === "content.expired") {
    // The expiry transition, audit row, and in-app projection already ran
    // with the outbox insert. There is no provider action to deliver.
    return { kind: "delivered", providerIds: ["content.expired"] };
  }
  if (event.kind === "settings.effective") {
    const { error } = await callAppRpc<number>(admin, "settings_effective_due", {});
    return error === null ? { kind: "delivered", providerIds: ["settings.effective"] } : { kind: "transient", error: error.message };
  }
  if (event.kind.startsWith("storage.") || event.kind === "document.retention") {
    return dispatchStorageEvent(admin, event, storage, scanner);
  }
  if (event.kind === "pdf.generate") {
    if (event.target_type !== "receipt" && event.target_type !== "result_report_release" && event.target_type !== "result_report_releases") return { kind: "permanent", error: `no pdf template for target type ${event.target_type}` };
    try {
      const generated = event.target_type === "receipt"
        ? await generateReceiptPdf(admin, event.target_reference)
        : await generateReportCardPdf(admin, event.target_reference);
      return await persistGeneratedPdf(admin, event, generated);
    } catch (error) {
      if (error instanceof PdfTransientError) return { kind: "transient", error: error.message };
      const message = error instanceof Error ? error.message : "unknown pdf generation error";
      return { kind: "permanent", error: message };
    }
  }
  if (event.kind === "data.export.generate" || event.kind === "data_export_generate") {
    return dispatchDataExportGenerate(admin, event, storage);
  }
  if (event.kind === "data_import_parse" || event.kind === "data.import.parse") {
    return dispatchDataImportParse(admin, event, storage);
  }
  const isEmailEvent = event.kind === "email.deliver" || event.kind.startsWith("security.") || event.event_key.startsWith("email.");
  if (!isEmailEvent) {
    return { kind: "unknown" };
  }

  let recipients: Recipient[];
  try {
    recipients = await resolveRecipients(admin, event);
  } catch (error) {
    return { kind: "transient", error: error instanceof Error ? error.message : "recipient resolution failed" };
  }

  /* No resolvable recipient with an email address (an empty audience, a
   * phone-only contact, or a page with no audience). Acknowledge the event as
   * delivered (skipped) so a clean no-op never burns provider attempts or
   * retires as failed work; the provider id keeps it visible in the outcome.
   * This includes notices: a notice fanned out to no currently-addressable
   * account is a skip, because permanently failed events have no requeue path
   * and would only create unrecoverable ops noise. */
  if (recipients.length === 0) {
    return { kind: "delivered", providerIds: [`skipped:${event.event_key}`] };
  }

  let emailSender: EmailSender;
  try {
    emailSender = sender ?? createResendSender();
  } catch (error) {
    return { kind: "transient", error: error instanceof Error ? error.message : "email provider unavailable" };
  }
  const firstRecipient = recipients[0];
  if (firstRecipient === undefined) {
    return { kind: "transient", error: "recipient resolution returned an empty set" };
  }

  const template = await renderEmail(admin, event, firstRecipient);
  if (template === null) {
    return { kind: "permanent", error: `no template for event key ${event.event_key}` };
  }

  const providerIds: string[] = [];
  let permanentFailure: string | null = null;
  let deferredDelivery = false;
  for (const recipient of recipients) {
    try {
      const delivery = await recordDelivery(admin, {
        eventId: event.id,
        eventKey: event.event_key,
        recipient,
        templateVersion: "v1",
      });
      if (delivery === null) return { kind: "transient", error: `notification delivery row unavailable for ${recipient.accountId}` };
      if (["sent", "delivered", "bounced", "complained", "suppressed"].includes(delivery.status)) {
        providerIds.push(`existing:${recipient.accountId}`);
        continue;
      }
      if (delivery.status === "failed" && delivery.failureClass === "permanent") {
        providerIds.push(`permanent-failure:${recipient.accountId}`);
        continue;
      }
      if (delivery.nextAttemptAt !== null && new Date(delivery.nextAttemptAt).getTime() > Date.now()) {
        /* The per-recipient backoff has not elapsed; this recipient still owes
         * a provider attempt. The event must stay pending so the send happens
         * once due — marking it delivered here would silently drop the mail. */
        deferredDelivery = true;
        continue;
      }

      const { data: suppressed, error: suppressionError } = await admin
        .from("email_suppressions")
        .select("reason")
        .eq("email_hash", sha256(recipient.email.toLowerCase().trim()))
        .maybeSingle();
      if (suppressionError !== null) return { kind: "transient", error: `suppression lookup failed: ${suppressionError.message}` };
      if (suppressed !== null) {
        await updateDelivery(admin, delivery.id, { status: "suppressed", lastError: `suppressed:${suppressed.reason}`, failureClass: "suppressed", attempts: delivery.attempts });
        continue;
      }

      try {
        const result = await emailSender({
          to: [recipient.email],
          subject: template.subject,
          html: template.html,
          idempotencyKey: `delivery:${delivery.id}`,
        });
        await updateDelivery(admin, delivery.id, { status: "sent", providerMessageId: result.providerMessageId, attempts: delivery.attempts + 1, failureClass: null });
        providerIds.push(result.providerMessageId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown send error";
        if (message.startsWith("Permanent")) {
          await updateDelivery(admin, delivery.id, { status: "failed", lastError: message, failureClass: "permanent", attempts: delivery.attempts + 1 });
          permanentFailure = message;
          continue;
        }
        const nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.min(delivery.attempts, 6))).toISOString();
        await updateDelivery(admin, delivery.id, { status: "failed", lastError: message, failureClass: "transient", attempts: delivery.attempts + 1, nextAttemptAt });
        return { kind: "transient", error: message };
      }
    } catch (error) {
      return { kind: "transient", error: error instanceof Error ? error.message : "delivery record write failed" };
    }
  }
  if (permanentFailure !== null) return { kind: "permanent", error: permanentFailure };
  if (deferredDelivery) return { kind: "transient", error: "email delivery backoff has not elapsed" };
  return { kind: "delivered", providerIds };
}

type ProviderJobRow = {
  id: string;
  idempotency_key: string;
  job_kind: string;
  target_type: string | null;
  target_reference: string | null;
  document_id: string | null;
};

async function processProviderJobs(input: {
  admin: SupabaseClient<Database>;
  sender?: EmailSender;
  storage: StorageProvider;
  scanner: DocumentScanner;
  batchSize: number;
}): Promise<WorkerSummary> {
  const summary: WorkerSummary = { claimed: 0, delivered: 0, permanentFailed: 0, transientFailed: 0, skippedUnknown: 0, skippedNoRecipients: 0, emailConfigMissing: false };
  const claimedResult = await callAppRpc<ProviderJobRow[]>(input.admin, "claim_provider_jobs", { p_batch_size: input.batchSize });
  if (claimedResult.error !== null) throw new Error(`provider job claim failed: ${claimedResult.error.message}`);
  for (const job of claimedResult.data ?? []) {
    summary.claimed += 1;
    const kind = job.job_kind === "storage_finalize" ? "storage.finalize"
      : job.job_kind === "storage_scan" ? "storage.scan"
        : job.job_kind === "storage_orphan_cleanup" ? "storage.orphan_cleanup"
          : job.job_kind === "document_retention" ? "document.retention"
            : job.job_kind === "pdf_generate" ? "pdf.generate"
              : job.job_kind === "email_delivery" ? "email.deliver"
                : job.job_kind === "content_publish" ? "content.publish"
                  : job.job_kind === "content_expire" ? "content.expire"
                    : job.job_kind === "settings_effective" ? "settings.effective" : job.job_kind;
    const event: OutboxEventRow = {
      id: job.id,
      event_key: job.idempotency_key,
      kind,
      target_type: job.target_type ?? "document",
      target_reference: job.target_reference ?? job.document_id ?? "",
      payload: {},
      status: "processing",
      attempts: 0,
    };
    const outcome = await dispatchEvent(input.admin, event, input.sender, input.storage, input.scanner);
    if (outcome.kind === "delivered") {
      const completed = await callAppRpc<ProviderJobRow>(input.admin, "complete_provider_job", { p_job_id: job.id, p_outcome: { providerIds: outcome.providerIds } });
      if (completed.error !== null) throw new Error(`provider job completion failed: ${completed.error.message}`);
      summary.delivered += 1;
    } else {
      const failed = await callAppRpc<ProviderJobRow>(input.admin, "fail_provider_job", { p_job_id: job.id, p_error: outcome.kind === "unknown" ? "unknown provider job kind" : outcome.error, p_permanent: outcome.kind === "permanent" || outcome.kind === "unknown" });
      if (failed.error !== null) throw new Error(`provider job failure update failed: ${failed.error.message}`);
      if (outcome.kind === "permanent") summary.permanentFailed += 1;
      else if (outcome.kind === "transient") summary.transientFailed += 1;
      else summary.skippedUnknown += 1;
    }
  }
  return summary;
}

/* ------------------------------------------------------------------ */
/* Batch processing                                                     */
/* ------------------------------------------------------------------ */

export async function processOutboxBatch(input: {
  admin: SupabaseClient<Database>;
  sender?: EmailSender;
  batchSize?: number;
  storage?: StorageProvider;
  scanner?: DocumentScanner;
}): Promise<WorkerSummary> {
  const readiness = providerEnvReadiness();
  if (input.sender === undefined && !readiness.email.ready) {
    /* Resend cannot be constructed without its environment, so claiming email
     * work would burn attempts against a sender that cannot exist. Return
     * before the claim and leave every event pending until config arrives. */
    return { claimed: 0, delivered: 0, permanentFailed: 0, transientFailed: 0, skippedUnknown: 0, skippedNoRecipients: 0, emailConfigMissing: true };
  }
  const startedAt = new Date().toISOString();
  const { data: jobRun } = await input.admin.from("job_runs").insert({ job_name: "outbox", status: "started", started_at: startedAt }).select("id").maybeSingle();
  try {
  // Recording is test-only and must be injected explicitly. Runtime provider
  // mode uses the real Resend adapter only when an email event is claimed.
  const sender = input.sender;
  const storage = input.storage ?? new SupabaseStorageProvider(input.admin);
  /* Lazy scanner: defer configuration until a storage.scan event is actually
   * claimed so email/PDF batches do not require a scanner endpoint. When a
   * scan is needed, pass the real verified input through — never empty
   * placeholder values that would make the scanner decision meaningless. */
  const scanner = input.scanner ?? {
    scan: async (scanInput: ScanInput) => {
      const configured = createConfiguredDocumentScanner();
      return configured.scan(scanInput);
    },
  };
  const batchSize = input.batchSize ?? 10;

  const { data: claimed, error } = await callAppRpc<OutboxEventRow[]>(input.admin, "claim_outbox", {
    p_batch_size: batchSize,
  });
  if (error !== null) {
    throw new Error(`outbox claim failed: ${error.message}`);
  }
  const events = claimed ?? [];

  const summary: WorkerSummary = { claimed: events.length, delivered: 0, permanentFailed: 0, transientFailed: 0, skippedUnknown: 0, skippedNoRecipients: 0, emailConfigMissing: false };

  for (const event of events) {
    const outcome = await dispatchEvent(input.admin, event, sender, storage, scanner);
    switch (outcome.kind) {
      case "delivered": {
        const { error: markError } = await callAppRpc<null>(input.admin, "mark_outbox_delivered", {
          p_event_key: event.event_key,
        });
        if (markError !== null) throw new Error(`mark delivered failed: ${markError.message}`);
        summary.delivered += 1;
        if (outcome.providerIds.some((providerId) => providerId.startsWith("skipped:"))) {
          summary.skippedNoRecipients += 1;
        }
        break;
      }
      case "permanent": {
        // Permanent provider failures remain visible as failed outbox work;
        // they are never made to look delivered.
        const { error: failError } = await callAppRpc<null>(input.admin, "fail_outbox", {
          p_event_key: event.event_key,
          p_error: outcome.error.startsWith("Permanent:") ? outcome.error : `Permanent:${outcome.error}`,
        });
        if (failError !== null) throw new Error(`fail_outbox (permanent failure) failed: ${failError.message}`);
        summary.permanentFailed += 1;
        break;
      }
      case "transient": {
        const { error: failError } = await callAppRpc<null>(input.admin, "fail_outbox", {
          p_event_key: event.event_key,
          p_error: outcome.error,
        });
        if (failError !== null) throw new Error(`fail_outbox failed: ${failError.message}`);
        summary.transientFailed += 1;
        break;
      }
      default: {
        const { error: failError } = await callAppRpc<null>(input.admin, "fail_outbox", {
          p_event_key: event.event_key,
          p_error: "unknown event kind",
        });
        if (failError !== null) throw new Error(`fail_outbox failed: ${failError.message}`);
        summary.skippedUnknown += 1;
      }
    }
  }
  const providerSummary = await processProviderJobs({ admin: input.admin, sender, storage, scanner, batchSize });
  summary.claimed += providerSummary.claimed;
  summary.delivered += providerSummary.delivered;
  summary.permanentFailed += providerSummary.permanentFailed;
  summary.transientFailed += providerSummary.transientFailed;
  summary.skippedUnknown += providerSummary.skippedUnknown;
  summary.skippedNoRecipients += providerSummary.skippedNoRecipients;
  if (jobRun?.id) await input.admin.from("job_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), outcome: summary }).eq("id", jobRun.id);
  return summary;
  } catch (error) {
    if (jobRun?.id) await input.admin.from("job_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: "Outbox worker failed." }).eq("id", jobRun.id);
    throw error;
  }
}
