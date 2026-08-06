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
<tr><td style="background:${INK};padding:20px 28px;border-radius:10px 10px 0 0"><span style="color:#ffffff;font-size:19px;letter-spacing:0.02em">Faiz Aam Secondary School</span></td></tr>
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

export function applicationSubmittedEmail(input: { applicationRef: string; parentName: string }) {
  const { appUrl } = requireAppEnv();
  return {
    subject: `Application ${input.applicationRef} received`,
    html: shell({
      eyebrow: "Admissions",
      title: "Your application has been received",
      cta: { label: "View application status", href: `${appUrl}/applicant/status?ref=${encodeURIComponent(input.applicationRef)}` },
      paragraphs: [
        `Assalamu alaikum ${escapeHtml(input.parentName)}, we have received your application <strong>${escapeHtml(input.applicationRef)}</strong> for the 2026-27 academic year.`,
        "Our admissions office will review it and you will be able to follow its progress from your portal.",
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
      cta: { label: "Respond to the offer", href: `${appUrl}/applicant/status?ref=${encodeURIComponent(input.applicationRef)}` },
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
      cta: { label: "View invoice", href: `${appUrl}/applicant/status?ref=${encodeURIComponent(input.applicationRef)}` },
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
    subject: `New timetable for ${input.className}`,
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
