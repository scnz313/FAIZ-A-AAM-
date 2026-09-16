/**
 * School configuration service (Slice 3): academic years, grades, grade
 * sections, subjects, exam terms, and assessment components.
 *
 * Supabase mode delegates to the migration-000123 RPCs through the adapter
 * registry (`schoolSetup.*`); every write then re-reads through
 * `schoolSetup.read` so callers always render authoritative state. Demo mode
 * keeps a session-backed store seeded from the relationship fixtures so the
 * workspace can be exercised end to end without a database. Components never
 * read fixtures directly — the service is the only boundary.
 */

import { marksByTerm } from "@/modules/academics/demo";
import {
  demoAcademicYears,
  demoEnrollments,
  demoGradeSections,
  demoStaffAssignments,
} from "@/modules/relationships/demo";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

/* ------------------------------------------------------------------ */
/* Models (mirror the school_setup_read projection)                    */
/* ------------------------------------------------------------------ */

export type SetupAcademicYearStatus = "upcoming" | "current" | "historical" | "closed";
export type SetupSectionStatus = "planned" | "active" | "archived";
export type SetupExamStatus = "planned" | "open" | "closed";

export type SetupAcademicYear = {
  id: string;
  ref: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: SetupAcademicYearStatus;
};

export type SetupGrade = {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  /** Sections of this grade in the selected academic year. */
  sectionCount: number;
  /** True once any section references the grade; a referenced grade keeps
     its code immutable and should not be casually renamed. */
  referenced: boolean;
};

export type SetupSection = {
  id: string;
  ref: string;
  academicYearId: string;
  gradeId: string;
  gradeLabel: string;
  sectionLabel: string;
  status: SetupSectionStatus;
  enrollmentCount: number;
  examCount: number;
};

export type SetupSubject = {
  id: string;
  code: string;
  name: string;
  componentCount: number;
  referenced: boolean;
};

export type SetupComponent = {
  id: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  name: string;
  maxMarks: number;
  sortOrder: number;
  /** Result batches already opened against this exam + subject. A component
     with batches can no longer be edited or removed. */
  batchCount: number;
};

export type SetupExam = {
  id: string;
  ref: string;
  academicYearId: string;
  gradeSectionId: string;
  /** Display label such as "Class 8-A". */
  sectionLabel: string;
  term: string;
  status: SetupExamStatus;
  components: SetupComponent[];
};

export type SchoolSetup = {
  selectedAcademicYearId: string | null;
  academicYears: SetupAcademicYear[];
  grades: SetupGrade[];
  sections: SetupSection[];
  subjects: SetupSubject[];
  exams: SetupExam[];
};

export type ExamComponentInput = { subjectId: string; name: string; maxMarks: number };

/** Nursery through Class 10 — the fixed catalog `grades_add_standard_catalog`
   inserts; mirrored here so the demo store applies the same set. */
export const STANDARD_GRADE_CATALOG: ReadonlyArray<{ code: string; label: string; sortOrder: number }> = [
  { code: "nursery", label: "Nursery", sortOrder: -3 },
  { code: "lkg", label: "LKG", sortOrder: -2 },
  { code: "ukg", label: "UKG", sortOrder: -1 },
  ...Array.from({ length: 10 }, (_, index) => ({
    code: String(index + 1),
    label: `Class ${index + 1}`,
    sortOrder: index + 1,
  })),
];

/* ------------------------------------------------------------------ */
/* Projection mapping                                                  */
/* ------------------------------------------------------------------ */

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapYear(raw: unknown): SetupAcademicYear {
  const row = (raw ?? {}) as Record<string, unknown>;
  const status = text(row.status);
  return {
    id: text(row.id),
    ref: text(row.reference),
    label: text(row.label),
    startsOn: text(row.startsOn),
    endsOn: text(row.endsOn),
    status: status === "current" || status === "historical" || status === "closed" ? status : "upcoming",
  };
}

