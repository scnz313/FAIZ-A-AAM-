/**
 * Non-login teaching records (three-portal consolidation, Phase 3).
 *
 * Teachers are school records, not portal accounts: a teaching assignment is
 * maintained by the Principal and referenced by timetable periods, conflict
 * checks, and optional result-entry attribution. Creating or editing a
 * teaching assignment never creates an auth identity, user account, or role
 * grant. Legacy `staff_assignments` rows remain for historical attribution.
 */

import { z } from "zod";

import { opaqueIdSchema, publicReferenceSchema } from "./relationships";

export const TEACHING_ASSIGNMENT_STATUSES = ["scheduled", "active", "ended"] as const;
export const teachingAssignmentStatusSchema = z.enum(TEACHING_ASSIGNMENT_STATUSES);
export type TeachingAssignmentStatus = z.infer<typeof teachingAssignmentStatusSchema>;

/** Where an assignment row came from — provenance is immutable after create. */
export const TEACHING_ASSIGNMENT_PROVENANCES = ["manual", "import", "legacy_backfill"] as const;
export const teachingAssignmentProvenanceSchema = z.enum(TEACHING_ASSIGNMENT_PROVENANCES);
export type TeachingAssignmentProvenance = z.infer<typeof teachingAssignmentProvenanceSchema>;

/**
 * One non-login teaching record: a staff member row without a user account,
 * maintained by the Principal. The optional `legacyAccountId` is present only
 * for historical people who once held a login; it never grants portal access.
 */
export const teachingStaffRecordSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  /** Nullable: a non-login record may exist without a linked person row. */
  personId: opaqueIdSchema.nullable(),
  displayName: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["active", "suspended", "ended"]),
  /** Historical auth/account linkage for people who once held teacher access. */
  legacyAccountId: opaqueIdSchema.nullable().optional(),
  version: z.number().int().positive(),
});
export type TeachingStaffRecord = z.infer<typeof teachingStaffRecordSchema>;

export const teachingAssignmentInputSchema = z.object({
  academicYearId: z.string().uuid(),
  gradeSectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable().optional(),
});
export type TeachingAssignmentInput = z.infer<typeof teachingAssignmentInputSchema>;

export const teachingAssignmentSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  staffMemberId: opaqueIdSchema,
  academicYearId: opaqueIdSchema,
  gradeSectionId: opaqueIdSchema,
  subjectId: opaqueIdSchema,
  status: z.enum(["scheduled", "active", "ended"]),
  effectiveFromIso: z.string().datetime(),
  effectiveToIso: z.string().datetime().nullable(),
  version: z.number().int().positive(),
  /** How this row came to exist; immutable after creation. */
  provenance: z.enum(["manual", "import", "legacy_backfill"]),
  /** Public reference of the originating import batch or legacy assignment. */
  sourceRef: publicReferenceSchema.nullable(),
  createdReason: z.string().min(1),
  createdAtIso: z.string().datetime(),
  updatedByAccountId: opaqueIdSchema.nullable(),
});
export type TeachingAssignment = z.infer<typeof teachingAssignmentSchema>;

/** Principal-facing row: the non-login record plus its assignment history. */
export const teachingStaffRowSchema = z.object({
  staffMemberId: opaqueIdSchema,
  staffRef: publicReferenceSchema,
  displayName: z.string().min(1),
  title: z.string().nullable(),
  status: z.enum(["active", "suspended", "ended"]),
  /** Null for genuine non-login records; set only for historical people. */
  legacyAccountId: opaqueIdSchema.nullable(),
  assignments: z.array(z.object({
    id: opaqueIdSchema,
    ref: publicReferenceSchema,
    staffMemberId: opaqueIdSchema,
    academicYearId: opaqueIdSchema,
    gradeSectionId: opaqueIdSchema,
    subjectId: opaqueIdSchema,
    status: z.enum(["scheduled", "active", "ended"]),
    effectiveFromIso: z.string().datetime(),
    effectiveToIso: z.string().datetime().nullable(),
    version: z.number().int().positive(),
    provenance: z.enum(["manual", "import", "legacy_backfill"]),
    sourceRef: publicReferenceSchema.nullable(),
    createdReason: z.string().min(1),
    createdAtIso: z.string().datetime(),
    updatedByAccountId: opaqueIdSchema.nullable(),
    /** Resolved display labels from the server projection. */
    gradeLabel: z.string().nullable().optional(),
    sectionLabel: z.string().nullable().optional(),
    subjectName: z.string().nullable().optional(),
  })),
});
export type TeachingStaffRow = z.infer<typeof teachingStaffRowSchema>;

export const teachingStaffCreateInputSchema = z.object({
  displayName: z.string().min(2),
  title: z.string().min(1),
  reason: z.string().min(3),
});
export type TeachingStaffCreateInput = z.infer<typeof teachingStaffCreateInputSchema>;

export const teachingAssignmentCreateInputSchema = teachingAssignmentInputSchema.extend({
  staffMemberId: opaqueIdSchema,
  reason: z.string().min(3),
});
export type TeachingAssignmentCreateInput = z.infer<typeof teachingAssignmentCreateInputSchema>;

export const teachingAssignmentEndInputSchema = z.object({
  assignmentId: opaqueIdSchema,
  reason: z.string().min(3),
  expectedVersion: z.number().int().positive(),
});
export type TeachingAssignmentEndInput = z.infer<typeof teachingAssignmentEndInputSchema>;

/** Timetable period payload referencing a teaching assignment (not a grant). */
export const timetableAssignmentRefSchema = z.object({
  teachingAssignmentId: opaqueIdSchema.nullable(),
  /** Legacy rows may still carry the old staff-assignment reference. */
  legacyStaffAssignmentId: opaqueIdSchema.nullable().optional(),
});
export type TimetableAssignmentRef = z.infer<typeof timetableAssignmentRefSchema>;
