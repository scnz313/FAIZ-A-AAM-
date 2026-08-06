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
 *   (plan.md §8) — a permanent delivery failure marks the event delivered and
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
import { createRecordingSender, type EmailSender } from "@/lib/email/resend";
import {
  applicationSubmittedEmail,
  enrollmentCompleteEmail,
  invoiceIssuedEmail,
  offerExtendedEmail,
  receiptAvailableEmail,
  resultsPublishedEmail,
  supportResponseEmail,
  timetablePublishedEmail,
} from "@/lib/email/templates";
import { callAppRpc } from "@/lib/supabase/rpc";

export type OutboxEventRow = {
  id: string;
  event_key: string;
  kind: string;
  target_type: string;
  target_reference: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
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

async function resolveRecipients(
  admin: SupabaseClient<Database>,
  event: OutboxEventRow,
): Promise<Recipient[]> {
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
    case "enrollment": {
      const { data: enrollment } = await admin
        .from("enrollments")
        .select("student_id")
        .eq("id", target)
        .maybeSingle();
      if (enrollment !== null) recipients.push(...(await guardianEmailsForStudent(admin, enrollment.student_id)));
      break;
    }
    case "result_publication": {
      const { data: publication } = await admin
        .from("result_publications")
        .select("result_batches(grade_section_id)")
        .eq("reference", target)
        .maybeSingle();
      if (publication?.result_batches?.grade_section_id !== undefined && publication.result_batches.grade_section_id !== null) {
        const studentIds = await studentsInSection(admin, publication.result_batches.grade_section_id);
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

async function renderEmail(admin: SupabaseClient<Database>, event: OutboxEventRow, recipient: Recipient) {
  const key = event.event_key;
  const target = event.target_reference;
  if (key.startsWith("email.application_submitted")) {
    const { data } = await admin.from("admission_applications").select("parent_name").eq("reference", target).maybeSingle();
    return applicationSubmittedEmail({ applicationRef: target, parentName: data?.parent_name ?? "Guardian" });
  }
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
    return invoiceIssuedEmail({ invoiceRef: target, applicationRef: event.payload.applicationRef as string ?? "" });
  }
  if (key.startsWith("email.receipt")) {
    return receiptAvailableEmail({ receiptRef: target });
  }
  if (key.startsWith("email.enrollment_complete")) {
    const { data } = await admin
      .from("enrollment_conversions")
      .select("students(reference)")
      .eq("application_id", (await admin.from("admission_applications").select("id").eq("reference", target).maybeSingle()).data?.id ?? "")
      .maybeSingle();
    return enrollmentCompleteEmail({ studentRef: data?.students?.reference ?? "your child" });
  }
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
  if (key.startsWith("email.support")) {
    return supportResponseEmail({ threadRef: target });
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Delivery row tracking                                                */
/* ------------------------------------------------------------------ */

async function recordDelivery(
  admin: SupabaseClient<Database>,
  input: { eventId: string; eventKey: string; recipient: Recipient; templateVersion: string },
): Promise<{ id: string } | null> {
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
  if (error !== null) return null;
  return data;
}

async function updateDelivery(
  admin: SupabaseClient<Database>,
  deliveryId: string,
  update: { status: string; providerMessageId?: string | null; lastError?: string | null; attempts?: number },
) {
  await admin
    .from("notification_deliveries")
    .update({
      status: update.status,
      provider_message_id: update.providerMessageId ?? null,
      last_error: update.lastError ?? null,
      attempts: update.attempts ?? 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                             */
/* ------------------------------------------------------------------ */

type DispatchOutcome =
  | { kind: "delivered"; providerIds: string[] }
  | { kind: "permanent"; error: string }
  | { kind: "transient"; error: string }
  | { kind: "unknown" };

async function dispatchEvent(
  admin: SupabaseClient<Database>,
  event: OutboxEventRow,
  sender: EmailSender,
): Promise<DispatchOutcome> {
  if (event.kind === "pdf.generate") {
    const { error } = await admin.from("document_processing_events").insert({
      event_type: "generation_requested",
      detail: `outbox ${event.event_key} — PDF adapter is a future provider boundary (plan.md §6.12)`,
    });
    // Receipt/report PDFs are queued against the provider once the PDF
    // adapter exists; the job state is recorded so ops can see the request.
    if (error !== null) return { kind: "permanent", error: `pdf job record failed: ${error.message}` };
    return { kind: "delivered", providerIds: [] };
  }
  if (event.kind !== "email.deliver") {
    return { kind: "unknown" };
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
  for (const recipient of recipients) {
    const delivery = await recordDelivery(admin, {
      eventId: event.id,
      eventKey: event.event_key,
      recipient,
      templateVersion: "v1",
    });
    if (delivery === null) {
      // The unique constraint may already hold a row from a previous run;
      // treat as processed for this recipient.
      providerIds.push(`existing:${recipient.accountId}`);
      continue;
    }

    const { data: suppressed } = await admin
      .from("email_suppressions")
      .select("reason")
      .eq("email_hash", sha256(recipient.email.toLowerCase().trim()))
      .maybeSingle();
    if (suppressed !== null) {
      await updateDelivery(admin, delivery.id, { status: "failed", lastError: `suppressed:${suppressed.reason}` });
      continue;
    }

    try {
      const result = await sender({
        to: [recipient.email],
        subject: template.subject,
        html: template.html,
        idempotencyKey: `delivery:${delivery.id}`,
      });
      await updateDelivery(admin, delivery.id, { status: "sent", providerMessageId: result.providerMessageId });
      providerIds.push(result.providerMessageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown send error";
      if (message.startsWith("Permanent")) {
        await updateDelivery(admin, delivery.id, { status: "failed", lastError: message });
        continue;
      }
      await updateDelivery(admin, delivery.id, { status: "failed", lastError: message });
      return { kind: "transient", error: message };
    }
  }
  return { kind: "delivered", providerIds };
}

/* ------------------------------------------------------------------ */
/* Batch processing                                                     */
/* ------------------------------------------------------------------ */

export async function processOutboxBatch(input: {
  admin: SupabaseClient<Database>;
  sender?: EmailSender;
  batchSize?: number;
}): Promise<WorkerSummary> {
  const sender = input.sender ?? createRecordingSender();
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
    const outcome = await dispatchEvent(input.admin, event, sender);
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
        // Domain success is never rolled back because delivery failed; the
        // failure is recorded on the delivery row for ops review.
        const { error: markError } = await callAppRpc<null>(input.admin, "mark_outbox_delivered", {
          p_event_key: event.event_key,
        });
        if (markError !== null) throw new Error(`mark delivered (permanent failure) failed: ${markError.message}`);
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
  return summary;
}
