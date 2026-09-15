/**
 * Shared import source-row shaping and header mapping (browser + server).
 *
 * One deterministic interpretation of a parsed CSV export, shared by the
 * server parse worker, the validation route, and the demo adapter. Raw row
 * payloads still never reach the browser in Supabase mode.
 */

import type { DataImportEntity, DataImportRowStatus } from "@fass/contracts";

import { normalizeImportValue } from "@/lib/imports/csv-shared";
import type { ParsedCsv } from "@/lib/imports/csv-core";

export const IMPORT_ENTITIES: readonly DataImportEntity[] = [
  "students",
  "guardians",
  "guardian_student_relationships",
  "enrollments",
  "teaching_assignments",
];

export type ImportSourceRow = {
  rowNumber: number;
  entity: DataImportEntity;
  sourceKey: string;
  normalized: Record<string, unknown>;
  status: DataImportRowStatus;
};

/** Field aliases the mapping UI proposes for a source header. */
const HEADER_ALIASES: Readonly<Record<string, string>> = {
  entity: "entity",
  source_key: "sourceKey",
  sourcekey: "sourceKey",
  given_name: "givenName",
  givenname: "givenName",
  first_name: "givenName",
  family_name: "familyName",
  familyname: "familyName",
  last_name: "familyName",
  display_name: "displayName",
  displayname: "displayName",
  full_name: "displayName",
  school_student_number: "schoolStudentNumber",
  student_number: "schoolStudentNumber",
  admission_number: "schoolStudentNumber",
  contact: "contact",
  email: "contact",
  phone: "contact",
  mobile: "contact",
  relationship_label: "relationshipLabel",
  relationship: "relationshipLabel",
  relation: "relationshipLabel",
  guardian_key: "guardianKey",
  guardian_ref: "guardianKey",
  student_key: "studentKey",
  student_ref: "studentKey",
  grade_section_id: "gradeSectionId",
  section: "gradeSectionId",
  subject_id: "subjectId",
  subject: "subjectId",
  staff_member_key: "staffMemberKey",
  staff_key: "staffMemberKey",
  effective_from: "effectiveFrom",
  effective_to: "effectiveTo",
  family_key: "familyKey",
  family: "familyKey",
};

function canonicalHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Proposed target field for one source header, or null when unknown. */
export function targetFieldForHeader(header: string): string | null {
  return HEADER_ALIASES[canonicalHeader(header)] ?? null;
}

/**
 * Deterministic proposed mapping for every detected header. `entity` and
 * `sourceKey` are structural columns every import file must carry.
 */
export function suggestColumnMapping(headers: readonly string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const target = targetFieldForHeader(header);
    if (target !== null) mapping[header] = target;
  }
  return mapping;
}

/** The structural columns every import file must map. */
export const REQUIRED_MAPPING_TARGETS = ["entity", "sourceKey"] as const;

/** Canonical target fields the mapping UI offers for each source header. */
export const CANONICAL_TARGET_FIELDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "entity", label: "Entity" },
  { value: "sourceKey", label: "Source key" },
  { value: "familyKey", label: "Family key" },
  { value: "givenName", label: "Given name" },
  { value: "familyName", label: "Family name" },
  { value: "displayName", label: "Display name" },
  { value: "schoolStudentNumber", label: "School student number" },
  { value: "contact", label: "Contact (email or mobile)" },
  { value: "relationshipLabel", label: "Relationship" },
  { value: "guardianKey", label: "Guardian key" },
  { value: "studentKey", label: "Student key" },
  { value: "gradeSectionId", label: "Grade section reference" },
  { value: "subjectId", label: "Subject reference" },
  { value: "staffMemberKey", label: "Staff member key" },
  { value: "effectiveFrom", label: "Effective from" },
  { value: "effectiveTo", label: "Effective to" },
];

export function mappingIssues(mapping: Record<string, string>): string[] {
  const targets = new Set(Object.values(mapping));
  const issues: string[] = [];
  for (const required of REQUIRED_MAPPING_TARGETS) {
    if (!targets.has(required)) issues.push(`Map a source column to ${required}.`);
  }
  return issues;
}

/** Kind hint used to normalize a cell deterministically. */
export function normalizeKindForHeader(header: string): "email" | "phone" | "name" | "relationship" | "text" {
  const lowered = header.toLowerCase();
  if (lowered.includes("email")) return "email";
  if (/phone|mobile/.test(lowered)) return "phone";
  if (lowered.includes("name")) return "name";
  if (/relation/.test(lowered)) return "relationship";
  return "text";
}

/** Resolve one canonical target field from raw source headers, honoring the
 * same aliases the mapping UI proposes (for example "Source Key" and
 * "source_key" both resolve `sourceKey`). */
function structuredValue(source: Record<string, string>, target: string): string {
  for (const [key, value] of Object.entries(source)) {
    if ((targetFieldForHeader(key) ?? canonicalHeader(key)) === target) return value;
  }
  return "";
}

/**
 * Shape parsed CSV records into source rows: every row declares its entity
 * and its stable source key; every other column is normalized against the
 * header kind. Invalid or missing entities fail the whole file.
 *
 * Structural columns are resolved through the same header aliases the mapping
 * UI proposes, so an export using "Entity"/"Source Key" parses exactly like
 * one using `entity`/`source_key`.
 */
export function shapeSourceRows(parsed: ParsedCsv): ImportSourceRow[] {
  const allowed = new Set<string>(IMPORT_ENTITIES);
  if (parsed.rows.length === 0) {
    throw new Error("The file has no data rows — check the export and retry.");
  }
  return parsed.rows.map((source, index) => {
    const entity = structuredValue(source, "entity").trim();
    if (!entity || !allowed.has(entity)) {
      throw new Error(`Row ${index + 2} has an invalid or missing entity.`);
    }
    const sourceKey = structuredValue(source, "sourceKey").trim() || `${entity}:row-${index + 2}`;
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      /* Canonical camelCase field names are the commit contract; unknown
         headers keep their canonical header name for provenance. */
      const target = targetFieldForHeader(key) ?? canonicalHeader(key);
      if (target === "entity" || target === "sourceKey") continue;
      normalized[target] = normalizeImportValue(normalizeKindForHeader(key), value);
    }
    return {
      rowNumber: index + 2,
      entity: entity as DataImportEntity,
      sourceKey,
      normalized,
      status: "pending",
    };
  });
}
