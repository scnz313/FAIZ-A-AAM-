/**
 * Import source-row shaping, header mapping, and validation. These rules are
 * shared by the server parse worker, the validation route, and the demo
 * adapter, so the tests pin the contract the commit transaction reads.
 */
import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/imports/csv-core";
import {
  mappingIssues,
  shapeSourceRows,
  suggestColumnMapping,
  targetFieldForHeader,
} from "@/modules/imports/source-rows";
import { isMalformedContact, validateSourceRows, type ValidationRowInput } from "@/modules/imports/validation";

function csv(body: string) {
  return parseCsv(new TextEncoder().encode(body));
}

describe("header mapping", () => {
  it("proposes canonical target fields for common source headers", () => {
    expect(targetFieldForHeader("source key")).toBe("sourceKey");
    expect(targetFieldForHeader("given name")).toBe("givenName");
    expect(targetFieldForHeader("FAMILY_NAME")).toBe("familyName");
    expect(targetFieldForHeader("mobile")).toBe("contact");
    expect(targetFieldForHeader("Guardian Ref")).toBe("guardianKey");
    expect(targetFieldForHeader("grade_section_id")).toBe("gradeSectionId");
    expect(targetFieldForHeader("unknown column")).toBeNull();
  });

  it("requires the structural entity and source-key mappings", () => {
    expect(mappingIssues({ name: "givenName", key: "sourceKey" })).toEqual(["Map a source column to entity."]);
    expect(mappingIssues({ entity: "entity", key: "sourceKey" })).toEqual([]);
  });
});

describe("source row shaping", () => {
  it("renames headers to canonical camelCase fields and normalizes values", () => {
    const rows = shapeSourceRows(csv(
      "entity,source_key,given_name,family_name,email\n" +
      "students,STU-1,  Aarif ,Hussain, Parent@Example.COM \n",
    ));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity).toBe("students");
    expect(rows[0]?.sourceKey).toBe("STU-1");
    expect(rows[0]?.normalized.givenName).toBe("Aarif");
    expect(rows[0]?.normalized.familyName).toBe("Hussain");
    expect(rows[0]?.normalized.contact).toBe("parent@example.com");
  });

  it("resolves structural columns through the mapping aliases", () => {
    const rows = shapeSourceRows(csv(
      "Entity,Source Key,Full Name\n" +
      "students,STU-9,Sana Wani\n",
    ));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity).toBe("students");
    expect(rows[0]?.sourceKey).toBe("STU-9");
    expect(rows[0]?.normalized.displayName).toBe("Sana Wani");
  });

  it("rejects rows without a valid entity", () => {
    expect(() => shapeSourceRows(csv(
      "entity,source_key,given_name\nmonsters,STU-1,Aarif\n",
    ))).toThrow(/invalid or missing entity/i);
  });

  it("derives a deterministic source key when the column is blank", () => {
    const rows = shapeSourceRows(csv("entity,source_key,given_name\nstudents,,Aarif\n"));
    expect(rows[0]?.sourceKey).toBe("students:row-2");
  });
});