function mapGrade(raw: unknown): SetupGrade {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(row.id),
    code: text(row.code),
    label: text(row.label),
    sortOrder: num(row.sortOrder),
    sectionCount: num(row.sectionCount),
    referenced: row.referenced === true,
  };
}

function mapSection(raw: unknown): SetupSection {
  const row = (raw ?? {}) as Record<string, unknown>;
  const status = text(row.status);
  return {
    id: text(row.id),
    ref: text(row.reference),
    academicYearId: text(row.academicYearId),
    gradeId: text(row.gradeId),
    gradeLabel: text(row.gradeLabel),
    sectionLabel: text(row.sectionLabel),
    status: status === "active" || status === "archived" ? status : "planned",
    enrollmentCount: num(row.enrollmentCount),
    examCount: num(row.examCount),
  };
}

function mapSubject(raw: unknown): SetupSubject {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(row.id),
    code: text(row.code),
    name: text(row.name),
    componentCount: num(row.componentCount),
    referenced: row.referenced === true,
  };
}

function mapComponent(raw: unknown): SetupComponent {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(row.id),
    subjectId: text(row.subjectId),
    subjectCode: text(row.subjectCode),
    subjectName: text(row.subjectName),
    name: text(row.name),
    maxMarks: num(row.maxMarks),
    sortOrder: num(row.sortOrder),
    batchCount: num(row.batchCount),
  };
}

function mapExam(raw: unknown): SetupExam {
  const row = (raw ?? {}) as Record<string, unknown>;
  const status = text(row.status);
  return {
    id: text(row.id),
    ref: text(row.reference),
    academicYearId: text(row.academicYearId),
    gradeSectionId: text(row.gradeSectionId),
    sectionLabel: text(row.sectionLabel),
    term: text(row.term),
    status: status === "open" || status === "closed" ? status : "planned",
    components: Array.isArray(row.components) ? row.components.map(mapComponent) : [],
  };
}

/** Map the `school_setup_read` jsonb to the typed model. */
export function mapSchoolSetupRead(raw: unknown): SchoolSetup {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    selectedAcademicYearId: typeof row.selectedAcademicYearId === "string" ? row.selectedAcademicYearId : null,
    academicYears: Array.isArray(row.academicYears) ? row.academicYears.map(mapYear) : [],
    grades: Array.isArray(row.grades) ? row.grades.map(mapGrade) : [],
    sections: Array.isArray(row.sections) ? row.sections.map(mapSection) : [],
    subjects: Array.isArray(row.subjects) ? row.subjects.map(mapSubject) : [],
    exams: Array.isArray(row.exams) ? row.exams.map(mapExam) : [],
  };
}

/* ------------------------------------------------------------------ */
/* Demo session store                                                  */
/* ------------------------------------------------------------------ */

const DEMO_KEY = sessionKey("school-setup");

