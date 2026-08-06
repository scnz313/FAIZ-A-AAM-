/**
 * Fictional demo grievances for the staff support inbox, aligned with the
 * portal grievance form: references run GRV-2026-0101+ and the category and
 * status wording match what applicants see. Real grievances arrive with the
 * support backend.
 */

export const SUPPORT_DEMO_NOTE = "Fictional demo grievances — real requests arrive with the support backend.";

export type GrievanceCategory = "Fees" | "Results" | "Timetable" | "Documents" | "Other";

export type GrievanceStatus = "New" | "In progress" | "Resolved";

export type GrievanceResponse = {
  text: string;
  by: string;
  atIso: string;
};

export type Grievance = {
  ref: string;
  category: GrievanceCategory;
  subject: string;
  message: string;
  contactName: string;
  contactPhone: string;
  raisedAtIso: string;
  status: GrievanceStatus;
  response?: GrievanceResponse;
};

export const grievances: Grievance[] = [
  {
    ref: "GRV-2026-0101",
    category: "Fees",
    subject: "Fee receipt not received",
    message:
      "I paid the term fee on 28 July through the online payment link, but the receipt has not appeared on the portal or in email. Please confirm the payment was recorded and share the receipt.",
    contactName: "Firdous Ahmad",
    contactPhone: "+91 90000 00000",
    raisedAtIso: "2026-08-03T05:12:00Z",
    status: "New",
  },
  {
    ref: "GRV-2026-0102",
    category: "Timetable",
    subject: "Period clash on Monday mornings — Class 8",
    message:
      "On the Class 8 timetable, Monday second period lists both Mathematics and Urdu, and teachers say the room is double-booked. Please correct the sheet before the unit tests begin.",
    contactName: "Ghulam Nabi Dar",
    contactPhone: "+91 94190 01002",
    raisedAtIso: "2026-08-02T14:20:00Z",
    status: "New",
  },
  {
    ref: "GRV-2026-0103",
    category: "Results",
    subject: "Unit test 1 marks not visible in portal",
    message:
      "The results page shows no report for my son's class although the notice says unit test 1 results are published. Other parents can see theirs. Please check the publication.",
    contactName: "Rubeena Akhter",
    contactPhone: "+91 94190 01003",
    raisedAtIso: "2026-08-02T04:35:00Z",
    status: "In progress",
  },
  {
    ref: "GRV-2026-0104",
    category: "Documents",
    subject: "Transfer certificate copy needed",
    message:
      "We need a copy of the transfer certificate for admission to a new school. Please let us know how to collect a signed copy from the office.",
    contactName: "Abdul Majeed Bhat",
    contactPhone: "+91 94190 01004",
    raisedAtIso: "2026-08-01T10:05:00Z",
    status: "In progress",
  },
  {
    ref: "GRV-2026-0105",
    category: "Other",
    subject: "Bus drop point moved without notice",
    message:
      "The school bus has stopped dropping my child at the usual stop near the mosque for the last three days. No one informed us about the change. Please restore the stop or explain the arrangement.",
    contactName: "Shaheena Bano",
    contactPhone: "+91 94190 01005",
    raisedAtIso: "2026-07-31T07:45:00Z",
    status: "Resolved",
    response: {
      text: "The stop was moved temporarily because of road repairs near the mosque. The bus returns to the original stop from 4 August; a notice is also posted on the portal.",
      by: "A. Lone",
      atIso: "2026-08-01T06:30:00Z",
    },
  },
  {
    ref: "GRV-2026-0106",
    category: "Fees",
    subject: "August fee shows unpaid after counter payment",
    message:
      "My daughter's fee for August still shows unpaid in the portal, although I paid at the bank counter on 31 July and kept the acknowledgment slip. Please check the ledger and correct it.",
    contactName: "Mehbooba Bano",
    contactPhone: "+91 94190 01006",
    raisedAtIso: "2026-07-30T09:15:00Z",
    status: "Resolved",
    response: {
      text: "The ledger was corrected after verification of the counter deposit; August now shows paid and the receipt is available under Fees in the portal.",
      by: "A. Lone",
      atIso: "2026-07-31T09:20:00Z",
    },
  },
];
