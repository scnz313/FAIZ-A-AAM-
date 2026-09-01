/**
 * School-data import contracts (three-portal consolidation, Phase 4).
 *
 * Import is Administrator-only, private, previewed, validated, provenance-
 * aware, idempotent, recoverable, and auditable. Raw files and row payloads
 * never reach the browser; every create/match/update/skip decision records
 * batch and row provenance.
 */

import { z } from "zod";

import { opaqueIdSchema, publicReferenceSchema } from "./relationships";

/* ------------------------------------------------------------------ */
/* State machine                                                       */
/* ------------------------------------------------------------------ */

export const DATA_IMPORT_STATES = [
  "uploaded",
  "scanning",
  "mapping",
  "validating",
  "needs_resolution",
  "ready",
  "committing",
  "completed",
  "failed",
  "cancelled",
  "partially_committed",
] as const;
export const dataImportStateSchema = z.enum(DATA_IMPORT_STATES);
export type DataImportState = z.infer<typeof dataImportStateSchema>;

export const DATA_IMPORT_ENTITIES = [
  "students",
  "guardians",
  "guardian_student_relationships",
  "enrollments",
  "teaching_assignments",
] as const;
export const dataImportEntitySchema = z.enum(DATA_IMPORT_ENTITIES);
export type DataImportEntity = z.infer<typeof dataImportEntitySchema>;

export const DATA_IMPORT_ISSUE_CODES = [
  "missing_required_field",
  "invalid_format",
  "duplicate_source_key",
  "conflicting_identity",
  "duplicate_active_enrollment",
  "unknown_grade_section",
  "unknown_academic_year",
  "invalid_date_range",
  "missing_relationship",
  "malformed_contact",
  "shared_contact_review",
  "conflicting_student_key",
] as const;
export const dataImportIssueCodeSchema = z.enum(DATA_IMPORT_ISSUE_CODES);
export type DataImportIssueCode = z.infer<typeof dataImportIssueCodeSchema>;

export const DATA_IMPORT_SEVERITIES = ["error", "warning"] as const;
export const dataImportIssueSeveritySchema = z.enum(DATA_IMPORT_SEVERITIES);
export type DataImportIssueSeverity = z.infer<typeof dataImportIssueSeveritySchema>;

/** One validation/dedup finding against a batch row or the batch as a whole. */
export const dataImportIssueSchema = z.object({
  id: opaqueIdSchema,
  batchId: opaqueIdSchema,
  rowNumber: z.number().int().positive().nullable(),
  severity: dataImportIssueSeveritySchema,
  code: dataImportIssueCodeSchema,
  field: z.string().nullable(),
  message: z.string().min(1),
  /** Recovery action shown to the Administrator in the resolve step. */
  resolutionHint: z.string().nullable(),
  resolvedAtIso: z.string().datetime().nullable(),
});
export type DataImportIssue = z.infer<typeof dataImportIssueSchema>;

/** Row outcome lifecycle; `committed` rows carry their new public reference. */
export const DATA_IMPORT_ROW_STATUSES = [
  "pending",
  "mapped",
  "valid",
  "warning",
  "error",
  "resolved",
  "committed",
  "skipped",
  "failed",
] as const;
export const dataImportRowStatusSchema = z.enum(DATA_IMPORT_ROW_STATUSES);
export type DataImportRowStatus = z.infer<typeof dataImportRowStatusSchema>;

export const dataImportRowSchema = z.object({
  id: opaqueIdSchema,
  batchId: opaqueIdSchema,
  rowNumber: z.number().int().positive(),
  entity: dataImportEntitySchema,
  /** Stable source key (school student number / guardian external key). */
  sourceKey: z.string().min(1),
  /** Normalized canonical fields after mapping; never the raw payload. */
  normalized: z.record(z.unknown()),
  status: dataImportRowStatusSchema,
  issueIds: z.array(opaqueIdSchema),
  outcome: z.enum(["create", "update", "unchanged", "skipped", "error"]).nullable(),
  committedRecordRef: publicReferenceSchema.nullable(),
});
export type DataImportRow = z.infer<typeof dataImportRowSchema>;

export const dataImportBatchSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  academicYearId: opaqueIdSchema,
  sourceSystem: z.string().min(1),
  state: dataImportStateSchema,
  version: z.number().int().positive(),
  rowCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  createdByAccountId: opaqueIdSchema,
  createdAtIso: z.string().datetime(),
  committedAtIso: z.string().datetime().nullable(),
});
export type DataImportBatch = z.infer<typeof dataImportBatchSchema>;

export const DATA_IMPORT_ISSUE_SEVERITIES = ["error", "warning"] as const;

/** Column mapping saved per source system/version for reuse. */
export const dataImportMappingSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  sourceSystem: z.string().min(1),
  sourceVersion: z.string().min(1),
  entity: dataImportEntitySchema,
  /** Canonical field → source column header. */
  columnMappings: z.record(z.string()),
  version: z.number().int().positive(),
});
export type DataImportMapping = z.infer<typeof dataImportMappingSchema>;

/** Exact consequence preview before commit — no silent writes. */
export const dataImportPreviewSchema = z.object({
  batchId: opaqueIdSchema,
  createCount: z.number().int().nonnegative(),
  updateCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  familyGroupCount: z.number().int().nonnegative(),
});
export type DataImportPreview = z.infer<typeof dataImportPreviewSchema>;

export const dataImportUploadInputSchema = z.object({
  academicYearId: opaqueIdSchema,
  sourceSystem: z.string().min(1),
  /** Explicit operator confirmations recorded with the batch. */
  authorityConfirmation: z.literal(true),
  privacyConfirmation: z.literal(true),
});
export type DataImportUploadInput = z.infer<typeof dataImportUploadInputSchema>;

export const dataImportCommitInputSchema = z.object({
  batchId: opaqueIdSchema,
  expectedState: dataImportStateSchema,
  expectedVersion: z.number().int().positive(),
  reason: z.string().min(3),
  idempotencyKey: z.string().min(8),
  /** Exact preview counts the administrator confirmed. */
  confirmedCreateCount: z.number().int().nonnegative(),
  confirmedUpdateCount: z.number().int().nonnegative(),
});
export type DataImportCommitInput = z.infer<typeof dataImportCommitInputSchema>;

/** Immutable post-commit summary rendered on the report step. */
export const dataImportReportSchema = z.object({
  batchRef: publicReferenceSchema,
  state: dataImportStateSchema,
  rowCount: z.number().int().nonnegative(),
  createdCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  committedAtIso: z.string().datetime().nullable(),
  auditRef: publicReferenceSchema.nullable(),
});
export type DataImportReport = z.infer<typeof dataImportReportSchema>;