type DemoSetupState = {
  academicYears: SetupAcademicYear[];
  grades: SetupGrade[];
  sections: SetupSection[];
  subjects: SetupSubject[];
  exams: SetupExam[];
  /** Monotonic reference counters so generated refs never repeat. */
  counters: { year: number; section: number; exam: number };
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function demoSubjectSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function demoSubjectCode(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

/**
 * Seed demo subjects from the shared school-config fixtures plus every
 * subject the academics marks fixtures name, so exam components always
 * resolve to a real subject row.
 */
function seedSubjects(): SetupSubject[] {
  const subjects = new Map<string, SetupSubject>();
  const add = (id: string, code: string, name: string) => {
    if (!subjects.has(id)) subjects.set(id, { id, code, name, componentCount: 0, referenced: false });
  };
  add("00000000-0000-4000-8000-000000000801", "MAT", "Mathematics");
  add("00000000-0000-4000-8000-000000000802", "SCI", "General Science");
  for (const assignment of demoStaffAssignments) {
    if (assignment.subjectId && assignment.subjectName) {
      add(assignment.subjectId, assignment.subjectRef, assignment.subjectName);
    }
  }
  for (const marks of Object.values(marksByTerm)) {
    for (const mark of marks) {
      const existing = [...subjects.values()].find(
        (subject) => subject.name.toLowerCase() === mark.subject.toLowerCase(),
      );
      if (existing === undefined) {
        add(`demo-subject:${demoSubjectSlug(mark.subject)}`, demoSubjectCode(mark.subject), mark.subject);
      }
    }
  }
  return [...subjects.values()];
}

function seedDemoState(): DemoSetupState {
  const grades = new Map<string, SetupGrade>();
  for (const section of demoGradeSections) {
    const code = (section.gradeLabel.match(/\d+/)?.[0] ?? section.gradeLabel).toLowerCase();
    if (!grades.has(code)) {
      const numeric = Number(code);
      grades.set(code, {
        id: `00000000-0000-4000-8000-0000000007${String(Number.isFinite(numeric) ? numeric : 0).padStart(2, "0")}`,
        code,
        label: section.gradeLabel,
        sortOrder: Number.isFinite(numeric) ? numeric : 0,
        sectionCount: 0,
        referenced: true,
      });
    }
  }
  const gradeByLabel = new Map([...grades.values()].map((grade) => [grade.label, grade]));
  const sections: SetupSection[] = demoGradeSections.map((section) => ({
    id: section.id,
    ref: section.ref,
    academicYearId: section.academicYearId,
    gradeId: gradeByLabel.get(section.gradeLabel)?.id ?? "",
    gradeLabel: section.gradeLabel,
    sectionLabel: section.sectionLabel,
    status: section.status === "archived" ? "archived" : section.status === "planned" ? "planned" : "active",
    enrollmentCount: 0,
    examCount: 0,
  }));
  const subjects = seedSubjects();
  const subjectByName = new Map(subjects.map((subject) => [subject.name.toLowerCase(), subject]));
  const currentYearId =
    demoAcademicYears.find((year) => year.status === "current")?.id ?? demoAcademicYears[0]?.id ?? "";
  const exams: SetupExam[] = [];
  let examSeq = 0;
  for (const section of sections) {
    if (section.status !== "active" || section.academicYearId !== currentYearId) continue;
    for (const [term, marks] of Object.entries(marksByTerm)) {
      examSeq += 1;
      exams.push({
        id: `demo-exam:${demoSubjectSlug(term)}:${section.id}`,
        ref: `EXM-2026-${String(200 + examSeq).padStart(4, "0")}`,
        academicYearId: section.academicYearId,
        gradeSectionId: section.id,
        sectionLabel: `${section.gradeLabel}-${section.sectionLabel}`,
        term: term.toLowerCase(),
        status: "open",
        components: marks.map((mark, index) => {
          const subject = subjectByName.get(mark.subject.toLowerCase());
          return {
            id: `demo-component:${demoSubjectSlug(term)}:${section.id}:${index}`,
            subjectId: subject?.id ?? "",
            subjectCode: subject?.code ?? "",
            subjectName: mark.subject,
            name: term,
            maxMarks: mark.max,
            sortOrder: index,
            batchCount: 0,
          };
        }),
      });
    }
  }
  return {
    academicYears: demoAcademicYears.map((year) => ({
      id: year.id,
      ref: year.ref,
      label: year.label,
      startsOn: year.startsOn,
      endsOn: year.endsOn,
      status: year.status,
    })),
    grades: [...grades.values()],
    sections,
    subjects,
    exams,
    counters: { year: 100, section: 100, exam: 200 + examSeq },
  };
}

function loadDemoState(): DemoSetupState {
  const stored = sessionGet<DemoSetupState>(DEMO_KEY);
  if (stored !== null) return stored;
  const seeded = seedDemoState();
  sessionSet(DEMO_KEY, seeded);
  return seeded;
}

function saveDemoState(state: DemoSetupState): void {
  sessionSet(DEMO_KEY, state);
}

/** Test hook: drop the demo store so a fresh seed is built. */
export function resetDemoSchoolSetup(): void {
  sessionSet(DEMO_KEY, seedDemoState());
}

/* Result batches created through the academics demo adapter carry the demo
   exam-definition id and subject id; counting them keeps the demo refusal
   honest when a batch already exists. */
function demoBatchCount(examId: string, subjectId: string): number {
  const academics = sessionGet<{
    batches?: Record<string, { examDefinitionId?: string; subjectId?: string; status?: string }>;
  }>(sessionKey("academics"));
  if (academics?.batches === undefined) return 0;
  return Object.values(academics.batches).filter(
    (batch) => batch.examDefinitionId === examId && batch.subjectId === subjectId && batch.status !== "withdrawn",
  ).length;
}

function demoRead(academicYearId?: string): SchoolSetup {
  const state = loadDemoState();
  const selected =
    academicYearId ??
    state.academicYears.find((year) => year.status === "current")?.id ??
    [...state.academicYears].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0]?.id ??
    null;
  const activeEnrollments = new Map<string, number>();
  for (const enrollment of demoEnrollments) {
    if (enrollment.status === "active") {
      activeEnrollments.set(enrollment.gradeSectionId, (activeEnrollments.get(enrollment.gradeSectionId) ?? 0) + 1);
    }
  }
  const exams = state.exams
    .filter((exam) => selected === null || exam.academicYearId === selected)
    .map((exam) => ({
      ...clone(exam),
      components: exam.components.map((component) => ({
        ...component,
        batchCount: Math.max(component.batchCount, demoBatchCount(exam.id, component.subjectId)),
      })),
    }));
  const sections = state.sections
    .filter((section) => selected === null || section.academicYearId === selected)
    .map((section) => ({
      ...clone(section),
      enrollmentCount: activeEnrollments.get(section.id) ?? 0,
      examCount: exams.filter((exam) => exam.gradeSectionId === section.id).length,
    }));
  const grades = state.grades.map((grade) => ({
    ...clone(grade),
    sectionCount: sections.filter((section) => section.gradeId === grade.id).length,
    referenced: grade.referenced || state.sections.some((section) => section.gradeId === grade.id),
  }));
  const subjects = state.subjects.map((subject) => ({
    ...clone(subject),
    componentCount: state.exams.reduce(
      (count, exam) => count + exam.components.filter((component) => component.subjectId === subject.id).length,
      0,
    ),
    referenced:
      subject.referenced ||
      state.exams.some((exam) => exam.components.some((component) => component.subjectId === subject.id)) ||
      demoStaffAssignments.some((assignment) => assignment.subjectId === subject.id),
  }));
  return {
    selectedAcademicYearId: selected,
    academicYears: clone(state.academicYears),
    grades,
    sections,
    subjects,
    exams,
  };
}

function findExam(state: DemoSetupState, examId: string): SetupExam {
  const exam = state.exams.find((candidate) => candidate.id === examId);
  if (exam === undefined) throw new Error("exam definition not found");
  return exam;
}

function requireOpenExam(exam: SetupExam): void {
  if (exam.status === "closed") {
    throw new Error("assessment components are locked for a closed exam");
  }
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

function adapterError(result: { errors: Array<{ message: string }> }, fallback: string): Error {
  return new Error(result.errors[0]?.message ?? fallback);
}

export const schoolSetupService = {
  async read(academicYearId?: string): Promise<SchoolSetup> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown>("schoolSetup.read", academicYearId ? { academicYearId } : {});
      if (!result.ok) throw adapterError(result, "School configuration could not be loaded.");
      return mapSchoolSetupRead(result.value);
    }
    return demoRead(academicYearId);
  },

  async createAcademicYear(input: { label: string; startsOn: string; endsOn: string; reason: string }): Promise<SetupAcademicYear> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown>("schoolSetup.academicYearCreate", input);
      if (!result.ok) throw adapterError(result, "The academic year could not be created.");
      return mapYear(result.value);
    }
    const state = loadDemoState();
    const label = input.label.trim();
    if (label === "") throw new Error("an academic year label is required");
    if (input.endsOn <= input.startsOn) throw new Error("the academic year must end after it starts");
    if (state.academicYears.some((year) => year.label === label)) throw new Error("academic year label already exists");
    state.counters.year += 1;
    const year: SetupAcademicYear = {
      id: `demo-year-${state.counters.year}`,
      ref: `AY-DEMO-${state.counters.year}`,
      label,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: "upcoming",
    };
    state.academicYears.push(year);
    saveDemoState(state);
    return clone(year);
  },

  async setAcademicYearStatus(input: { id: string; status: SetupAcademicYearStatus; reason: string }): Promise<{ demotedReferences: string[] }> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ demotedReferences?: string[] }>("schoolSetup.academicYearSetStatus", input);
      if (!result.ok) throw adapterError(result, "The academic year status could not be changed.");
      return { demotedReferences: result.value.demotedReferences ?? [] };
    }
    const state = loadDemoState();
    const year = state.academicYears.find((candidate) => candidate.id === input.id);
    if (year === undefined) throw new Error("academic year not found");
    const demoted: string[] = [];
    if (year.status === "upcoming" && input.status === "current") {
      for (const candidate of state.academicYears) {
        if (candidate.status === "current" && candidate.id !== year.id) {
          candidate.status = "historical";
          demoted.push(candidate.ref);
        }
      }
      year.status = "current";
    } else if (year.status === "current" && input.status === "historical") {
      year.status = "historical";
    } else if (year.status === "historical" && input.status === "closed") {
      year.status = "closed";
    } else {
      throw new Error(`invalid academic year status transition: ${year.status} to ${input.status}`);
    }
    saveDemoState(state);
    return { demotedReferences: demoted };
  },

  async upsertGrade(input: { id?: string; code?: string; label?: string; sortOrder?: number; reason: string }): Promise<SetupGrade> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown>("schoolSetup.gradeUpsert", input);
      if (!result.ok) throw adapterError(result, "The grade could not be saved.");
      return mapGrade(result.value);
    }
    const state = loadDemoState();
    const code = (input.code ?? "").trim().toLowerCase();
    const label = (input.label ?? "").trim();
    if (input.id === undefined) {
      if (code === "") throw new Error("a grade code is required");
      if (label === "") throw new Error("a grade label is required");
      if (state.grades.some((grade) => grade.code === code)) throw new Error("grade code already exists");
      if (state.grades.some((grade) => grade.label === label)) throw new Error("grade label already exists");
      const grade: SetupGrade = {
        id: `demo-grade-${code}`,
        code,
        label,
        sortOrder: input.sortOrder ?? 0,
        sectionCount: 0,
        referenced: false,
      };
      state.grades.push(grade);
      saveDemoState(state);
      return clone(grade);
    }
    const grade = state.grades.find((candidate) => candidate.id === input.id);
    if (grade === undefined) throw new Error("grade not found");
    if (code !== "" && code !== grade.code) throw new Error("grade code cannot be changed");
    if (label !== "" && label !== grade.label && state.grades.some((candidate) => candidate.label === label && candidate.id !== grade.id)) {
      throw new Error("grade label already exists");
    }
    if (label !== "") grade.label = label;
    if (input.sortOrder !== undefined) grade.sortOrder = input.sortOrder;
    saveDemoState(state);
    return clone(grade);
  },

  async addStandardGrades(input: { reason: string }): Promise<SetupGrade[]> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown[]>("schoolSetup.gradesAddStandard", { reason: input.reason });
      if (!result.ok) throw adapterError(result, "The standard grades could not be added.");
      return (result.value ?? []).map(mapGrade);
    }
    const state = loadDemoState();
    const inserted: SetupGrade[] = [];
    for (const entry of STANDARD_GRADE_CATALOG) {
      if (state.grades.some((grade) => grade.code === entry.code || grade.label === entry.label)) continue;
      const grade: SetupGrade = {
        id: `demo-grade-${entry.code}`,
        code: entry.code,
        label: entry.label,
        sortOrder: entry.sortOrder,
        sectionCount: 0,
        referenced: false,
      };
      state.grades.push(grade);
      inserted.push(grade);
    }
    state.grades.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    saveDemoState(state);
    return clone(inserted);
  },

  async createSection(input: { academicYearId: string; gradeId: string; sectionLabel: string; reason: string }): Promise<SetupSection> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown>("schoolSetup.sectionCreate", input);
      if (!result.ok) throw adapterError(result, "The section could not be created.");
      return mapSection(result.value);
    }
    const state = loadDemoState();
    const label = input.sectionLabel.trim().toUpperCase();
    if (label.length < 1 || label.length > 3) throw new Error("a section label must be 1-3 characters");
    if (!state.academicYears.some((year) => year.id === input.academicYearId)) throw new Error("academic year not found");
    const grade = state.grades.find((candidate) => candidate.id === input.gradeId);
    if (grade === undefined) throw new Error("grade not found");
    if (
      state.sections.some(
        (section) =>
          section.academicYearId === input.academicYearId &&
          section.gradeId === input.gradeId &&
          section.sectionLabel === label,
      )
    ) {
      throw new Error("this section already exists for the year");
    }
    state.counters.section += 1;
    const section: SetupSection = {
      id: `demo-section-${state.counters.section}`,
      ref: `SEC-DEMO-${state.counters.section}`,
      academicYearId: input.academicYearId,
      gradeId: grade.id,
      gradeLabel: grade.label,
      sectionLabel: label,
      status: "planned",
      enrollmentCount: 0,
      examCount: 0,
    };
    state.sections.push(section);
    saveDemoState(state);
    return clone(section);
  },

  async setSectionStatus(input: { id: string; status: SetupSectionStatus; reason: string }): Promise<void> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall("schoolSetup.sectionSetStatus", input);
      if (!result.ok) throw adapterError(result, "The section status could not be changed.");
      return;
    }
    const state = loadDemoState();
    const section = state.sections.find((candidate) => candidate.id === input.id);
    if (section === undefined) throw new Error("grade section not found");
    if (section.status === "planned" && input.status === "active") {
      section.status = "active";
    } else if (section.status === "active" && input.status === "archived") {
      if (demoEnrollments.some((enrollment) => enrollment.gradeSectionId === section.id && enrollment.status === "active")) {
        throw new Error("section still has active enrollments");
      }
      section.status = "archived";
    } else if (section.status === "archived" && input.status === "active") {
      section.status = "active";
    } else {
      throw new Error(`invalid section status transition: ${section.status} to ${input.status}`);
    }
    saveDemoState(state);
  },

  async copySectionsFromYear(input: { sourceYearId: string; targetYearId: string; reason: string }): Promise<SetupSection[]> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown[]>("schoolSetup.sectionsCopyFromYear", input);
      if (!result.ok) throw adapterError(result, "Sections could not be copied.");
      return (result.value ?? []).map(mapSection);
    }
    const state = loadDemoState();
    if (input.sourceYearId === input.targetYearId) throw new Error("a different source and target academic year are required");
    if (!state.academicYears.some((year) => year.id === input.sourceYearId) || !state.academicYears.some((year) => year.id === input.targetYearId)) {
      throw new Error("academic year not found");
    }
    const created: SetupSection[] = [];
    for (const source of state.sections.filter((section) => section.academicYearId === input.sourceYearId)) {
      const exists = state.sections.some(
        (section) =>
          section.academicYearId === input.targetYearId &&
          section.gradeId === source.gradeId &&
          section.sectionLabel === source.sectionLabel,
      );
      if (exists) continue;
      state.counters.section += 1;
      const section: SetupSection = {
        ...clone(source),
        id: `demo-section-${state.counters.section}`,
        ref: `SEC-DEMO-${state.counters.section}`,
        academicYearId: input.targetYearId,
        status: "planned",
        enrollmentCount: 0,
        examCount: 0,
      };
      state.sections.push(section);
      created.push(section);
    }
    saveDemoState(state);
    return clone(created);
  },

  async upsertSubject(input: { id?: string; code?: string; name?: string; reason: string }): Promise<SetupSubject> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown>("schoolSetup.subjectUpsert", input);
      if (!result.ok) throw adapterError(result, "The subject could not be saved.");
      return mapSubject(result.value);
    }
    const state = loadDemoState();
    const code = (input.code ?? "").trim().toUpperCase();
    const name = (input.name ?? "").trim();
    if (input.id === undefined) {
      if (code === "") throw new Error("a subject code is required");
      if (name === "") throw new Error("a subject name is required");
      if (state.subjects.some((subject) => subject.code === code)) throw new Error("subject code already exists");
      if (state.subjects.some((subject) => subject.name === name)) throw new Error("subject name already exists");
      const subject: SetupSubject = { id: `demo-subject:${demoSubjectSlug(name)}`, code, name, componentCount: 0, referenced: false };
      state.subjects.push(subject);
      saveDemoState(state);
      return clone(subject);
    }
    const subject = state.subjects.find((candidate) => candidate.id === input.id);
    if (subject === undefined) throw new Error("subject not found");
    if (code !== "" && code !== subject.code) throw new Error("subject code cannot be changed");
    if (name !== "" && name !== subject.name && state.subjects.some((candidate) => candidate.name === name && candidate.id !== subject.id)) {
      throw new Error("subject name already exists");
    }
    if (name !== "") subject.name = name;
    saveDemoState(state);
    return clone(subject);
  },

  async createExamTerm(input: {
    academicYearId: string;
    term: string;
    gradeSectionIds: string[];
    components: ExamComponentInput[];
    reason: string;
  }): Promise<{ created: string[]; skipped: string[] }> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ created?: string[]; skipped?: string[] }>("schoolSetup.examTermCreate", input);
      if (!result.ok) throw adapterError(result, "The exam term could not be created.");
      return { created: result.value.created ?? [], skipped: result.value.skipped ?? [] };
    }
    const state = loadDemoState();
    const term = input.term.trim().toLowerCase();
    if (term.length < 2 || term.length > 40) throw new Error("an exam term must be 2-40 characters");
    if (input.gradeSectionIds.length === 0) throw new Error("at least one grade section is required");
    if (input.components.length === 0) throw new Error("at least one assessment component is required");
    input.components.forEach((component, index) => {
      if (!state.subjects.some((subject) => subject.id === component.subjectId)) {
        throw new Error(`component ${index + 1} references an unknown subject`);
      }
      const name = component.name.trim();
      if (name.length < 1 || name.length > 40) throw new Error(`component ${index + 1} name must be 1-40 characters`);
      if (!(component.maxMarks > 0)) throw new Error(`component ${index + 1} maximum marks must be positive`);
      if (component.maxMarks > 1000) throw new Error(`component ${index + 1} maximum marks cannot exceed 1000`);
    });
    const created: string[] = [];
    const skipped: string[] = [];
    for (const sectionId of input.gradeSectionIds) {
      const section = state.sections.find((candidate) => candidate.id === sectionId);
      if (section === undefined || section.academicYearId !== input.academicYearId) {
        throw new Error("a section does not belong to this academic year");
      }
      const existing = state.exams.find(
        (exam) => exam.academicYearId === input.academicYearId && exam.gradeSectionId === sectionId && exam.term === term,
      );
      if (existing !== undefined) {
        skipped.push(existing.ref);
        continue;
      }
      state.counters.exam += 1;
      const exam: SetupExam = {
        id: `demo-exam:${demoSubjectSlug(term)}:${sectionId}`,
        ref: `EXM-2026-${String(state.counters.exam).padStart(4, "0")}`,
        academicYearId: input.academicYearId,
        gradeSectionId: sectionId,
        sectionLabel: `${section.gradeLabel}-${section.sectionLabel}`,
        term,
        status: "planned",
        components: input.components.map((component, index) => {
          const subject = state.subjects.find((candidate) => candidate.id === component.subjectId);
          return {
            id: `demo-component:${demoSubjectSlug(term)}:${sectionId}:${index}`,
            subjectId: component.subjectId,
            subjectCode: subject?.code ?? "",
            subjectName: subject?.name ?? "",
            name: component.name.trim(),
            maxMarks: component.maxMarks,
            sortOrder: index,
            batchCount: 0,
          };
        }),
      };
      state.exams.push(exam);
      created.push(exam.ref);
    }
    saveDemoState(state);
    return { created, skipped };
  },

  async upsertComponent(input: { examDefinitionId: string; subjectId: string; name: string; maxMarks: number; reason: string }): Promise<SetupComponent> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<unknown>("schoolSetup.componentUpsert", input);
      if (!result.ok) throw adapterError(result, "The assessment component could not be saved.");
      return mapComponent(result.value);
    }
    const state = loadDemoState();
    const exam = findExam(state, input.examDefinitionId);
    requireOpenExam(exam);
    if (demoBatchCount(exam.id, input.subjectId) > 0) {
      throw new Error("marks already exist for this subject in this exam");
    }
    const name = input.name.trim();
    if (name.length < 1 || name.length > 40) throw new Error("a component name must be 1-40 characters");
    if (!(input.maxMarks > 0)) throw new Error("component maximum marks must be positive");
    if (input.maxMarks > 1000) throw new Error("component maximum marks cannot exceed 1000");
    const subject = state.subjects.find((candidate) => candidate.id === input.subjectId);
    if (subject === undefined) throw new Error("subject not found");
    const existing = exam.components.find((component) => component.subjectId === input.subjectId);
    if (existing !== undefined) {
      existing.name = name;
      existing.maxMarks = input.maxMarks;
      saveDemoState(state);
      return clone(existing);
    }
    const component: SetupComponent = {
      id: `demo-component:${exam.id}:${input.subjectId}`,
      subjectId: subject.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      name,
      maxMarks: input.maxMarks,
      sortOrder: exam.components.length,
      batchCount: 0,
    };
    exam.components.push(component);
    saveDemoState(state);
    return clone(component);
  },

  async deleteComponent(input: { id: string; reason: string }): Promise<void> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall("schoolSetup.componentDelete", input);
      if (!result.ok) throw adapterError(result, "The assessment component could not be removed.");
      return;
    }
    const state = loadDemoState();
    const exam = state.exams.find((candidate) => candidate.components.some((component) => component.id === input.id));
    if (exam === undefined) throw new Error("assessment component not found");
    requireOpenExam(exam);
    const component = exam.components.find((candidate) => candidate.id === input.id);
    if (component !== undefined && demoBatchCount(exam.id, component.subjectId) > 0) {
      throw new Error("marks already exist for this subject in this exam");
    }
    exam.components = exam.components.filter((candidate) => candidate.id !== input.id);
    saveDemoState(state);
  },

  async setExamStatus(input: { id: string; status: SetupExamStatus; reason: string }): Promise<void> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall("schoolSetup.examSetStatus", input);
      if (!result.ok) throw adapterError(result, "The exam status could not be changed.");
      return;
    }
    const state = loadDemoState();
    const exam = findExam(state, input.id);
    if (exam.status === "planned" && input.status === "open") {
      exam.status = "open";
    } else if (exam.status === "open" && input.status === "closed") {
      exam.status = "closed";
    } else if (exam.status === "closed" && input.status === "open") {
      exam.status = "open";
    } else {
      throw new Error(`invalid exam status transition: ${exam.status} to ${input.status}`);
    }
    saveDemoState(state);
  },
};
