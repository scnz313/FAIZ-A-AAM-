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
  staffInvitationEmail,
  supportResponseEmail,
  timetableOverrideEmail,
  timetablePublishedEmail,
} from "@/lib/email/templates";
import { callAppRpc } from "@/lib/supabase/rpc";
import { PdfTransientError, generateReceiptPdf, generateReportCardPdf, generatedObjectKey, type GeneratedPdf } from "@/lib/pdf/adapter";
import { SupabaseStorageProvider } from "@/lib/documents/providers";
import { createConfiguredDocumentScanner, detectContentType, type DocumentScanner, type StorageProvider } from "@/modules/services/document-providers";

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

export type WorkerSummary = {
  claimed: number;
  delivered: number;
  permanentFailed: number;
  transientFailed: number;
  skippedUnknown: number;
};

export type Recipient = { accountId: string; email: string };

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/* ------------------------------------------------------------------ */
/* Recipient resolution (from the record, never from caller payloads)   */
/* ------------------------------------------------------------------ */

async function ownerEmail(admin: SupabaseClient<Database>, applicationRef: string): Promise<Recipient | null> {
  const { data } = await admin
    .from("admission_applications")
    .select("owner_account_id, user_accounts(verified_contact)")
    .eq("reference", applicationRef)
    .maybeSingle();
  const contact = data?.user_accounts?.verified_contact;
  if (data === null || typeof contact !== "string" || contact.length === 0) return null;
  return { accountId: data.owner_account_id, email: contact };
}

async function guardianEmailsForStudent(admin: SupabaseClient<Database>, studentId: string): Promise<Recipient[]> {
  const { data } = await admin
    .from("guardian_student_links")
    .select("guardians(person_id, user_accounts(id, verified_contact))")
    .eq("student_id", studentId)
    .eq("status", "active");
  const recipients: Recipient[] = [];
  for (const link of data ?? []) {
    // The guardians → user_accounts embed resolves through the shared
    // person_id and may arrive as an array or a single object.
    const accounts = Array.isArray(link.guardians?.user_accounts)
      ? link.guardians.user_accounts
      : link.guardians?.user_accounts !== null && link.guardians?.user_accounts !== undefined
        ? [link.guardians.user_accounts]
        : [];
    for (const account of accounts) {
      if (typeof account.verified_contact === "string" && account.verified_contact.length > 0) {
        recipients.push({ accountId: account.id, email: account.verified_contact });
      }
    }
  }
  return recipients;
}

async function studentsInSection(admin: SupabaseClient<Database>, gradeSectionId: string): Promise<string[]> {
  const { data } = await admin
    .from("enrollments")
    .select("student_id")
    .eq("grade_section_id", gradeSectionId)
    .eq("status", "active");
  return (data ?? []).map((enrollment) => enrollment.student_id);
}

async function guardianEmailsForLink(admin: SupabaseClient<Database>, linkReference: string): Promise<Recipient[]> {
  const { data } = await admin
    .from("guardian_student_links")
    .select("guardian_id, guardians(person_id, user_accounts(id, verified_contact))")
    .eq("reference", linkReference)
    .maybeSingle();
  if (!data || data.guardians === null) return [];
  const accounts = Array.isArray(data.guardians.user_accounts)
    ? data.guardians.user_accounts
    : data.guardians.user_accounts ? [data.guardians.user_accounts] : [];
  return accounts.flatMap((account) => typeof account.verified_contact === "string" && account.verified_contact.length > 0
    ? [{ accountId: account.id, email: account.verified_contact }]
    : []);
}

async function accountEmails(admin: SupabaseClient<Database>, accountIds: string[]): Promise<Recipient[]> {
  if (accountIds.length === 0) return [];
  const { data } = await admin.from("user_accounts").select("id, verified_contact").in("id", accountIds);
  return (data ?? []).flatMap((account) => typeof account.verified_contact === "string" && account.verified_contact.length > 0
    ? [{ accountId: account.id, email: account.verified_contact }]
    : []);
}

