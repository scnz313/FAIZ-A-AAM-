/**
 * School configuration read boundary (C2.1).
 *
 * Academic years, grades, sections, subjects, periods, and policy snapshots
 * are shared configuration. They are read once through this facade so forms,
 * context selectors, staff queues, and academic modules never invent labels or
 * policy values in components. Demo mode is deterministic; Supabase mode uses
 * the authenticated adapter and never falls back to the demo snapshot.
 */

import type { AcademicYear, GradeSection } from "@fass/contracts";

import { demoAcademicYears, demoGradeSections, demoStaffAssignments } from "@/modules/relationships/demo";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

export type SchoolGrade = {
  id: string;
  /** Public configuration reference; never use the UUID in browser commands. */
  ref: string;
  code: string;
  label: string;
  sortOrder: number;
};

export type AdmissionWindow = {
  id: string;
  ref: string;
  academicYearId: string;
  gradeId: string;
  opensAtIso: string;
  closesAtIso: string;
  capacity: number | null;
  status: "planned" | "open" | "closed" | "cancelled";
  version: number;
  policy: Record<string, unknown>;
  eligibilityPolicy: Record<string, unknown>;
};

export type AdmissionDocumentRequirement = {
  id: string;
  ref: string;
  windowId: string;
  code: string;
  label: string;
  required: boolean;
  allowedMimeTypes: string[];
  maxBytes: number;
  status: "active" | "archived";
  version: number;
};

export type AdmissionConfiguration = {
  academicYears: AcademicYear[];
  grades: SchoolGrade[];
  windows: AdmissionWindow[];
  documentRequirements: AdmissionDocumentRequirement[];
  policy: PolicySnapshot | null;
};

export type SchoolSubject = {
  id: string;
  code: string;
  name: string;
};

export type PeriodDefinition = {
  id: string;
  academicYearId: string;
  dayOfWeek: number;
  periodNumber: number;
  startsAt: string;
  endsAt: string;
};

export type StaffAssignmentDefinition = {
  id: string;
  ref?: string;
  gradeSectionId: string | null;
  subjectId: string | null;
  teacherName: string;
};

export type RoomDefinition = { id: string; code: string; label: string };

export type PolicySnapshot = {
  version: number;
  status: "policy_pending" | "draft" | "effective" | "superseded";
  values: Record<string, unknown>;
};

export type SchoolConfiguration = {
  academicYears: AcademicYear[];
  grades: SchoolGrade[];
  gradeSections: GradeSection[];
  subjects: SchoolSubject[];
  periods: PeriodDefinition[];
  assignments?: StaffAssignmentDefinition[];
  rooms?: RoomDefinition[];
  policy: PolicySnapshot | null;
};

const PERIOD_TIMES = [
  ["08:30", "08:45"],
  ["08:45", "09:30"],
  ["09:30", "10:15"],
  ["10:15", "11:00"],
  ["11:15", "12:00"],
  ["12:00", "12:45"],
  ["13:30", "14:15"],
  ["14:15", "15:00"],
] as const;

