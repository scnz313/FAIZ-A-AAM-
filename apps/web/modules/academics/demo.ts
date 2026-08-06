/**
 * Fictional demo academics data: terms, marks, timetable, and exam date
 * sheet for the linked demo student (Class 8-A). Official data arrives
 * with the results/timetable backend.
 */

export const ACADEMICS_DEMO_NOTE = "Fictional demo academic data.";

/* ------------------------------------------------------------------ */
/* Terms and results                                                   */
/* ------------------------------------------------------------------ */

export type Term = {
  id: string;
  label: string;
  publicationStatus: "final" | "provisional" | "not-published";
  publishedAtIso?: string;
  version?: number;
};

export const terms: Term[] = [
  { id: "term-1", label: "Term 1", publicationStatus: "final", publishedAtIso: "2026-06-15T06:00:00Z", version: 2 },
  { id: "term-2", label: "Term 2", publicationStatus: "final", publishedAtIso: "2026-07-20T06:00:00Z", version: 1 },
  { id: "term-3", label: "Term 3", publicationStatus: "not-published" },
];

export type SubjectMark = {
  subject: string;
  max: number;
  obtained: number;
  grade: "A" | "B" | "C" | "D";
  remark: string;
  attendancePct: number;
};

export const marksByTerm: Record<string, SubjectMark[]> = {
  "Term 1": [
    { subject: "English", max: 100, obtained: 84, grade: "A", remark: "Clear expression; keep reading widely.", attendancePct: 96 },
    { subject: "Urdu", max: 100, obtained: 91, grade: "A", remark: "Excellent — handwriting praised by examiner.", attendancePct: 96 },
    { subject: "Kashmiri", max: 100, obtained: 88, grade: "A", remark: "Confident in oral work.", attendancePct: 96 },
    { subject: "Mathematics", max: 100, obtained: 76, grade: "B", remark: "Good; revise mensuration.", attendancePct: 96 },
    { subject: "Science", max: 100, obtained: 82, grade: "A", remark: "Lab work neat and careful.", attendancePct: 96 },
    { subject: "Social Science", max: 100, obtained: 79, grade: "B", remark: "Map work needs practice.", attendancePct: 96 },
    { subject: "Computer Science", max: 100, obtained: 93, grade: "A", remark: "Outstanding class participation.", attendancePct: 96 },
  ],
  "Term 2": [
    { subject: "English", max: 100, obtained: 86, grade: "A", remark: "Improving steadily.", attendancePct: 94 },
    { subject: "Urdu", max: 100, obtained: 90, grade: "A", remark: "Consistently strong.", attendancePct: 94 },
    { subject: "Kashmiri", max: 100, obtained: 87, grade: "A", remark: "Good recall of poems.", attendancePct: 94 },
    { subject: "Mathematics", max: 100, obtained: 81, grade: "A", remark: "Mensuration much improved.", attendancePct: 94 },
    { subject: "Science", max: 100, obtained: 84, grade: "A", remark: "Neat practical records.", attendancePct: 94 },
    { subject: "Social Science", max: 100, obtained: 77, grade: "B", remark: "Map work improved.", attendancePct: 94 },
    { subject: "Computer Science", max: 100, obtained: 94, grade: "A", remark: "Excellent project work.", attendancePct: 94 },
  ],
};

/* ------------------------------------------------------------------ */
/* Per-student published result snapshots                               */
/* ------------------------------------------------------------------ */

/**
 * Published per-student result snapshots, keyed by student ID (the stable
 * IDs from the relationships fixture) and academic year. The portal renders
 * marks from these snapshots only — never from a separate term fixture.
 * Aarif's rows are seeded to match `marksByTerm` exactly; Mariam's rows are
 * a distinct fictional snapshot over the same subjects and maxima so the
 * per-student snapshot boundary is visible. The results backend replaces
 * this fixture wholesale.
 */
export const studentResultSnapshots: Record<
  string,
  { academicYearId: string; terms: Record<string, SubjectMark[]> }
