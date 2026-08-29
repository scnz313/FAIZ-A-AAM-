/**
 * Fictional demo admissions data: an application in progress with its
 * full status timeline, and the staff review queue. Official data
 * arrives with the admissions backend.
 */

export const ADMISSIONS_DEMO_NOTE = "Fictional demo application — no real student data.";

export type ApplicationStatus =
  | "Draft"
  | "Submitted"
  | "Under review"
  | "Changes requested"
  | "Assessment"
  | "Offered"
  | "Waitlisted"
  | "Declined"
  | "Enrolled"
  | "Withdrawn";

export type ApplicationEvent = {
  status: ApplicationStatus;
  atIso: string;
  actor: string;
  note: string;
};

export type DemoApplication = {
  ref: string;
  session: string;
  grade: string;
  studentName: string;
  parentName: string;
  contact: string;
  submittedAtIso: string;
  currentStatus: ApplicationStatus;
  timeline: ApplicationEvent[];
  offer?: {
    grade: string;
    session: string;
    acceptByIso: string;
    admissionFeePaise: number;
    accepted: boolean;
  };
};

export const demoApplication: DemoApplication = {
  ref: "APP-2026-0417",
  session: "2026-27",
  grade: "Class 8",
  studentName: "Aarif Hussain",
  parentName: "Firdous Ahmad",
  contact: "+91 90000 00000",
  submittedAtIso: "2026-07-02T09:40:00Z",
  currentStatus: "Offered",
  timeline: [
    { status: "Submitted", atIso: "2026-07-02T09:40:00Z", actor: "Applicant", note: "Application submitted with all required documents." },
    { status: "Under review", atIso: "2026-07-05T07:10:00Z", actor: "Admissions office", note: "Documents verified; eligibility confirmed." },
    { status: "Changes requested", atIso: "2026-07-08T06:55:00Z", actor: "Admissions office", note: "Previous-school report card was unreadable — re-upload requested." },
    { status: "Under review", atIso: "2026-07-11T08:20:00Z", actor: "Applicant", note: "Report card re-uploaded; review resumed." },
    { status: "Assessment", atIso: "2026-07-14T09:00:00Z", actor: "Assessment panel", note: "Interaction with the student and guardian completed." },
    { status: "Offered", atIso: "2026-07-20T06:30:00Z", actor: "Admissions office", note: "Seat offered for Class 8, session 2026-27." },
  ],
  offer: {
    grade: "Class 8",
    session: "2026-27",
    acceptByIso: "2026-08-15T14:00:00Z",
    admissionFeePaise: 200000,
    accepted: false,
  },
};

export type StaffApplicationRow = {
  ref: string;
  studentName: string;
  grade: string;
  submittedAtIso: string;
  status: ApplicationStatus;
  reviewer: string;
  flagged?: boolean;
};

export const staffApplications: StaffApplicationRow[] = [
  { ref: "APP-2026-0417", studentName: "Aarif Hussain", grade: "Class 8", submittedAtIso: "2026-07-02T09:40:00Z", status: "Offered", reviewer: "A. Lone" },
  { ref: "APP-2026-0418", studentName: "Saima Bano", grade: "Class 6", submittedAtIso: "2026-07-03T11:15:00Z", status: "Assessment", reviewer: "A. Lone" },
  { ref: "APP-2026-0419", studentName: "Uzair Wani", grade: "Class 9", submittedAtIso: "2026-07-04T08:05:00Z", status: "Under review", reviewer: "A. Lone" },
  { ref: "APP-2026-0420", studentName: "Maryam Koul", grade: "Class 7", submittedAtIso: "2026-07-06T13:30:00Z", status: "Changes requested", reviewer: "A. Lone", flagged: true },
  { ref: "APP-2026-0421", studentName: "Rayan Dar", grade: "Class 10", submittedAtIso: "2026-07-07T10:45:00Z", status: "Under review", reviewer: "A. Lone" },
  { ref: "APP-2026-0422", studentName: "Insha Rashid", grade: "Class 6", submittedAtIso: "2026-07-09T09:20:00Z", status: "Submitted", reviewer: "—" },
  { ref: "APP-2026-0423", studentName: "Tawseef Ganie", grade: "Class 8", submittedAtIso: "2026-07-10T12:00:00Z", status: "Submitted", reviewer: "—" },
];

export const admissionsQueueCounts = {
  pendingReview: staffApplications.filter((a) => a.status === "Submitted" || a.status === "Under review").length,
  awaitingAssessment: staffApplications.filter((a) => a.status === "Assessment").length,
  offersOutstanding: staffApplications.filter((a) => a.status === "Offered").length,
  flagged: staffApplications.filter((a) => a.flagged).length,
};
