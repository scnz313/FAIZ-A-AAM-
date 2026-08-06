/**
 * Fictional concept content for the school platform frontend.
 * Every string here is demo data — no real notices, events, vacancies,
 * or policy text. Official content arrives with the CMS backend.
 */

export const CONTENT_DEMO_NOTE = "Fictional concept content — official details pending verification.";

/** Folio masthead date used across the public site and both portals. */
export const FOLIO_TODAY = "MONDAY, 3 AUGUST 2026";

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

export type NoticeCategory = "Admissions" | "Examination" | "Holiday" | "General" | "Sports" | "Environment";

export type Notice = {
  slug: string;
  category: NoticeCategory;
  title: string;
  excerpt: string;
  body: string[];
  dateIso: string;
  urgent?: boolean;
  pinned?: boolean;
};

export const notices: Notice[] = [
  {
    slug: "winter-air-quality-advisory",
    category: "Environment",
    title: "Winter air-quality advisory",
    excerpt: "On poor-air days, morning assembly moves indoors and outdoor games are modified.",
    body: [
      "During the winter months, morning air quality in the valley can cross safe limits for outdoor activity. When the courtyard sensor records a PM2.5 reading above 120 µg/m³ at assembly time, morning assembly moves to the assembly hall and outdoor games are modified to indoor activity.",
      "Families will see a notice line on the school website whenever an advisory is in force. The campus environment page shows live, clearly-marked demo readings until the real sensor fleet is installed.",
    ],
    dateIso: "2026-08-01T06:30:00Z",
    urgent: true,
    pinned: true,
  },
  {
    slug: "mid-term-exam-schedule",
    category: "Examination",
    title: "Mid-term examination schedule released",
    excerpt: "Mid-term examinations run from 1 to 10 September. The date sheet is available under Timetable.",
    body: [
      "The mid-term examination schedule for classes 6 to 10 has been released and published in the parent portal under Timetable → Exam date sheet.",
      "Examinations begin at 10:00 and end at 12:00. Students must reach school by 09:30 on examination days. A printed copy is available at the school office.",
    ],
    dateIso: "2026-07-28T09:00:00Z",
    pinned: true,
  },
  {
    slug: "admissions-open-session-2027",
    category: "Admissions",
    title: "Admissions open for session 2026-27",
    excerpt: "Applications for classes 6 to 10 are open. Apply online through the admissions centre.",
    body: [
      "Admissions for the 2026-27 session are open for classes 6 to 10. Applications are accepted online through the admissions centre; the application reference lets families track progress at every stage.",
      "The admission window, grade capacity, and application fee follow the school's confirmed policy, which is published with the admission notice when the academic calendar is finalised.",
    ],
    dateIso: "2026-07-20T05:00:00Z",
  },
  {
    slug: "annual-sports-meet",
    category: "Sports",
    title: "Annual sports meet — 15 August",
    excerpt: "The annual sports meet is scheduled for 15 August on the school ground, weather permitting.",
    body: [
      "The annual sports meet is scheduled for 15 August on the school ground, weather permitting. Events begin at 09:00 with the march-past.",
      "Families are welcome. In case of poor air quality or rain, the meet moves to the assembly hall for indoor events only.",
    ],
    dateIso: "2026-07-25T08:00:00Z",
  },
  {
    slug: "parent-teacher-meeting-class-10",
    category: "General",
    title: "Parent–teacher meeting — Class 10",
    excerpt: "A parent–teacher meeting for Class 10 is scheduled for 22 August, 10:00 to 13:00.",
    body: [
      "A parent–teacher meeting for Class 10 is scheduled for 22 August, 10:00 to 13:00. Parents may discuss progress, attendance, and the final-term preparation plan with subject teachers.",
      "Meetings are by appointment through the class teacher. Please carry the student's report card from the last term.",
    ],
    dateIso: "2026-07-22T09:30:00Z",
  },
  {
    slug: "holiday-eid-ul-adha",
    category: "Holiday",
    title: "Holiday — Eid-ul-Adha",
    excerpt: "The school remains closed on the announced dates of Eid-ul-Adha.",
    body: [
      "The school remains closed on the announced dates of Eid-ul-Adha, subject to the confirmed holiday calendar. Classes resume on the working day after the holiday.",
    ],
    dateIso: "2026-07-15T05:00:00Z",
  },
  {
    slug: "library-week",
    category: "General",
    title: "Library week — reading hour",
    excerpt: "Library week begins 3 August. Each class gets a daily reading hour.",
    body: [
      "Library week begins 3 August. Each class gets a daily reading hour in the library, and students may borrow two books instead of one for the week.",
      "The library's illuminance and CO₂ readings are monitored as part of the campus environment programme, so reading hours stay comfortable.",
    ],
    dateIso: "2026-08-01T04:00:00Z",
  },
  {
    slug: "annual-day-invitation",
    category: "General",
    title: "Annual day — save the date",
    excerpt: "The annual day programme is planned for late November. Programme details follow.",
    body: [
      "The annual day programme is planned for late November. Class-level performances, the cultural programme, and prize distribution will be announced closer to the date.",
    ],
    dateIso: "2026-07-18T10:00:00Z",
  },
];