> = {
  /* Aarif Hussain (STU-2026-0901) — identical values to the marks fixture. */
  "00000000-0000-4000-8000-000000000901": {
    academicYearId: "00000000-0000-4000-8000-000000000602",
    terms: {
      "Term 1": (marksByTerm["Term 1"] ?? []).map((mark) => ({ ...mark })),
      "Term 2": (marksByTerm["Term 2"] ?? []).map((mark) => ({ ...mark })),
    },
  },
  /* Mariam Hussain (STU-2026-0902) — distinct fictional values. */
  "00000000-0000-4000-8000-000000000902": {
    academicYearId: "00000000-0000-4000-8000-000000000602",
    terms: {
      "Term 1": [
        { subject: "English", max: 100, obtained: 78, grade: "B", remark: "Solid comprehension; more fluency needed in writing.", attendancePct: 95 },
        { subject: "Urdu", max: 100, obtained: 84, grade: "A", remark: "Good; watch the spelling of Urdu idioms.", attendancePct: 95 },
        { subject: "Kashmiri", max: 100, obtained: 82, grade: "A", remark: "Pleasant reading; confidence growing.", attendancePct: 95 },
        { subject: "Mathematics", max: 100, obtained: 71, grade: "B", remark: "Sound; practise geometry proofs.", attendancePct: 95 },
        { subject: "Science", max: 100, obtained: 79, grade: "B", remark: "Careful observations; neat records.", attendancePct: 95 },
        { subject: "Social Science", max: 100, obtained: 74, grade: "B", remark: "Revise map locations for Term 2.", attendancePct: 95 },
        { subject: "Computer Science", max: 100, obtained: 88, grade: "A", remark: "Consistent work; tidy project files.", attendancePct: 95 },
      ],
      "Term 2": [
        { subject: "English", max: 100, obtained: 81, grade: "A", remark: "Improved writing — steady progress.", attendancePct: 95 },
        { subject: "Urdu", max: 100, obtained: 86, grade: "A", remark: "Strong grammar and reading.", attendancePct: 95 },
        { subject: "Kashmiri", max: 100, obtained: 83, grade: "A", remark: "Good grasp of poetry.", attendancePct: 95 },
        { subject: "Mathematics", max: 100, obtained: 76, grade: "B", remark: "Geometry improved; keep practising.", attendancePct: 95 },
        { subject: "Science", max: 100, obtained: 80, grade: "A", remark: "Good practical work.", attendancePct: 95 },
        { subject: "Social Science", max: 100, obtained: 72, grade: "B", remark: "Map work needs practice.", attendancePct: 95 },
        { subject: "Computer Science", max: 100, obtained: 90, grade: "A", remark: "Excellent project work.", attendancePct: 95 },
      ],
    },
  },
};

/* ------------------------------------------------------------------ */
/* Publications and result batches                                      */
/* ------------------------------------------------------------------ */

export type Publication = {
  ref: string;
  term: string;
  status: "final" | "provisional";
  publishedAtIso: string;
  version: number;
  /** Why a later version exists — shown on the published report. */
  correctionNote?: string;
};

export const publications: Publication[] = [
  {
    ref: "PUB-2026-001",
    term: "Term 1",
    status: "final",
    publishedAtIso: "2026-06-15T06:00:00Z",
    version: 2,
    correctionNote: "v2 corrects the Term 1 Urdu grade — earlier versions remain on record.",
  },
  {
    ref: "PUB-2026-002",
    term: "Term 2",
    status: "final",
    publishedAtIso: "2026-07-20T06:00:00Z",
    version: 1,
  },
];

export type ResultBatchStatus = "entry" | "moderation" | "approved" | "published" | "correction";

/** Shared status labels and tones for result batches (single source of truth). */
export const BATCH_STATUS_META: Record<ResultBatchStatus, { label: string; tone: "good" | "watch" | "alert" | "neutral" }> = {
  entry: { label: "Entry", tone: "neutral" },
  moderation: { label: "Moderation", tone: "watch" },
  approved: { label: "Approved", tone: "good" },
  published: { label: "Published", tone: "good" },
  correction: { label: "Correction", tone: "alert" },
};

export type ResultBatch = {
  ref: string;
  exam: string;
  className: string;
  /** The sheet's subject — teacher entry scope matches class AND subject. */
  subject: string;
  status: ResultBatchStatus;
  marksEntered: number;
  totalMarks: number;
  publishedAtIso?: string;
  version?: number;
  /** Version note shown under the row, e.g. a queued correction. */
  note?: string;
};