export const DEMO_SUBJECTS: SchoolSubject[] = [
  { id: "00000000-0000-4000-8000-000000000801", code: "MAT", name: "Mathematics" },
  { id: "00000000-0000-4000-8000-000000000802", code: "SCI", name: "General Science" },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function demoConfiguration(): SchoolConfiguration {
  const grades = Array.from(
    new Map(
      demoGradeSections.map((section) => {
        const match = section.gradeLabel.match(/\d+/);
        const code = match?.[0] ?? section.gradeLabel;
        return [code, { id: `00000000-0000-4000-8000-0000000007${code.padStart(2, "0")}`, ref: code, code, label: section.gradeLabel, sortOrder: Number(code) || 0 }];
      }),
    ).values(),
  );
  const currentYear = demoAcademicYears.find((year) => year.status === "current") ?? demoAcademicYears[0];
  const periods: PeriodDefinition[] = currentYear === undefined
    ? []
    : Array.from({ length: 6 }, (_, dayIndex) =>
        PERIOD_TIMES.map(([startsAt, endsAt], periodIndex) => ({
          id: `00000000-0000-4000-8000-${String(7000 + dayIndex * 8 + periodIndex + 1).padStart(12, "0")}`,
          academicYearId: currentYear.id,
          dayOfWeek: dayIndex + 1,
          periodNumber: periodIndex + 1,
          startsAt,
          endsAt,
        })),
      ).flat();
  const assignments = demoStaffAssignments;
  const subjects = [
    ...DEMO_SUBJECTS,
    ...assignments
      .filter((assignment) => !DEMO_SUBJECTS.some((subject) => subject.id === assignment.subjectId))
      .map((assignment) => ({ id: assignment.subjectId, code: assignment.subjectRef, name: assignment.subjectName })),
  ];
  return {
    academicYears: clone(demoAcademicYears),
    grades: clone(grades),
    gradeSections: clone(demoGradeSections),
    subjects: clone(subjects),
    periods,
    assignments: demoStaffAssignments.map((assignment) => ({ id: assignment.id, gradeSectionId: assignment.gradeSectionId ?? null, subjectId: assignment.subjectId ?? null, teacherName: assignment.staffMemberId })),
    rooms: [],
    policy: {
      version: 1,
      status: "policy_pending",
      values: {
        admissions: { window: "pending" },
        payments: { partialPayments: true, refundPolicy: "pending" },
        results: { gradeBands: "pending" },
      },
    },
  };
}

function isSchoolConfiguration(value: unknown): value is SchoolConfiguration {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SchoolConfiguration>;
  return Array.isArray(candidate.academicYears)
    && Array.isArray(candidate.grades)
    && Array.isArray(candidate.gradeSections)
    && Array.isArray(candidate.subjects)
    && Array.isArray(candidate.periods)
    && (candidate.policy === null || typeof candidate.policy === "object");
}

export interface SchoolConfigService {
  getConfiguration(academicYearId?: string): Promise<SchoolConfiguration>;
  getAdmissionConfiguration(academicYearId?: string): Promise<AdmissionConfiguration>;
}

const demoAdmissionYear = demoAcademicYears.find((year) => year.status === "current") ?? demoAcademicYears[0];

export const DEMO_ADMISSION_CONFIGURATION: AdmissionConfiguration = {
  academicYears: clone(demoAcademicYears),
  grades: [6, 7, 8, 9, 10].map((code) => ({
    id: `00000000-0000-4000-8000-0000000007${String(code).padStart(2, "0")}`,
    ref: String(code),
    code: String(code),
    label: `Class ${code}`,
    sortOrder: code,
  })),
  windows: [6, 7, 8, 9, 10].map((code) => ({
    id: `demo-window-${code}`,
    ref: `ADMW-DEMO-${code}`,
    academicYearId: demoAdmissionYear?.id ?? "demo-year",
    gradeId: `00000000-0000-4000-8000-0000000007${String(code).padStart(2, "0")}`,
    opensAtIso: "2026-08-01T00:00:00+05:30",
    closesAtIso: "2026-10-31T23:59:59+05:30",
    capacity: 60,
    status: "open",
    version: 1,
    policy: { demo: true },
    eligibilityPolicy: {},
  })),
  /* Requirements are configured per window, mirroring the live schema; the
     form scopes the document step to the window for the chosen class. */
  documentRequirements: [6, 7, 8, 9, 10].flatMap((code) => [
    { id: `demo-adreq-${code}-birth`, ref: `ADREQ-DEMO-${code}-BIRTH`, windowId: `demo-window-${code}`, code: "birth", label: "Birth certificate", required: true, allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024, status: "active", version: 1 },
    { id: `demo-adreq-${code}-photo`, ref: `ADREQ-DEMO-${code}-PHOTO`, windowId: `demo-window-${code}`, code: "photo", label: "Student photograph", required: true, allowedMimeTypes: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024, status: "active", version: 1 },
    { id: `demo-adreq-${code}-report`, ref: `ADREQ-DEMO-${code}-REPORT`, windowId: `demo-window-${code}`, code: "reportCard", label: "Previous report card", required: true, allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024, status: "active", version: 1 },
    { id: `demo-adreq-${code}-address`, ref: `ADREQ-DEMO-${code}-ADDRESS`, windowId: `demo-window-${code}`, code: "addressProof", label: "Address proof", required: true, allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024, status: "active", version: 1 },
  ]),
  policy: { version: 1, status: "effective", values: { demo: true } },
};

export const schoolConfigService: SchoolConfigService = {
  async getConfiguration(academicYearId) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<SchoolConfiguration>("config.read", academicYearId ? { academicYearId } : {});
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "School configuration is unavailable.");
      if (!isSchoolConfiguration(result.value)) throw new Error("School configuration returned an invalid shape.");
        return clone(result.value);
    }
    const value = demoConfiguration();
    if (academicYearId !== undefined) {
      value.gradeSections = value.gradeSections.filter((section) => section.academicYearId === academicYearId);
      value.periods = value.periods.filter((period) => period.academicYearId === academicYearId);
    }
    return value;
  },

  async getAdmissionConfiguration() {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<AdmissionConfiguration>("config.admissions");
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Admission configuration is unavailable.");
      if (!isAdmissionConfiguration(result.value)) throw new Error("Admission configuration returned an invalid shape.");
      return clone(result.value);
    }
    return clone(DEMO_ADMISSION_CONFIGURATION);
  },
};

function isAdmissionConfiguration(value: unknown): value is AdmissionConfiguration {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AdmissionConfiguration>;
  return Array.isArray(candidate.academicYears)
    && Array.isArray(candidate.grades)
    && Array.isArray(candidate.windows)
    && Array.isArray(candidate.documentRequirements)
    && (candidate.policy === null || typeof candidate.policy === "object");
}

export const createSchoolConfigService = (): SchoolConfigService => schoolConfigService;