describe("row validation", () => {
  function row(overrides: Partial<ValidationRowInput>): ValidationRowInput {
    return {
      rowId: "00000000-0000-4000-8000-000000000901",
      rowNumber: 2,
      entity: "students",
      sourceKey: "STU-1",
      normalized: { givenName: "Aarif", familyName: "Hussain" },
      ...overrides,
    };
  }

  it("passes a complete student row", () => {
    const result = validateSourceRows([row({})]);
    expect(result.rows[0]?.status).toBe("valid");
    expect(result.issues).toEqual([]);
  });

  it("flags duplicate source keys and missing names as errors", () => {
    const result = validateSourceRows([
      row({ rowId: "00000000-0000-4000-8000-000000000902" }),
      row({ rowId: "00000000-0000-4000-8000-000000000903", sourceKey: "STU-1", normalized: {} }),
    ]);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("duplicate_source_key");
    expect(codes).toContain("missing_required_field");
    expect(result.rows[0]?.status).toBe("valid");
    expect(result.rows[1]?.status).toBe("error");
    expect(result.errorCount).toBeGreaterThanOrEqual(2);
  });

  it("detects malformed guardian contacts as errors", () => {
    expect(isMalformedContact("not-an-email")).toBe(true);
    expect(isMalformedContact("parent@example.com")).toBe(false);
    expect(isMalformedContact("+919000000000")).toBe(false);

    const result = validateSourceRows([row({ entity: "guardians", normalized: { givenName: "Sana", contact: "12" } })]);
    expect(result.issues.map((issue) => issue.code)).toContain("malformed_contact");
    expect(result.rows[0]?.status).toBe("error");
  });

  it("warns (never silently merges) when a contact is shared inside the batch", () => {
    const result = validateSourceRows([
      row({ rowId: "00000000-0000-4000-8000-000000000904", entity: "guardians", normalized: { givenName: "A", contact: "+919000000001" } }),
      row({ rowId: "00000000-0000-4000-8000-000000000905", entity: "guardians", sourceKey: "G-2", normalized: { givenName: "B", contact: "+919000000001" } }),
    ]);
    expect(result.issues.map((issue) => issue.code)).toContain("shared_contact_review");
    expect(result.rows[1]?.status).toBe("warning");
    expect(result.warningCount).toBe(1);
  });

  it("requires a relationship's guardian and student keys", () => {
    const result = validateSourceRows([row({ entity: "guardian_student_relationships", normalized: { guardianKey: "G-1", studentKey: "" } })]);
    expect(result.issues.map((issue) => issue.code)).toContain("missing_relationship");
  });

  it("flags relationship references that are absent from the file", () => {
    const result = validateSourceRows([
      row({ rowId: "00000000-0000-4000-8000-000000000908", entity: "students", sourceKey: "STU-1", normalized: { givenName: "Aarif" } }),
      row({ rowId: "00000000-0000-4000-8000-000000000909", entity: "guardians", sourceKey: "G-1", normalized: { givenName: "Sana" } }),
      row({ rowId: "00000000-0000-4000-8000-000000000910", entity: "guardian_student_relationships", sourceKey: "REL-1", normalized: { guardianKey: "G-1", studentKey: "STU-1" } }),
      row({ rowId: "00000000-0000-4000-8000-000000000911", entity: "guardian_student_relationships", sourceKey: "REL-2", normalized: { guardianKey: "G-1", studentKey: "STU-MISSING" } }),
      row({ rowId: "00000000-0000-4000-8000-000000000912", entity: "guardian_student_relationships", sourceKey: "REL-3", normalized: { guardianKey: "G-MISSING", studentKey: "STU-1" } }),
    ]);

    const dangling = result.issues.filter((issue) => issue.severity === "error" && issue.code === "missing_relationship");
    expect(dangling).toHaveLength(2);
    expect(dangling.map((issue) => issue.field).sort()).toEqual(["guardianKey", "studentKey"]);
    expect(result.rows[0]?.status).toBe("valid");
    expect(result.rows[1]?.status).toBe("valid");
    expect(result.rows[2]?.status).toBe("valid");
    expect(result.rows[3]?.status).toBe("error");
    expect(result.rows[4]?.status).toBe("error");
  });

  it("checks grade section references against the known configuration when provided", () => {
    const known = "0129b314-0a7e-45b3-8e53-e5901f71d6a8";
    const unknown = "00000000-0000-4000-8000-00000000dead";

    const withoutContext = validateSourceRows([
      row({ rowId: "00000000-0000-4000-8000-000000000913", entity: "enrollments", sourceKey: "STU-1", normalized: { gradeSectionId: unknown } }),
    ]);
    expect(withoutContext.issues.map((issue) => issue.code)).not.toContain("unknown_grade_section");

    const withContext = validateSourceRows([
      row({ rowId: "00000000-0000-4000-8000-000000000914", entity: "enrollments", sourceKey: "STU-1", normalized: { gradeSectionId: known } }),
      row({ rowId: "00000000-0000-4000-8000-000000000915", entity: "enrollments", sourceKey: "STU-2", normalized: { gradeSectionId: unknown } }),
    ], { gradeSectionIds: new Set([known]) });

    const unknownIssues = withContext.issues.filter((issue) => issue.code === "unknown_grade_section");
    expect(unknownIssues).toHaveLength(1);
    expect(unknownIssues[0]?.field).toBe("gradeSectionId");
    expect(withContext.rows[0]?.status).toBe("valid");
    expect(withContext.rows[1]?.status).toBe("error");
  });

  it("requires real grade section and subject references for enrollments and assignments", () => {
    const enrollments = validateSourceRows([row({ entity: "enrollments", normalized: { gradeSectionId: "class-8a" } })]);
    expect(enrollments.issues.map((issue) => issue.code)).toContain("invalid_format");

    const assignments = validateSourceRows([row({
      entity: "teaching_assignments",
      normalized: {
        staffMemberKey: "",
        gradeSectionId: "00000000-0000-4000-8000-000000000708",
        subjectId: "not-a-uuid",
        effectiveFrom: "April 2026",
      },
    })]);
    const codes = assignments.issues.map((issue) => issue.code);
    expect(codes).toContain("missing_required_field");
    expect(codes).toContain("invalid_format");
  });

  it("resolves configured class labels to the grade section reference", () => {
    const section8a = "0129b314-0a7e-45b3-8e53-e5901f71d6a8";
    const sectionNurseryA = "0129b314-0a7e-45b3-8e53-e5901f71d6b9";
    const sectionLkgA = "0129b314-0a7e-45b3-8e53-e5901f71d6ca";
    const context = {
      gradeSections: [
        { id: section8a, gradeCode: "8", gradeLabel: "Class 8", sectionLabel: "A" },
        { id: sectionNurseryA, gradeCode: "nursery", gradeLabel: "Nursery", sectionLabel: "A" },
        { id: sectionLkgA, gradeCode: "lkg", gradeLabel: "LKG", sectionLabel: "A" },
      ],
      academicYearLabel: "2026-27",
    };

    const spellings: Array<[string, string]> = [
      ["Class 8-A", section8a],
      ["Class 8 A", section8a],
      ["8-A", section8a],
      ["8A", section8a],
      ["8/A", section8a],
      ["class 8-a", section8a],
      ["Nursery-A", sectionNurseryA],
      ["LKG A", sectionLkgA],
    ];
    spellings.forEach(([value, expected], index) => {
      const rowId = `00000000-0000-4000-8000-00000000${String(index).padStart(4, "0")}`;
      const result = validateSourceRows([
        row({ rowId, entity: "enrollments", sourceKey: `STU-${index}`, normalized: { gradeSectionId: value } }),
      ], context);
      expect(result.issues).toEqual([]);
      expect(result.rows[0]?.status).toBe("valid");
      expect(result.resolutions).toEqual([{ rowId, field: "gradeSectionId", value: expected }]);
    });
  });

  it("reports an unconfigured class label against the batch year", () => {
    const result = validateSourceRows([
      row({ entity: "enrollments", sourceKey: "STU-1", normalized: { gradeSectionId: "Class 4-C" } }),
    ], {
      gradeSections: [{ id: "0129b314-0a7e-45b3-8e53-e5901f71d6a8", gradeCode: "8", gradeLabel: "Class 8", sectionLabel: "A" }],
      academicYearLabel: "2026-27",
    });
    const issue = result.issues.find((candidate) => candidate.code === "unknown_grade_section");
    expect(issue?.message).toBe("Class 'Class 4-C' is not configured for 2026-27 · add it in School setup");
    expect(result.rows[0]?.status).toBe("error");
    expect(result.resolutions).toEqual([]);
  });

  it("flags a repeated enrollment for the same student", () => {
    const result = validateSourceRows([
      row({ rowId: "00000000-0000-4000-8000-000000000906", entity: "enrollments", sourceKey: "STU-1", normalized: { gradeSectionId: "00000000-0000-4000-8000-000000000708" } }),
      row({ rowId: "00000000-0000-4000-8000-000000000907", entity: "enrollments", sourceKey: "STU-1", normalized: { gradeSectionId: "00000000-0000-4000-8000-000000000709" } }),
    ]);
    expect(result.issues.map((issue) => issue.code)).toContain("duplicate_active_enrollment");
    expect(result.rows[1]?.status).toBe("error");
  });
});