/** Demo batch queue — fictional batches for the examination office. */
export const resultBatches: ResultBatch[] = [
  {
    ref: "RB-2026-0138",
    exam: "Term 1",
    className: "8-A",
    subject: "Mathematics",
    status: "published",
    marksEntered: 42,
    totalMarks: 42,
    publishedAtIso: "2026-06-15T06:00:00Z",
    version: 1,
  },
  {
    ref: "RB-2026-0139",
    exam: "Term 1",
    className: "9-A",
    subject: "General Science",
    status: "moderation",
    marksEntered: 41,
    totalMarks: 42,
  },
  {
    ref: "RB-2026-0140",
    exam: "Term 1",
    className: "10-B",
    subject: "English",
    status: "correction",
    marksEntered: 42,
    totalMarks: 42,
    publishedAtIso: "2026-06-15T06:00:00Z",
    version: 2,
    note: "Correction v2 under moderation — v1 published 15 Jun 2026.",
  },
  {
    ref: "RB-2026-0141",
    exam: "Term 2",
    className: "6-A",
    subject: "Mathematics",
    status: "entry",
    marksEntered: 38,
    totalMarks: 42,
  },
  {
    ref: "RB-2026-0142",
    exam: "Term 2",
    className: "7-B",
    subject: "General Science",
    status: "approved",
    marksEntered: 42,
    totalMarks: 42,
    version: 2,
  },
  {
    ref: "RB-2026-0143",
    exam: "Term 2",
    className: "8-A",
    subject: "General Science",
    status: "entry",
    marksEntered: 38,
    totalMarks: 42,
  },
  {
    ref: "RB-2026-0144",
    exam: "Term 2",
    className: "8-A",
    subject: "Mathematics",
    status: "entry",
    marksEntered: 38,
    totalMarks: 42,
  },
];

export type BatchVersion = {
  version: number;
  note: string;
  atIso: string;
  by: string;
};

/** Version history for corrected batches, newest first. */
export const batchVersions: Record<string, BatchVersion[]> = {
  "RB-2026-0142": [
    { version: 2, note: "Urdu grade corrected after review", atIso: "2026-07-22T07:15:00Z", by: "S. Bhat" },
    { version: 1, note: "Initial entry", atIso: "2026-07-20T10:00:00Z", by: "M. Wani" },
  ],
};

/* ------------------------------------------------------------------ */
/* Timetable (Class 8-A)                                               */
/* ------------------------------------------------------------------ */

export type Period = {
  time: string;
  subject: string;
  teacher: string;
  room: string;
  kind?: "class" | "break" | "assembly";
  change?: boolean;
};

const CLASS = "8-A";