async function staffEmailsForRoles(admin: SupabaseClient<Database>, roles: string[]): Promise<Recipient[]> {
  const { data } = await admin.from("role_grants").select("account_id, role_code").in("role_code", roles).eq("status", "active");
  return accountEmails(admin, [...new Set((data ?? []).map((grant) => grant.account_id))]);
}

async function recipientsForNotice(admin: SupabaseClient<Database>, noticeReference: string): Promise<Recipient[]> {
  const { data: notice } = await admin.from("notices").select("id").eq("reference", noticeReference).maybeSingle();
  if (!notice) return [];
  const { data: audiences } = await admin.from("notice_audiences").select("audience, role_code, academic_year_id, grade_section_id, student_id").eq("notice_id", notice.id);
  const accountIds = new Set<string>();
  for (const audience of audiences ?? []) {
    if (audience.audience === "role" && audience.role_code) {
      const roleRecipients = await staffEmailsForRoles(admin, [audience.role_code]);
      roleRecipients.forEach((recipient) => accountIds.add(recipient.accountId));
      continue;
    }
    let studentIds: string[] = [];
    if (audience.audience === "student" && audience.student_id) studentIds = [audience.student_id];
    if (audience.audience === "grade_section" && audience.grade_section_id) studentIds = await studentsInSection(admin, audience.grade_section_id);
    if (audience.audience === "academic_year" && audience.academic_year_id) {
      const { data: enrollments } = await admin.from("enrollments").select("student_id").eq("academic_year_id", audience.academic_year_id).eq("status", "active");
      studentIds = (enrollments ?? []).map((enrollment) => enrollment.student_id);
    }
    for (const studentId of studentIds) {
      for (const recipient of await guardianEmailsForStudent(admin, studentId)) accountIds.add(recipient.accountId);
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
      const { data: invoice } = await admin
        .from("invoices")
        .select("student_id, applicant_ref")
        .eq("reference", target)
        .maybeSingle();
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
      const { data: receipt } = await admin
        .from("receipts")
        .select("invoices(reference)")
        .eq("reference", target)
        .maybeSingle();
      if (receipt?.invoices?.reference !== undefined && receipt.invoices.reference !== null) {
        recipients.push(...(await resolveRecipients(admin, { ...event, target_type: "invoice", target_reference: receipt.invoices.reference })));
      }
      break;
    }
    case "refund_request":
    case "refund_requests": {
      const { data: refund } = await admin
        .from("refund_requests")
        .select("payments(payment_allocations(invoices(reference)))")
        .eq("reference", target)
        .maybeSingle();
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
      const { data: support } = await admin.from("support_requests").select("requester_account_id, assignee_account_id").eq("reference", target).maybeSingle();
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
      const { data: enrollment } = await enrollmentQuery.maybeSingle();
      if (enrollment !== null) recipients.push(...(await guardianEmailsForStudent(admin, enrollment.student_id)));
      break;
    }
    case "student":
    case "students": {
      const { data: student } = await admin.from("students").select("id").eq("reference", target).maybeSingle();
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
      const { data } = await admin.from("job_applications").select("owner_account_id").eq("reference", target).maybeSingle();
      if (data) recipients.push(...(await accountEmails(admin, [data.owner_account_id])));
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
      const { data } = await admin.from("account_invitations").select("account_id, created_by_account_id").eq("reference", target).maybeSingle();
      const accountIds = [data?.account_id, data?.created_by_account_id].filter((id): id is string => typeof id === "string");
      recipients.push(...(await accountEmails(admin, accountIds)));
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
      const { data } = await db.from("result_report_releases").select("student_id").eq("reference", target).maybeSingle();
      if (data) recipients.push(...(await guardianEmailsForStudent(admin, data.student_id)));
      break;
    }
    case "exam_schedule_version": {
      const { data } = await admin.from("exam_schedule_versions").select("grade_section_id").eq("reference", target).maybeSingle();
      if (data) for (const studentId of await studentsInSection(admin, data.grade_section_id)) recipients.push(...(await guardianEmailsForStudent(admin, studentId)));
      break;
    }
    case "timetable_override": {
      const { data } = await db.from("timetable_overrides").select("grade_section_id").eq("reference", target).maybeSingle();
      if (data) for (const studentId of await studentsInSection(admin, data.grade_section_id)) recipients.push(...(await guardianEmailsForStudent(admin, studentId)));
      break;
    }
    case "result_publication": {
      const { data: publication } = await db
        .from("result_publications")
        .select("batch_id, source_entry_sheet_id, result_batches(grade_section_id), result_entry_sheets(grade_section_id)")
        .eq("reference", target)
        .maybeSingle();
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
      const { data: publication } = await admin
        .from("timetable_publications")
        .select("timetable_versions(grade_section_id)")
        .eq("reference", target)
        .maybeSingle();
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
  if (key.startsWith("email.job_offer") || key.startsWith("email.job_status")) return jobApplicationStatusEmail({ applicationRef: target });
  if (key.startsWith("email.payment") || key.startsWith("email.finance")) return paymentStatusEmail({ reference: target });
  if (key.startsWith("email.refund")) return refundStatusEmail({ reference: target });
  if (key.startsWith("email.results_published")) {
    const { data } = await admin
      .from("result_publications")
      .select("result_batches(exam_definitions(term), subjects(name))")
      .eq("reference", target)
      .maybeSingle();
    return resultsPublishedEmail({
      term: data?.result_batches?.exam_definitions?.term ?? "recent",
      subject: data?.result_batches?.subjects?.name ?? "subject",
    });
  }
  if (key.startsWith("email.result_publication") || key.startsWith("email.result_report_release")) return resultsPublishedEmail({ term: "published", subject: "school" });
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
  if (key.startsWith("email.staff_invitation")) return staffInvitationEmail({ reference: target });
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
  const { data, error } = await admin
    .from("notification_deliveries")
    .upsert(
      {
        event_id: input.eventId,
        recipient_account_id: input.recipient.accountId,
        channel: "email",
        template_version: input.templateVersion,
        status: "pending",
        attempts: 0,
      },
      { onConflict: "event_id,recipient_account_id,channel,template_version", ignoreDuplicates: true },
  )
    .select("id")
    .single();
  if (error === null && data !== null) return { id: data.id, status: "pending", attempts: 0, nextAttemptAt: null, failureClass: null };
  // A duplicate upsert can surface as an empty representation (or a
  // provider-specific conflict code). Always resolve the existing row by its
  // unique tuple rather than treating it as already processed.
  const db = admin as unknown as SupabaseClient;
  const { data: existing, error: existingError } = await db
    .from("notification_deliveries")
    .select("id, status, attempts, next_attempt_at, failure_class")
    .eq("event_id", input.eventId)
    .eq("recipient_account_id", input.recipient.accountId)
    .eq("channel", "email")
    .eq("template_version", input.templateVersion)
    .maybeSingle();
  if (existingError !== null || existing === null) return null;
  return { id: existing.id, status: existing.status, attempts: existing.attempts, nextAttemptAt: existing.next_attempt_at, failureClass: existing.failure_class };
}

async function updateDelivery(
  admin: SupabaseClient<Database>,
  deliveryId: string,
  update: { status: string; providerMessageId?: string | null; lastError?: string | null; failureClass?: string | null; attempts: number; nextAttemptAt?: string | null },
) {
  const db = admin as unknown as SupabaseClient;
  await db
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
  const { data: document, error: documentError } = await db.from("documents").select("id, reference, object_key, storage_bucket, mime_type, size_bytes, checksum_verified, scan_status").eq("reference", documentRef).maybeSingle();
  if (documentError !== null) return { kind: "transient", error: documentError.message };
  if (!document) return { kind: "permanent", error: `document ${documentRef} not found` };
  if (document.scan_status === "ready" || document.scan_status === "clean") return { kind: "delivered", providerIds: [document.reference] };
  let stat;
  try {
    stat = await storage.stat({ bucket: document.storage_bucket, objectKey: document.object_key });
  } catch (error) {
    return { kind: "transient", error: error instanceof Error ? error.message : "storage stat failed" };
  }
  const actualMimeType = detectContentType(stat.bytes);
  const finalized = await callAppRpc<{ status: string }>(admin, "documents_finalize_upload", {
    p_document_id: document.id,
    p_actual_mime_type: actualMimeType,
    p_actual_size: stat.sizeBytes,
    p_checksum: stat.checksumSha256,
  });
  if (finalized.error !== null) return { kind: "permanent", error: finalized.error.message };
  let scanResult;
  try {
    scanResult = await scanner.scan({ bucket: document.storage_bucket, objectKey: document.object_key, declaredMimeType: actualMimeType, sizeBytes: stat.sizeBytes, checksumSha256: stat.checksumSha256 });
  } catch (error) {
    return { kind: "transient", error: error instanceof Error ? error.message : "document scan failed" };
  }
  const scanned = await callAppRpc<{ status: string }>(admin, "documents_apply_scan", { p_document_id: document.id, p_status: scanResult.state, p_detail: scanResult.detail ?? null });
  if (scanned.error !== null) return { kind: "transient", error: scanned.error.message };
  return { kind: "delivered", providerIds: [document.reference] };
}

async function dispatchEvent(
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
  const isEmailEvent = event.kind === "email.deliver" || event.kind.startsWith("security.") || event.event_key.startsWith("email.");
  if (!isEmailEvent) {
    return { kind: "unknown" };
  }

  let emailSender: EmailSender;
  try {
    emailSender = sender ?? createResendSender();
  } catch (error) {
    return { kind: "transient", error: error instanceof Error ? error.message : "email provider unavailable" };
  }
  const recipients = await resolveRecipients(admin, event);
  if (recipients.length === 0) {
    return { kind: "permanent", error: `no verified recipients for ${event.target_type} ${event.target_reference}` };
  }
  const firstRecipient = recipients[0];
  if (firstRecipient === undefined) {
    return { kind: "permanent", error: "no recipients" };
  }

  const template = await renderEmail(admin, event, firstRecipient);
  if (template === null) {
    return { kind: "permanent", error: `no template for event key ${event.event_key}` };
  }

  const providerIds: string[] = [];
  let permanentFailure: string | null = null;
  for (const recipient of recipients) {
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
    if (delivery.nextAttemptAt !== null && new Date(delivery.nextAttemptAt).getTime() > Date.now()) continue;

    const { data: suppressed } = await admin
      .from("email_suppressions")
      .select("reason")
      .eq("email_hash", sha256(recipient.email.toLowerCase().trim()))
      .maybeSingle();
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
  }
  if (permanentFailure !== null) return { kind: "permanent", error: permanentFailure };
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
  const summary: WorkerSummary = { claimed: 0, delivered: 0, permanentFailed: 0, transientFailed: 0, skippedUnknown: 0 };
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
    scan: async (scanInput: { bucket: string; objectKey: string; declaredMimeType: string; sizeBytes: number; checksumSha256: string }) => {
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

  const summary: WorkerSummary = { claimed: events.length, delivered: 0, permanentFailed: 0, transientFailed: 0, skippedUnknown: 0 };

  for (const event of events) {
    const outcome = await dispatchEvent(input.admin, event, sender, storage, scanner);
    switch (outcome.kind) {
      case "delivered": {
        const { error: markError } = await callAppRpc<null>(input.admin, "mark_outbox_delivered", {
          p_event_key: event.event_key,
        });
        if (markError !== null) throw new Error(`mark delivered failed: ${markError.message}`);
        summary.delivered += 1;
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
  if (jobRun?.id) await input.admin.from("job_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), outcome: summary }).eq("id", jobRun.id);
  return summary;
  } catch (error) {
    if (jobRun?.id) await input.admin.from("job_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: "Outbox worker failed." }).eq("id", jobRun.id);
    throw error;
  }
}
