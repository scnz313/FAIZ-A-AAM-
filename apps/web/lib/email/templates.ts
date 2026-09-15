/**
 * Code-owned email templates (plan.md §9: application email).
 *
 * Plain string templates with HTML escaping — no JSX, no `react-dom/server`
 * (Turbopack forbids that import in the route-handler module graph). The
 * visual shell matches the editorial system (ink navy, saffron accent,
 * serif headings).
 *
 * Content rules (plan.md §9): subjects and bodies contain no marks, fee
 * balances, medical details, or sensitive applicant information. Messages
 * link to authenticated records only.
 */

import { requireAppEnv } from "@/lib/supabase/env";

const INK = "#12263a";
const PAPER = "#faf7f2";
const SAFFRON = "#b45309";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(input: {
  eyebrow: string;
  title: string;
  paragraphs: string[];
  cta?: { label: string; href: string };
  note?: string;
}): string {
  const { appUrl } = requireAppEnv();
  const cta = input.cta
    ? `<p style="margin:26px 0 0"><a href="${escapeHtml(input.cta.href)}" style="display:inline-block;background:${SAFFRON};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:14px">${escapeHtml(input.cta.label)}</a></p>`
    : "";
  const body = input.paragraphs
    .map((paragraph) => `<p style="margin:0 0 12px">${paragraph}</p>`)
    .join("");
  return `<html lang="en"><body style="margin:0;background:${PAPER};font-family:Georgia,'Times New Roman',serif">
<table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="background:${PAPER};padding:32px 0"><tbody><tr><td align="center">
<table role="presentation" width="560" cellPadding="0" cellSpacing="0"><tbody>
<tr><td style="background:${INK};padding:20px 28px;border-radius:10px 10px 0 0"><span style="color:#ffffff;font-size:19px;letter-spacing:0.02em">Faiz E Aam Secondary School</span></td></tr>
<tr><td style="background:#ffffff;padding:32px 28px">
<p style="margin:0;color:${SAFFRON};font-size:12px;letter-spacing:0.14em;text-transform:uppercase">${escapeHtml(input.eyebrow)}</p>
<h1 style="margin:10px 0 18px;color:${INK};font-size:24px;line-height:1.25">${escapeHtml(input.title)}</h1>
<div style="color:#374151;font-size:15px;line-height:1.7">${body}</div>
${cta}
</td></tr>
<tr><td style="background:${PAPER};padding:18px 28px;border-radius:0 0 10px 10px"><p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6">${escapeHtml(input.note ?? "This message was sent by the school office. Reply from the portal's support desk for help.")}</p></td></tr>
</tbody></table>
</td></tr></tbody></table>
<p style="text-align:center;color:#9ca3af;font-size:11px;margin:10px 0 30px">${escapeHtml(appUrl.replace(/^https?:\/\//, ""))}</p>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Template functions (one per plan.md §9 event kind)                  */
/* ------------------------------------------------------------------ */

export function applicationSubmittedEmail(input: { applicationRef: string }) {
  const { appUrl } = requireAppEnv();
  return {
    subject: `Application ${input.applicationRef} received`,
    html: shell({
      eyebrow: "Admissions",
      title: "Your application has been received",
      cta: { label: "View application status", href: `${appUrl}/apply/student/${encodeURIComponent(input.applicationRef)}/status` },
      paragraphs: [
        `We have received application <strong>${escapeHtml(input.applicationRef)}</strong>.`,
        "Our admissions office will review it and you can follow its progress from the secure applicant centre.",
      ],
    }),
  };
}

export function offerExtendedEmail(input: { applicationRef: string; expiresLabel: string }) {
  const { appUrl } = requireAppEnv();
  return {
    subject: `Offer for application ${input.applicationRef}`,
    html: shell({
      eyebrow: "Admissions",
      title: "An offer has been extended",
      cta: { label: "Respond to the offer", href: `${appUrl}/apply/student/${encodeURIComponent(input.applicationRef)}/status` },
      paragraphs: [
        `Your application <strong>${escapeHtml(input.applicationRef)}</strong> has been approved and an offer is waiting for your response.`,
        `The offer remains open until ${escapeHtml(input.expiresLabel)}.`,
      ],
    }),
  };
}

export function invoiceIssuedEmail(input: { invoiceRef: string; applicationRef: string }) {
  const { appUrl } = requireAppEnv();
  return {
    subject: `Invoice ${input.invoiceRef} is ready to view`,
    html: shell({
      eyebrow: "Fees",
      title: "Your admission invoice is ready",
      cta: { label: "View invoice", href: `${appUrl}/apply/student/${encodeURIComponent(input.applicationRef)}/status` },
      paragraphs: [
        `Your invoice <strong>${escapeHtml(input.invoiceRef)}</strong> has been issued for application ${escapeHtml(input.applicationRef)}.`,
        "You can review it from the applicant portal and complete payment there.",
      ],
    }),
  };
}

export function receiptAvailableEmail(input: { receiptRef: string }) {
  const { appUrl } = requireAppEnv();
  return {
    subject: `Receipt ${input.receiptRef} is available`,
    html: shell({
      eyebrow: "Fees",
      title: "Your receipt is available",
      cta: { label: "View receipt", href: `${appUrl}/portal/receipts/${encodeURIComponent(input.receiptRef)}` },
      paragraphs: [
        `Your payment receipt <strong>${escapeHtml(input.receiptRef)}</strong> has been recorded on the family portal.`,
      ],
    }),
  };
}

export function enrollmentCompleteEmail(input: { studentRef: string }) {
  const { appUrl } = requireAppEnv();
  return {
    subject: "Enrollment complete — welcome to the family portal",
    html: shell({
      eyebrow: "Enrollment",
      title: "Enrollment is complete",
      cta: { label: "Open the family portal", href: `${appUrl}/portal` },
      paragraphs: [
        `Your child has been enrolled as student <strong>${escapeHtml(input.studentRef)}</strong>. The family portal is now ready with their timetable, notices, and fee records.`,
      ],
    }),
  };
}

export function resultsPublishedEmail(input: { term: string; subject: string }) {
  const { appUrl } = requireAppEnv();
  return {
    subject: "Results are available to view",
    html: shell({
      eyebrow: "Results",
      title: "Results have been published",
      cta: { label: "View results", href: `${appUrl}/portal/results` },
      paragraphs: [
        `${escapeHtml(input.subject)} results for the ${escapeHtml(input.term)} term have been published. Sign in to the family portal to view the official record.`,
      ],
    }),
  };
}

export function timetablePublishedEmail(input: { className: string }) {
  const { appUrl } = requireAppEnv();
  return {
    subject: "A class timetable has been updated",
    html: shell({
      eyebrow: "Timetable",
      title: "Your class timetable is updated",
      cta: { label: "View timetable", href: `${appUrl}/portal/timetable` },
      paragraphs: [
        `The published timetable for <strong>${escapeHtml(input.className)}</strong> is now available on the family portal.`,
      ],
    }),
  };
}

export function supportResponseEmail(input: { threadRef: string }) {
  const { appUrl } = requireAppEnv();
  return {
    subject: `Support update on ${input.threadRef}`,
    html: shell({
      eyebrow: "Support",
      title: "There is a new reply on your request",
      cta: { label: "Open support", href: `${appUrl}/portal/support` },
      paragraphs: [
        `Your support request <strong>${escapeHtml(input.threadRef)}</strong> has a new reply. Sign in to the portal to read it.`,
      ],
    }),
  };
}

type GenericNotificationInput = { targetRef: string; subject: string; eyebrow: string; title: string; body: string; path?: string; note?: string };

function genericNotificationEmail(input: GenericNotificationInput) {
  const { appUrl } = requireAppEnv();
  return {
    subject: input.subject,
    html: shell({
      eyebrow: input.eyebrow,
      title: input.title,
      /* A notification without a portal path is deliberately CTA-free: the
         job journey is email-only and must never point at a deleted route. */
      cta: input.path === undefined ? undefined : { label: "Open the school portal", href: `${appUrl}${input.path}` },
      note: input.note,
      paragraphs: [`${escapeHtml(input.body)} Reference: <strong>${escapeHtml(input.targetRef)}</strong>.`],
    }),
  };
}

/** Retained event templates use safe references and authenticated links only. */
export function applicationChangesRequestedEmail(input: { applicationRef: string }) {
  return genericNotificationEmail({ targetRef: input.applicationRef, subject: `Application ${input.applicationRef} needs an update`, eyebrow: "Admissions", title: "An application update is ready", body: "The admissions office has requested an update to your application", path: `/apply/student/${encodeURIComponent(input.applicationRef)}/status` });
}

export function applicationDecisionEmail(input: { applicationRef: string; decision: "waitlisted" | "declined" }) {
  return genericNotificationEmail({ targetRef: input.applicationRef, subject: `Application ${input.applicationRef} has an update`, eyebrow: "Admissions", title: "A decision is available", body: input.decision === "waitlisted" ? "Your application has been placed on the waitlist" : "A final decision is available for your application", path: `/apply/student/${encodeURIComponent(input.applicationRef)}/status` });
}

export function jobApplicationSubmittedEmail(input: { applicationRef: string }) {
  return genericNotificationEmail({
    targetRef: input.applicationRef,
    subject: `Job application ${input.applicationRef} received`,
    eyebrow: "Careers",
    title: "Your job application has been received",
    body: "Your vacancy application is now in the school recruitment queue. There is no portal to check; the school emails you whenever the status changes or a decision is recorded",
    note: "This message was sent by the school office. Reply to this email if you need help with your application.",
  });
}

export function jobApplicationStatusEmail(input: {
  applicationRef: string;
  status?: "shortlisted" | "interview" | "offered" | "not_selected";
  reason?: string | null;
}) {
  const stage: Record<string, string> = {
    shortlisted: "The school has shortlisted your application for the next stage",
    interview: "The school has invited your application to interview",
    offered: "The school has recorded an offer for your application",
    not_selected: "The school has recorded a decision on your application",
  };
  const intro = input.status !== undefined && stage[input.status] !== undefined
    ? `${stage[input.status]}. Sign-in is not required; every update arrives by email`
    : "The school has recorded a new stage for your vacancy application. Sign-in is not required; every update arrives by email";
  const reason = input.reason?.trim();
  /* A rejection must carry the recorded reason (owner requirement, 15 Sep
     2026). The decision reason is written by HR and shown to the applicant;
     internal private notes are never part of this payload. */
  const body = reason !== undefined && reason.length > 0
    ? `${intro}. The reason recorded by the school: ${reason}`
    : intro;
  return genericNotificationEmail({
    targetRef: input.applicationRef,
    subject: `Job application ${input.applicationRef} updated`,
    eyebrow: "Careers",
    title: "Your application status has changed",
    body,
    note: "This message was sent by the school office. Reply to this email if you need help with your application.",
  });
}

export function paymentStatusEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "Your school payment status is updated", eyebrow: "Fees", title: "A payment record has been updated", body: "Sign in to review the current payment and receipt status", path: "/portal/fees" });
}

export function refundStatusEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "Your school refund status is updated", eyebrow: "Fees", title: "A refund record has been updated", body: "Sign in to review the current refund status", path: "/portal/fees" });
}

export function resultCorrectionEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "A results record has been corrected", eyebrow: "Results", title: "A corrected result is available", body: "Sign in to view the latest published result version", path: "/portal/results" });
}

export function resultWithdrawnEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "A results record is temporarily unavailable", eyebrow: "Results", title: "A result publication has changed", body: "Sign in to review the current publication status", path: "/portal/results" });
}

export function resultEntryReviewEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "A result entry sheet is ready for review", eyebrow: "Results workflow", title: "Marks are awaiting review", body: "An assigned result entry sheet has a new workflow update", path: "/administrator/results" });
}

export function examDateSheetEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "An exam date sheet is available", eyebrow: "Timetable", title: "Exam dates are updated", body: "Sign in to view the published exam schedule", path: "/portal/timetable" });
}

export function timetableOverrideEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "A timetable change is available", eyebrow: "Timetable", title: "A class schedule has a change", body: "Sign in to view the date-specific timetable update", path: "/portal/timetable" });
}

export function linkStatusEmail(input: { reference: string; approved: boolean }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: input.approved ? "A family link is ready" : "A family link request was updated", eyebrow: "Family access", title: input.approved ? "A student link is now active" : "A student link request has an update", body: input.approved ? "Your linked student is now available in the family portal" : "Sign in to review the safe status of your family link request", path: "/portal" });
}

export function noticePublishedEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "A school notice is available", eyebrow: "School notice", title: "There is a new school notice", body: "Sign in to review the current notice", path: "/portal/notices" });
}

export function securityUpdateEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "Your school account security was updated", eyebrow: "Security", title: "Your account security has changed", body: "Sign in to review the current account and access status", path: "/sign-in" });
}

export function staffInvitationEmail(input: { reference: string }) {
  return genericNotificationEmail({ targetRef: input.reference, subject: "A school staff invitation is ready", eyebrow: "School account", title: "Your school invitation is ready", body: "Use the secure invitation flow to continue account setup", path: `/sign-in/invite?invitation=${encodeURIComponent(input.reference)}` });
}

export function contentNoticeEmail(input: { reference: string }) {
  return noticePublishedEmail({ reference: input.reference });
}