export const noticeCategories: NoticeCategory[] = ["Admissions", "Examination", "Holiday", "General", "Sports", "Environment"];

/** Review dates for the demo notices — the CMS assigns real ones. */
export const noticeReviewDue: Record<string, string> = {
  "winter-air-quality-advisory": "2026-09-01",
  "mid-term-exam-schedule": "2026-08-15",
  "admissions-open-session-2027": "2026-08-20",
  "annual-sports-meet": "2026-08-10",
  "parent-teacher-meeting-class-10": "2026-08-22",
  "holiday-eid-ul-adha": "2026-08-05",
  "library-week": "2026-08-31",
  "annual-day-invitation": "2026-08-28",
  "annual-prize-distribution-nominations": "2026-08-28",
  "summer-workshop-registration": "2026-07-01",
};

/**
 * Staff-only demo rows that exercise the draft and expired states in the
 * staff workspaces. They are fictional concept content like the published
 * notices above; they never appear on public or portal lists.
 */
export const staffDraftNotices: Notice[] = [
  {
    slug: "annual-prize-distribution-nominations",
    category: "General",
    title: "Annual prize distribution — nominations open",
    excerpt: "Class teachers may submit student nominations for the annual prize distribution.",
    body: [
      "Nominations for the annual prize distribution are being collected from class teachers. Each class may nominate up to two students across the academic, sports, and service categories.",
      "This notice is a draft in the demo workspace — it becomes visible on the public and portal lists only when a publisher approves it.",
    ],
    dateIso: "2026-08-02T07:00:00Z",
  },
];

/**
 * Staff-only demo row that has reached its review date and expired. It stays
 * visible in the staff workspaces as an archived state and never appears on
 * public or portal lists.
 */
export const staffExpiredNotices: Notice[] = [
  {
    slug: "summer-workshop-registration",
    category: "General",
    title: "Summer workshop registration closed",
    excerpt: "Registration for the summer enrichment workshops has closed for this season.",
    body: [
      "Registration for the summer enrichment workshops has closed for this season. Workshop confirmations were shared with registered families through the portal.",
      "This notice expired on its review date and is shown in the staff workspace as an archived record.",
    ],
    dateIso: "2026-05-30T06:00:00Z",
  },
];

/* ------------------------------------------------------------------ */
/* Upcoming events                                                     */
/* ------------------------------------------------------------------ */

export type SchoolEvent = {
  dateIso: string;
  dayLabel: string;
  monthLabel: string;
  title: string;
  time: string;
  venue: string;
};

export const upcomingEvents: SchoolEvent[] = [
  { dateIso: "2026-08-03", dayLabel: "03", monthLabel: "AUG", title: "Library week begins", time: "All day", venue: "Library" },
  { dateIso: "2026-08-10", dayLabel: "10", monthLabel: "AUG", title: "Second unit tests — Class 6–10", time: "10:00", venue: "Classrooms" },
  { dateIso: "2026-08-15", dayLabel: "15", monthLabel: "AUG", title: "Annual sports meet", time: "09:00", venue: "School ground" },
  { dateIso: "2026-08-22", dayLabel: "22", monthLabel: "AUG", title: "Parent–teacher meeting — Class 10", time: "10:00", venue: "Class 10 rooms" },
  { dateIso: "2026-09-01", dayLabel: "01", monthLabel: "SEP", title: "Mid-term examinations begin", time: "10:00", venue: "All classes" },
];

/* ------------------------------------------------------------------ */
/* Vacancies and job applications                                      */
/* ------------------------------------------------------------------ */

export type Vacancy = {
  slug: string;
  title: string;
  department: string;
  location: string;
  type: "Teaching" | "Non-teaching";
  qualifications: string[];
  documents: string[];
  deadlineIso: string;
  status: "open" | "closed";
  description: string;
};

export const vacancies: Vacancy[] = [
  {
    slug: "mathematics-teacher",
    title: "Mathematics teacher — Secondary section",
    department: "Academics",
    location: "Main block",
    type: "Teaching",
    qualifications: ["B.Sc. Mathematics with B.Ed.", "Minimum two years of teaching experience", "Good spoken English and Urdu"],
    documents: ["Photograph", "Educational certificates", "Experience certificates", "Identity proof"],
    deadlineIso: "2026-08-20T14:00:00Z",
    status: "open",
    description:
      "We are looking for a mathematics teacher for classes 8 to 10. The role includes class teaching, unit test preparation, and participation in the school's examination cycle.",
  },
  {
    slug: "english-teacher",
    title: "English teacher — Middle section",
    department: "Academics",
    location: "Main block",
    type: "Teaching",
    qualifications: ["M.A. English with B.Ed.", "Experience teaching classes 6 to 8", "Familiarity with activity-based learning"],
    documents: ["Photograph", "Educational certificates", "Experience certificates", "Identity proof"],
    deadlineIso: "2026-08-25T14:00:00Z",
    status: "open",
    description:
      "We are looking for an English teacher for the middle section with a strong grounding in reading, writing, and spoken English.",
  },
  {
    slug: "laboratory-assistant",
    title: "Laboratory assistant — Physics and Chemistry",
    department: "Science",
    location: "Science block",
    type: "Non-teaching",
    qualifications: ["B.Sc. in a science subject", "Experience maintaining a school laboratory is preferred"],
    documents: ["Photograph", "Educational certificates", "Experience certificates", "Identity proof"],
    deadlineIso: "2026-07-30T14:00:00Z",
    status: "closed",
    description: "This vacancy is closed. Applications received before the deadline are under review.",
  },
];

