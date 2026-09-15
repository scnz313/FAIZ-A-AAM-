/**
 * Import row validation (browser + server).
 *
 * Pure, deterministic batch validation shared by the demo adapter and the
 * server validation route. It never touches the database: shape, required
 * fields, format, duplicate source keys, and shared-contact review are
 * decided here; the commit transaction remains the final authority for
 * record resolution and uniqueness.
 */

import type {
  DataImportEntity,
  DataImportIssueCode,
  DataImportIssueSeverity,
} from "@fass/contracts";

export type ValidationRowInput = {
  rowId: string;
  rowNumber: number;
  entity: DataImportEntity;
  sourceKey: string;
  normalized: Record<string, unknown>;
};

export type ImportIssueDraft = {
  rowId: string;
  rowNumber: number;
  severity: DataImportIssueSeverity;
  code: DataImportIssueCode;
  field: string | null;
  message: string;
  resolutionHint: string | null;
};

export type ValidationRowResult = {
  rowId: string;
  status: "valid" | "warning" | "error";
};

export type ValidationResult = {
  rows: ValidationRowResult[];
  issues: ImportIssueDraft[];
  errorCount: number;
  warningCount: number;
};

/** Known configuration the pure validator cannot discover by itself. */
export type ValidationContext = {
  /** Grade section ids for the batch's academic year, when the caller can
   *  read them. Omitted (demo mode) skips the existence check. */
  gradeSectionIds?: ReadonlySet<string>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function isParsableDate(value: string): boolean {
  return value !== "" && !Number.isNaN(Date.parse(value));
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isMalformedContact(value: string): boolean {
  if (value === "") return false;
  return !EMAIL_PATTERN.test(value) && !PHONE_PATTERN.test(value.replace(/[\s-]/g, ""));
}

/**
 * Validate the normalized rows of one batch. Issues carry the exact stored
 * row id so the Resolve step can act on the row the message describes.
 */
export function validateSourceRows(
  rows: readonly ValidationRowInput[],
  context: ValidationContext = {},
): ValidationResult {
  const issues: ImportIssueDraft[] = [];
  const seenSourceKeys = new Map<string, string>();
  const seenStudentKeys = new Map<string, string>();
  const seenContacts = new Map<string, string>();
  /* In-file referential integrity: relationship rows can only resolve to a
     guardian/student row in this batch or to a previously imported record. */
  const studentKeys = new Set<string>();
  const guardianKeys = new Set<string>();
  for (const row of rows) {
    const key = text(row.sourceKey);
    if (key === "") continue;
    if (row.entity === "students") studentKeys.add(key);
    else if (row.entity === "guardians") guardianKeys.add(key);
  }

  const addIssue = (
    row: ValidationRowInput,
    severity: DataImportIssueSeverity,
    code: DataImportIssueCode,
    field: string | null,
    message: string,
    resolutionHint: string | null,
  ) => {
    issues.push({ rowId: row.rowId, rowNumber: row.rowNumber, severity, code, field, message, resolutionHint });
  };

  for (const row of rows) {
    const sourceKey = text(row.sourceKey);
    if (sourceKey === "") {
      addIssue(row, "error", "missing_required_field", "sourceKey", "The row has no stable source key.", "Map a source column that identifies this record in the source system.");
    } else {
      const composite = `${row.entity}:${sourceKey}`;
      if (seenSourceKeys.has(composite)) {
        addIssue(row, "error", "duplicate_source_key", "sourceKey", `Source key ${sourceKey} appears more than once in this file.`, "Correct the duplicate key or remove the duplicate row.");
      } else {
        seenSourceKeys.set(composite, row.rowId);
      }
    }

    const givenName = text(row.normalized.givenName) || text(row.normalized.given_name);
    const familyName = text(row.normalized.familyName) || text(row.normalized.family_name);
    const displayName = text(row.normalized.displayName) || text(row.normalized.display_name);

    if (row.entity === "students") {
      if (givenName === "" && familyName === "" && displayName === "") {
        addIssue(row, "error", "missing_required_field", "givenName", "A student row needs a given name, a family name, or a display name.", "Map the name columns, then re-run validation.");
      }
    }

    if (row.entity === "guardians") {
      if (givenName === "" && familyName === "" && displayName === "") {
        addIssue(row, "error", "missing_required_field", "givenName", "A guardian row needs a given name, a family name, or a display name.", "Map the name columns, then re-run validation.");
      }
      const contact = text(row.normalized.contact);
      if (contact !== "" && isMalformedContact(contact)) {
        addIssue(row, "error", "malformed_contact", "contact", `Contact "${contact}" is neither a valid email nor a valid phone number.`, "Correct the contact value or clear it.");
      } else if (contact !== "") {
        if (seenContacts.has(contact)) {
          addIssue(row, "warning", "shared_contact_review", "contact", `Contact ${contact} is also used by an earlier guardian row.`, "Confirm the shared contact is intentional; it is never merged automatically.");
        } else {
          seenContacts.set(contact, row.rowId);
        }
      }
    }

    if (row.entity === "guardian_student_relationships") {
      const guardianKey = text(row.normalized.guardianKey);
      const studentKey = text(row.normalized.studentKey);
      if (guardianKey === "" || studentKey === "") {
        addIssue(row, "error", "missing_relationship", "guardianKey", "A relationship row needs both the guardian key and the student key.", "Map both key columns from the source export.");
      } else {
        if (!guardianKeys.has(guardianKey)) {
          addIssue(row, "error", "missing_relationship", "guardianKey", `Guardian key ${guardianKey} is not in this file or a previously imported record.`, "Correct the guardian key, accept it if that guardian already exists in the school record, or skip this row.");
        }
        if (!studentKeys.has(studentKey)) {
          addIssue(row, "error", "missing_relationship", "studentKey", `Student key ${studentKey} is not in this file or a previously imported record.`, "Correct the student key, accept it if that student already exists in the school record, or skip this row.");
        }
      }
    }

    if (row.entity === "enrollments") {
      const gradeSectionId = text(row.normalized.gradeSectionId);
      if (gradeSectionId === "") {
        addIssue(row, "error", "missing_required_field", "gradeSectionId", "An enrollment row needs a grade section reference.", "Map the grade section column from the source export.");
      } else if (!isUuid(gradeSectionId)) {
        addIssue(row, "error", "invalid_format", "gradeSectionId", "The grade section reference is not a valid school reference.", "Use the grade section identifier from the school configuration export.");
      } else if (context.gradeSectionIds !== undefined && !context.gradeSectionIds.has(gradeSectionId.toLowerCase())) {
        addIssue(row, "error", "unknown_grade_section", "gradeSectionId", `Grade section ${gradeSectionId} is not configured for this academic year.`, "Choose a grade section reference from the current school configuration, or skip this row.");
      }
      const studentKey = text(row.normalized.sourceKey) || sourceKey;
      if (studentKey !== "") {
        if (seenStudentKeys.has(studentKey)) {
          addIssue(row, "error", "duplicate_active_enrollment", "sourceKey", `Student ${studentKey} appears in more than one enrollment row.`, "Keep one enrollment row per student for the academic year.");
        } else {
          seenStudentKeys.set(studentKey, row.rowId);
        }
      }
    }

    if (row.entity === "teaching_assignments") {
      const staffMemberKey = text(row.normalized.staffMemberKey);
      const gradeSectionId = text(row.normalized.gradeSectionId);
      const subjectId = text(row.normalized.subjectId);
      const effectiveFrom = text(row.normalized.effectiveFrom);
      if (staffMemberKey === "") {
        addIssue(row, "error", "missing_required_field", "staffMemberKey", "A teaching assignment needs a staff member key.", "Map the staff member key column from the source export.");
      }
      if (gradeSectionId === "") {
        addIssue(row, "error", "missing_required_field", "gradeSectionId", "A teaching assignment needs a grade section reference.", "Map the grade section column from the source export.");
      } else if (!isUuid(gradeSectionId)) {
        addIssue(row, "error", "invalid_format", "gradeSectionId", "The grade section reference is not a valid school reference.", "Use the grade section identifier from the school configuration export.");
      } else if (context.gradeSectionIds !== undefined && !context.gradeSectionIds.has(gradeSectionId.toLowerCase())) {
        addIssue(row, "error", "unknown_grade_section", "gradeSectionId", `Grade section ${gradeSectionId} is not configured for this academic year.`, "Choose a grade section reference from the current school configuration, or skip this row.");
      }
      if (subjectId === "") {
        addIssue(row, "error", "missing_required_field", "subjectId", "A teaching assignment needs a subject reference.", "Map the subject column from the source export.");
      } else if (!isUuid(subjectId)) {
        addIssue(row, "error", "invalid_format", "subjectId", "The subject reference is not a valid school reference.", "Use the subject identifier from the school configuration export.");
      }
      if (effectiveFrom !== "" && !isParsableDate(effectiveFrom)) {
        addIssue(row, "error", "invalid_format", "effectiveFrom", "The effective-from value is not a valid date.", "Use an ISO date (2026-04-01) or clear the value.");
      }
    }
  }

  const issuesByRow = new Map<string, ImportIssueDraft[]>();
  for (const issue of issues) {
    const list = issuesByRow.get(issue.rowId) ?? [];
    list.push(issue);
    issuesByRow.set(issue.rowId, list);
  }
  const resultRows: ValidationRowResult[] = rows.map((row) => {
    const rowIssues = issuesByRow.get(row.rowId) ?? [];
    const status: ValidationRowResult["status"] = rowIssues.some((issue) => issue.severity === "error")
      ? "error"
      : rowIssues.some((issue) => issue.severity === "warning")
        ? "warning"
        : "valid";
    return { rowId: row.rowId, status };
  });

  return {
    rows: resultRows,
    issues,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
  };
}
