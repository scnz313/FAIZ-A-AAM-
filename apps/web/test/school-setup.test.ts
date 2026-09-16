import { beforeEach, describe, expect, it } from "vitest";

import {
  mapSchoolSetupRead,
  resetDemoSchoolSetup,
  schoolSetupService,
  STANDARD_GRADE_CATALOG,
} from "@/modules/services/school-setup";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const SETUP_KEY = sessionKey("school-setup");
const REASON = "setting up the new year";

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(SETUP_KEY);
  resetDemoSchoolSetup();
});

describe("mapSchoolSetupRead", () => {
  it("maps the RPC projection into the typed setup model", () => {
    const model = mapSchoolSetupRead({
      selectedAcademicYearId: "year-1",
      academicYears: [
        { id: "year-1", reference: "AY-2026-27", label: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current" },
      ],
      grades: [{ id: "g-8", code: "8", label: "Class 8", sortOrder: 8, sectionCount: 2, referenced: true }],
      sections: [
        { id: "s-1", reference: "SEC-1", academicYearId: "year-1", gradeId: "g-8", gradeLabel: "Class 8", sectionLabel: "A", status: "active", enrollmentCount: 24, examCount: 1 },
      ],
      subjects: [{ id: "sub-1", code: "MAT", name: "Mathematics", componentCount: 2, referenced: true }],
      exams: [
        {
          id: "ex-1",
          reference: "EXM-1",
          academicYearId: "year-1",
          gradeSectionId: "s-1",
          sectionLabel: "Class 8-A",
          term: "midterm",
          status: "open",
          components: [
            { id: "c-1", subjectId: "sub-1", subjectCode: "MAT", subjectName: "Mathematics", name: "Midterm", maxMarks: 100, sortOrder: 0, batchCount: 1 },
          ],
        },
      ],
    });
    expect(model.selectedAcademicYearId).toBe("year-1");
    expect(model.academicYears[0]?.status).toBe("current");
    expect(model.grades[0]).toMatchObject({ code: "8", sectionCount: 2, referenced: true });
    expect(model.sections[0]).toMatchObject({ status: "active", enrollmentCount: 24 });
    expect(model.exams[0]?.components[0]).toMatchObject({ maxMarks: 100, batchCount: 1 });
  });

  it("coerces unknown statuses and tolerates missing collections", () => {
    const model = mapSchoolSetupRead({
      grades: [{ id: "g", code: "1", label: "Class 1", sortOrder: "1" }],
      sections: [{ id: "s", status: "unexpected" }],
      exams: [{ id: "e", status: "unexpected", components: "nope" }],
    });
    expect(model.selectedAcademicYearId).toBeNull();
    expect(model.grades[0]?.sortOrder).toBe(0);
    expect(model.sections[0]?.status).toBe("planned");
    expect(model.exams[0]?.status).toBe("planned");
    expect(model.exams[0]?.components).toEqual([]);
    expect(model.academicYears).toEqual([]);
  });
});

describe("demo school setup store", () => {
  it("seeds academic years, grades, sections, and exams for the current year", async () => {
    const setup = await schoolSetupService.read();
    expect(setup.selectedAcademicYearId).not.toBeNull();
    const current = setup.academicYears.find((year) => year.id === setup.selectedAcademicYearId);
    expect(current?.status).toBe("current");
    expect(setup.sections.every((section) => section.academicYearId === setup.selectedAcademicYearId)).toBe(true);
    expect(setup.exams.length).toBeGreaterThan(0);
    expect(setup.exams[0]?.components.length).toBeGreaterThan(0);
    /* The seeded 8-A section has an active enrollment in the fixture. */
    const active = setup.sections.find((section) => section.sectionLabel === "A" && section.gradeLabel === "Class 8");
    expect(active?.enrollmentCount).toBeGreaterThan(0);
  });

  it("creates a grade and returns it on the next read", async () => {
    const grade = await schoolSetupService.upsertGrade({ code: "4", label: "Class 4", sortOrder: 4, reason: REASON });
    expect(grade.label).toBe("Class 4");
    const setup = await schoolSetupService.read();
    expect(setup.grades.some((candidate) => candidate.code === "4")).toBe(true);
  });

  it("rejects a duplicate grade code and an immutable code change", async () => {
    await expect(schoolSetupService.upsertGrade({ code: "8", label: "Duplicate", reason: REASON })).rejects.toThrow(
      "grade code already exists",
    );
    const setup = await schoolSetupService.read();
    const grade8 = setup.grades.find((grade) => grade.code === "8");
    await expect(
      schoolSetupService.upsertGrade({ id: grade8?.id, code: "88", label: "Class 8", reason: REASON }),
    ).rejects.toThrow("grade code cannot be changed");
    const renamed = await schoolSetupService.upsertGrade({ id: grade8?.id, label: "Class VIII", reason: REASON });
    expect(renamed.label).toBe("Class VIII");
  });

  it("adds only the missing standard catalog grades", async () => {
    const inserted = await schoolSetupService.addStandardGrades({ reason: REASON });
    /* The seed already has 7, 8, and 9, so 10 catalog rows insert. */
    expect(inserted).toHaveLength(STANDARD_GRADE_CATALOG.length - 3);
    const again = await schoolSetupService.addStandardGrades({ reason: REASON });
    expect(again).toHaveLength(0);
    const setup = await schoolSetupService.read();
    expect(setup.grades.some((grade) => grade.code === "nursery")).toBe(true);
  });

  it("creates a planned section and rejects a duplicate", async () => {
    const setup = await schoolSetupService.read();
    const grade8 = setup.grades.find((grade) => grade.code === "8");
    const created = await schoolSetupService.createSection({
      academicYearId: setup.selectedAcademicYearId ?? "",
      gradeId: grade8?.id ?? "",
      sectionLabel: " b ",
      reason: REASON,
    });
    expect(created.sectionLabel).toBe("B");
    expect(created.status).toBe("planned");
    await expect(
      schoolSetupService.createSection({
        academicYearId: setup.selectedAcademicYearId ?? "",
        gradeId: grade8?.id ?? "",
        sectionLabel: "b",
        reason: REASON,
      }),
    ).rejects.toThrow("this section already exists for the year");
  });

  it("walks the section lifecycle and refuses to archive enrolled sections", async () => {
    const setup = await schoolSetupService.read();
    const enrolled = setup.sections.find((section) => section.enrollmentCount > 0);
    expect(enrolled).toBeDefined();
    await expect(
      schoolSetupService.setSectionStatus({ id: enrolled?.id ?? "", status: "archived", reason: REASON }),
    ).rejects.toThrow("section still has active enrollments");

    const grade8 = setup.grades.find((grade) => grade.code === "8");
    const fresh = await schoolSetupService.createSection({
      academicYearId: setup.selectedAcademicYearId ?? "",
      gradeId: grade8?.id ?? "",
      sectionLabel: "D",
      reason: REASON,
    });
    await expect(
      schoolSetupService.setSectionStatus({ id: fresh.id, status: "archived", reason: REASON }),
    ).rejects.toThrow("invalid section status transition");
    await schoolSetupService.setSectionStatus({ id: fresh.id, status: "active", reason: REASON });
    await schoolSetupService.setSectionStatus({ id: fresh.id, status: "archived", reason: REASON });
    const after = await schoolSetupService.read();
    expect(after.sections.find((section) => section.id === fresh.id)?.status).toBe("archived");
  });

  it("copies missing sections into a new year as planned", async () => {
    const setup = await schoolSetupService.read();
    const year = await schoolSetupService.createAcademicYear({
      label: "2027-28",
      startsOn: "2027-04-01",
      endsOn: "2028-03-31",
      reason: REASON,
    });
    const created = await schoolSetupService.copySectionsFromYear({
      sourceYearId: setup.selectedAcademicYearId ?? "",
      targetYearId: year.id,
      reason: REASON,
    });
    expect(created.length).toBe(setup.sections.length);
    expect(created.every((section) => section.status === "planned")).toBe(true);
    const next = await schoolSetupService.read(year.id);
    expect(next.sections).toHaveLength(created.length);
  });

  it("creates an exam term with components and skips existing sections", async () => {
    const setup = await schoolSetupService.read();
    const sections = setup.sections.slice(0, 2);
    const maths = setup.subjects.find((subject) => subject.code === "MAT");
    const result = await schoolSetupService.createExamTerm({
      academicYearId: setup.selectedAcademicYearId ?? "",
      term: " Unit Test ",
      gradeSectionIds: sections.map((section) => section.id),
      components: [{ subjectId: maths?.id ?? "", name: "Unit Test", maxMarks: 25 }],
      reason: REASON,
    });
    expect(result.created).toHaveLength(sections.length);
    expect(result.skipped).toHaveLength(0);

    const after = await schoolSetupService.read();
    const exam = after.exams.find((candidate) => candidate.term === "unit test");
    expect(exam?.status).toBe("planned");
    expect(exam?.components[0]).toMatchObject({ name: "Unit Test", maxMarks: 25, subjectName: maths?.name });

    const repeat = await schoolSetupService.createExamTerm({
      academicYearId: setup.selectedAcademicYearId ?? "",
      term: "unit test",
      gradeSectionIds: sections.map((section) => section.id),
      components: [{ subjectId: maths?.id ?? "", name: "Unit Test", maxMarks: 25 }],
      reason: REASON,
    });
    expect(repeat.created).toHaveLength(0);
    expect(repeat.skipped).toHaveLength(sections.length);
  });

  it("locks components once the exam is closed and reopens them", async () => {
    const setup = await schoolSetupService.read();
    const exam = setup.exams[0];
    expect(exam).toBeDefined();
    await schoolSetupService.setExamStatus({ id: exam?.id ?? "", status: "closed", reason: REASON });
    const component = exam?.components[0];
    await expect(
      schoolSetupService.upsertComponent({
        examDefinitionId: exam?.id ?? "",
        subjectId: component?.subjectId ?? "",
        name: "Renamed",
        maxMarks: 50,
        reason: REASON,
      }),
    ).rejects.toThrow("assessment components are locked for a closed exam");
    await schoolSetupService.setExamStatus({ id: exam?.id ?? "", status: "open", reason: REASON });
    const updated = await schoolSetupService.upsertComponent({
      examDefinitionId: exam?.id ?? "",
      subjectId: component?.subjectId ?? "",
      name: "Renamed",
      maxMarks: 50,
      reason: REASON,
    });
    expect(updated.name).toBe("Renamed");
    expect(updated.maxMarks).toBe(50);
    await schoolSetupService.deleteComponent({ id: updated.id, reason: REASON });
    const after = await schoolSetupService.read();
    const reloaded = after.exams.find((candidate) => candidate.id === exam?.id);
    expect(reloaded?.components.some((candidate) => candidate.id === updated.id)).toBe(false);
  });

  it("creates and renames a subject while keeping the code immutable", async () => {
    const subject = await schoolSetupService.upsertSubject({ code: "geo", name: "Geography", reason: REASON });
    expect(subject.code).toBe("GEO");
    const renamed = await schoolSetupService.upsertSubject({ id: subject.id, name: "Geography and Civics", reason: REASON });
    expect(renamed.name).toBe("Geography and Civics");
    await expect(
      schoolSetupService.upsertSubject({ id: subject.id, code: "GEOG", reason: REASON }),
    ).rejects.toThrow("subject code cannot be changed");
    await expect(
      schoolSetupService.upsertSubject({ code: "GEO", name: "Another", reason: REASON }),
    ).rejects.toThrow("subject code already exists");
  });

  it("moves an upcoming year to current and demotes the incumbent", async () => {
    const setup = await schoolSetupService.read();
    const created = await schoolSetupService.createAcademicYear({
      label: "2027-28",
      startsOn: "2027-04-01",
      endsOn: "2028-03-31",
      reason: REASON,
    });
    const result = await schoolSetupService.setAcademicYearStatus({ id: created.id, status: "current", reason: REASON });
    expect(result.demotedReferences.length).toBe(1);
    const after = await schoolSetupService.read(created.id);
    expect(after.selectedAcademicYearId).toBe(created.id);
    const prior = after.academicYears.find((year) => year.id === setup.selectedAcademicYearId);
    expect(prior?.status).toBe("historical");
  });
});