export type JobApplicationRow = {
  ref: string;
  vacancySlug: string;
  name: string;
  submittedAtIso: string;
  status: "Submitted" | "Eligibility review" | "Shortlisted" | "Interview" | "Offered" | "Not selected";
  reviewer: string;
};

export const jobApplications: JobApplicationRow[] = [
  { ref: "JOB-2026-0112", vacancySlug: "mathematics-teacher", name: "Bilal Ahmad Mir", submittedAtIso: "2026-08-01T07:20:00Z", status: "Shortlisted", reviewer: "R. Wani" },
  { ref: "JOB-2026-0113", vacancySlug: "mathematics-teacher", name: "Irfan Rashid", submittedAtIso: "2026-08-02T11:05:00Z", status: "Eligibility review", reviewer: "R. Wani" },
  { ref: "JOB-2026-0114", vacancySlug: "english-teacher", name: "Shazia Parveen", submittedAtIso: "2026-08-02T13:40:00Z", status: "Submitted", reviewer: "—" },
  { ref: "JOB-2026-0115", vacancySlug: "english-teacher", name: "Mohsin Shah", submittedAtIso: "2026-08-03T06:15:00Z", status: "Submitted", reviewer: "—" },
  { ref: "JOB-2026-0108", vacancySlug: "laboratory-assistant", name: "Faisal Nazir", submittedAtIso: "2026-07-28T09:00:00Z", status: "Interview", reviewer: "S. Bhat" },
];

/* ------------------------------------------------------------------ */
/* Policy pages                                                        */
/* ------------------------------------------------------------------ */

export type PolicySection = { heading: string; body: string[] };

export type Policy = { title: string; updatedIso: string; sections: PolicySection[] };

export const policies: Record<"privacy" | "accessibility" | "fees-and-refunds" | "terms", Policy> = {
  privacy: {
    title: "Privacy policy",
    updatedIso: "2026-07-01",
    sections: [
      {
        heading: "What the school collects",
        body: [
          "The school collects only the information needed to run admissions, maintain student records, publish results, and manage fees: names, guardian contacts, address, prior-school details, and academic records.",
          "This page is concept copy. The final privacy notice will follow the school's confirmed policy and applicable law.",
        ],
      },
      {
        heading: "How information is used",
        body: [
          "Student and family information is used for school operations only — admission decisions, enrollment, fee statements, results, timetables, notices, and safety communication. It is never sold or used for advertising.",
        ],
      },
      {
        heading: "Retention and deletion",
        body: [
          "Submitted applications, financial entries, published results, and audit events are kept as required by policy. Families may request correction or export of their data through the school office.",
        ],
      },
    ],
  },
  accessibility: {
    title: "Accessibility statement",
    updatedIso: "2026-07-01",
    sections: [
      {
        heading: "Our target",
        body: [
          "This website targets WCAG 2.2 AA: keyboard operation, visible focus, labelled forms, readable contrast, and reduced-motion support across public pages and portals.",
        ],
      },
      {
        heading: "Reporting a problem",
        body: [
          "If a page is hard to read or operate, contact the school office or use the grievance form. We treat accessibility reports as priority issues.",
        ],
      },
    ],
  },
  "fees-and-refunds": {
    title: "Fees and refunds",
    updatedIso: "2026-07-01",
    sections: [
      {
        heading: "How fees are billed",
        body: [
          "Fees are billed per term as invoices with line items. Concessions are applied before payment. Partial payment is allowed only where the confirmed policy permits it.",
        ],
      },
      {
        heading: "Refunds",
        body: [
          "Refunds follow the school's confirmed policy and are processed by the finance office against the original payment. Refunds never erase a payment's history — the ledger records both.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of use",
    updatedIso: "2026-07-01",
    sections: [
      {
        heading: "Using the website",
        body: [
          "Public pages may be browsed freely. Portals require an account linked to a verified guardian or student record. Sharing portal credentials is not permitted.",
        ],
      },
      {
        heading: "Demo content",
        body: [
          "Until the school confirms official content, pages may display clearly-marked concept text and fictional demo data for design and testing.",
        ],
      },
    ],
  },
};