export const timetableByDay: Record<string, Period[]> = {
  Monday: [
    { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
    { time: "08:45", subject: "Mathematics", teacher: "M. Wani", room: `Room 21 · ${CLASS}` },
    { time: "09:30", subject: "English", teacher: "R. Mir", room: `Room 21 · ${CLASS}` },
    { time: "10:15", subject: "Urdu", teacher: "S. Bhat", room: `Room 21 · ${CLASS}`, change: true },
    { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
    { time: "11:15", subject: "Science", teacher: "K. Dar", room: "Lab 1" },
    { time: "12:00", subject: "Kashmiri", teacher: "N. Lone", room: `Room 21 · ${CLASS}` },
    { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
    { time: "13:30", subject: "Social Science", teacher: "F. Ahmad", room: `Room 21 · ${CLASS}` },
    { time: "14:15", subject: "Computer Science", teacher: "A. Gani", room: "Computer lab" },
  ],
  Tuesday: [
    { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
    { time: "08:45", subject: "English", teacher: "R. Mir", room: `Room 21 · ${CLASS}` },
    { time: "09:30", subject: "Mathematics", teacher: "M. Wani", room: `Room 21 · ${CLASS}` },
    { time: "10:15", subject: "Science", teacher: "K. Dar", room: "Lab 1" },
    { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
    { time: "11:15", subject: "Social Science", teacher: "F. Ahmad", room: `Room 21 · ${CLASS}` },
    { time: "12:00", subject: "Urdu", teacher: "S. Bhat", room: `Room 21 · ${CLASS}` },
    { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
    { time: "13:30", subject: "Computer Science", teacher: "A. Gani", room: "Computer lab" },
    { time: "14:15", subject: "Physical education", teacher: "T. Waza", room: "Ground" },
  ],
  Wednesday: [
    { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
    { time: "08:45", subject: "Kashmiri", teacher: "N. Lone", room: `Room 21 · ${CLASS}` },
    { time: "09:30", subject: "Mathematics", teacher: "M. Wani", room: `Room 21 · ${CLASS}` },
    { time: "10:15", subject: "English", teacher: "R. Mir", room: `Room 21 · ${CLASS}` },
    { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
    { time: "11:15", subject: "Science", teacher: "K. Dar", room: `Room 21 · ${CLASS}` },
    { time: "12:00", subject: "Library hour", teacher: "Librarian", room: "Library" },
    { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
    { time: "13:30", subject: "Social Science", teacher: "F. Ahmad", room: `Room 21 · ${CLASS}` },
    { time: "14:15", subject: "Urdu", teacher: "S. Bhat", room: `Room 21 · ${CLASS}` },
  ],
  Thursday: [
    { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
    { time: "08:45", subject: "Science", teacher: "K. Dar", room: "Lab 1" },
    { time: "09:30", subject: "English", teacher: "R. Mir", room: `Room 21 · ${CLASS}` },
    { time: "10:15", subject: "Mathematics", teacher: "M. Wani", room: `Room 21 · ${CLASS}` },
    { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
    { time: "11:15", subject: "Urdu", teacher: "S. Bhat", room: `Room 21 · ${CLASS}` },
    { time: "12:00", subject: "Kashmiri", teacher: "N. Lone", room: `Room 21 · ${CLASS}` },
    { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
    { time: "13:30", subject: "Computer Science", teacher: "A. Gani", room: "Computer lab" },
    { time: "14:15", subject: "Art & craft", teacher: "R. Parveen", room: "Art room" },
  ],
  Friday: [
    { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
    { time: "08:45", subject: "Mathematics", teacher: "M. Wani", room: `Room 21 · ${CLASS}` },
    { time: "09:30", subject: "Urdu", teacher: "S. Bhat", room: `Room 21 · ${CLASS}` },
    { time: "10:15", subject: "Science", teacher: "K. Dar", room: `Room 21 · ${CLASS}` },
    { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
    { time: "11:15", subject: "Social Science", teacher: "F. Ahmad", room: `Room 21 · ${CLASS}` },
    { time: "12:00", subject: "English", teacher: "R. Mir", room: `Room 21 · ${CLASS}` },
    { time: "12:45", subject: "Lunch", teacher: "—", room: "Dining hall", kind: "break" },
    { time: "13:30", subject: "Sports period", teacher: "T. Waza", room: "Ground" },
    { time: "14:15", subject: "Library hour", teacher: "Librarian", room: "Library" },
  ],
  Saturday: [
    { time: "08:30", subject: "Morning assembly", teacher: "All staff", room: "Ground", kind: "assembly" },
    { time: "08:45", subject: "Remedial — Mathematics", teacher: "M. Wani", room: `Room 21 · ${CLASS}` },
    { time: "09:30", subject: "Remedial — English", teacher: "R. Mir", room: `Room 21 · ${CLASS}` },
    { time: "10:15", subject: "Remedial — Science", teacher: "K. Dar", room: "Lab 1" },
    { time: "11:00", subject: "Break", teacher: "—", room: "Courtyard", kind: "break" },
    { time: "11:15", subject: "House activities", teacher: "House staff", room: "Ground" },
  ],
};

export const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ------------------------------------------------------------------ */
/* Exam date sheet (mid-term)                                          */
/* ------------------------------------------------------------------ */

export type ExamSlot = {
  dateIso: string;
  dayLabel: string;
  dateLabel: string;
  subject: string;
  time: string;
  room: string;
};

export const midTermDateSheet: ExamSlot[] = [
  { dateIso: "2026-09-01", dayLabel: "Tue", dateLabel: "01 Sep", subject: "Urdu", time: "10:00 – 12:00", room: "Hall A" },
  { dateIso: "2026-09-02", dayLabel: "Wed", dateLabel: "02 Sep", subject: "Mathematics", time: "10:00 – 12:00", room: "Hall A" },
  { dateIso: "2026-09-03", dayLabel: "Thu", dateLabel: "03 Sep", subject: "Social Science", time: "10:00 – 12:00", room: "Hall B" },
  { dateIso: "2026-09-04", dayLabel: "Fri", dateLabel: "04 Sep", subject: "Kashmiri", time: "10:00 – 12:00", room: "Hall B" },
  { dateIso: "2026-09-07", dayLabel: "Mon", dateLabel: "07 Sep", subject: "English", time: "10:00 – 12:00", room: "Hall A" },
  { dateIso: "2026-09-08", dayLabel: "Tue", dateLabel: "08 Sep", subject: "Science", time: "10:00 – 12:00", room: "Hall A" },
  { dateIso: "2026-09-09", dayLabel: "Wed", dateLabel: "09 Sep", subject: "Computer Science", time: "10:00 – 11:30", room: "Computer lab" },
];
