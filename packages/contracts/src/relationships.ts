import { z } from "zod";

import { staffProfileCodeSchema } from "./staff-profile-code";

/** Opaque internal identifiers are never used as display/search references. */
export const opaqueIdSchema = z.string().uuid();
export type OpaqueId = z.infer<typeof opaqueIdSchema>;

/** Non-sequential, human-readable references are separate from internal IDs. */
export const publicReferenceSchema = z.string().min(1);

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const PERSON_STATUSES = ["active", "inactive"] as const;
export const personStatusSchema = z.enum(PERSON_STATUSES);
export type PersonStatus = z.infer<typeof personStatusSchema>;

export const personSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  displayName: z.string().min(1),
  status: personStatusSchema,
});
export type Person = z.infer<typeof personSchema>;

export const USER_ACCOUNT_STATUSES = ["invited", "active", "suspended", "closed"] as const;
export const userAccountStatusSchema = z.enum(USER_ACCOUNT_STATUSES);
export type UserAccountStatus = z.infer<typeof userAccountStatusSchema>;

export const userAccountSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  personId: opaqueIdSchema,
  status: userAccountStatusSchema,
  verifiedAtIso: z.string().datetime().nullable(),
});
export type UserAccount = z.infer<typeof userAccountSchema>;

export const STAFF_ROLES = [
  "content_editor",
  "content_publisher",
  "admissions_officer",
  "admissions_approver",
  "finance_officer",
  "finance_approver",
  "result_entry_officer",
  "exam_reviewer",
  "result_publisher",
  "timetable_manager",
  "hr_reviewer",
  "hr_approver",
  "support_officer",
  "auditor",
  "system_administrator",
  /* Legacy roles retained for history/audit. They are non-assignable: no new
     grants or invitations may reference them. Teachers remain non-login
     school records (see teaching_assignments); students are school records
     linked to guardians and do not sign in. */
  "teacher",
] as const;
export const staffRoleSchema = z.enum(STAFF_ROLES);
export type StaffRole = z.infer<typeof staffRoleSchema>;

/**
 * Roles that may be granted to new accounts/invitations. Legacy roles below
 * are retained for history and audit but cannot be freshly assigned.
 */
export const ASSIGNABLE_STAFF_ROLES = STAFF_ROLES.filter(
  (role) => role !== "teacher",
) as readonly StaffRole[];
export const assignableStaffRoleSchema = z.enum(
  ASSIGNABLE_STAFF_ROLES as unknown as [StaffRole, ...StaffRole[]],
);
export type AssignableStaffRole = z.infer<typeof assignableStaffRoleSchema>;

/**
 * Role definitions that are legacy/non-assignable: no new grants or
 * invitations may reference them. `teacher` — teachers are non-login school
 * records (see teaching_assignments). `student` — students are school records
 * linked to guardians and do not sign in. Both are retained for history/audit.
 */
export const LEGACY_NON_ASSIGNABLE_ROLES = ["teacher", "student"] as const;
export type LegacyNonAssignableRole = (typeof LEGACY_NON_ASSIGNABLE_ROLES)[number];

/** True when a role code is legacy/non-assignable (no new grants/invitations). */
export function isLegacyStaffRole(role: string): boolean {
  return role === "teacher";
}

/** True when a role code (staff or family scope) is non-assignable. */
export function isNonAssignableRole(role: string): boolean {
  return (LEGACY_NON_ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

export const ROLE_NAMES = ["guardian", "student", ...STAFF_ROLES] as const;
export const roleNameSchema = z.enum(ROLE_NAMES);
export type RoleName = z.infer<typeof roleNameSchema>;

export const ROLE_GRANT_STATUSES = ["requested", "granted", "active", "revoked"] as const;
export const roleGrantStatusSchema = z.enum(ROLE_GRANT_STATUSES);
export type RoleGrantStatus = z.infer<typeof roleGrantStatusSchema>;

export const roleScopeSchema = z.object({
  academicYearIds: z.array(opaqueIdSchema),
  gradeSectionIds: z.array(opaqueIdSchema),
  subjectIds: z.array(opaqueIdSchema),
});

export const roleGrantSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  accountId: opaqueIdSchema,
  role: roleNameSchema,
  status: roleGrantStatusSchema,
  grantedByPersonId: opaqueIdSchema.nullable(),
  reason: z.string().min(1),
  scope: roleScopeSchema,
  effectiveFromIso: z.string().datetime(),
  effectiveToIso: z.string().datetime().nullable(),
});
export type RoleGrant = z.infer<typeof roleGrantSchema>;

export const STAFF_MEMBER_STATUSES = ["active", "suspended", "ended"] as const;
export const staffMemberStatusSchema = z.enum(STAFF_MEMBER_STATUSES);
export type StaffMemberStatus = z.infer<typeof staffMemberStatusSchema>;

export const staffMemberSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  personId: opaqueIdSchema,
  status: staffMemberStatusSchema,
  title: z.string().min(1),
  accessProfileCode: staffProfileCodeSchema.nullable().optional(),
  accessProfileVersion: z.number().int().nonnegative().nullable().optional(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const ASSIGNMENT_STATUSES = ["scheduled", "active", "ended"] as const;
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const staffAssignmentSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  staffMemberId: opaqueIdSchema,
  /* roleGrantId is nullable: teaching assignments are now independent of
     role grants because teachers are non-login school records. Legacy
     assignments may still reference a historical grant. */
  roleGrantId: opaqueIdSchema.nullable(),
  academicYearId: opaqueIdSchema,
  gradeSectionId: opaqueIdSchema,
  subjectId: opaqueIdSchema,
  subjectRef: publicReferenceSchema,
  subjectName: z.string().min(1),
  status: assignmentStatusSchema,
  effectiveFromIso: z.string().datetime(),
  effectiveToIso: z.string().datetime().nullable(),
});
export type StaffAssignment = z.infer<typeof staffAssignmentSchema>;

/* ------------------------------------------------------------------ */
/* Guardian, student, and school placement                            */
/* ------------------------------------------------------------------ */

export const GUARDIAN_STATUSES = ["active", "suspended", "ended"] as const;
export const guardianStatusSchema = z.enum(GUARDIAN_STATUSES);
export type GuardianStatus = z.infer<typeof guardianStatusSchema>;

export const guardianSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  personId: opaqueIdSchema,
  status: guardianStatusSchema,
});
export type Guardian = z.infer<typeof guardianSchema>;

export const STUDENT_STATUSES = ["active", "graduated", "withdrawn"] as const;
export const studentStatusSchema = z.enum(STUDENT_STATUSES);
export type StudentStatus = z.infer<typeof studentStatusSchema>;

export const studentSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  personId: opaqueIdSchema,
  status: studentStatusSchema,
  displayName: z.string().min(1),
});
export type Student = z.infer<typeof studentSchema>;

export const FAMILY_CAPABILITIES = ["academics", "finance", "documents", "notices", "profile"] as const;
export const familyCapabilitySchema = z.enum(FAMILY_CAPABILITIES);
export type FamilyCapability = z.infer<typeof familyCapabilitySchema>;

export const GUARDIAN_STUDENT_LINK_STATUSES = [
  "pending_verification",
  "active",
  "restricted",
  "ended",
  "rejected",
] as const;
export const guardianStudentLinkStatusSchema = z.enum(GUARDIAN_STUDENT_LINK_STATUSES);
export type GuardianStudentLinkStatus = z.infer<typeof guardianStudentLinkStatusSchema>;

export const LINK_VERIFICATION_SOURCES = [
  "staff_review",
  "enrollment_invitation",
  "imported_record",
  "guardian_request",
] as const;
export const linkVerificationSourceSchema = z.enum(LINK_VERIFICATION_SOURCES);
export type LinkVerificationSource = z.infer<typeof linkVerificationSourceSchema>;

export const guardianStudentLinkSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  guardianId: opaqueIdSchema,
  studentId: opaqueIdSchema,
  relationshipLabel: z.string().min(1),
  status: guardianStudentLinkStatusSchema,
  verificationSource: linkVerificationSourceSchema,
  approvedByPersonId: opaqueIdSchema.nullable(),
  approvedAtIso: z.string().datetime().nullable(),
  effectiveFromIso: z.string().datetime(),
  effectiveToIso: z.string().datetime().nullable(),
  restrictionReason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  contactPriority: z.number().int().positive(),
  isEmergencyContact: z.boolean(),
  isBillingContact: z.boolean(),
  capabilities: z.array(familyCapabilitySchema),
  version: z.number().int().positive(),
});
export type GuardianStudentLink = z.infer<typeof guardianStudentLinkSchema>;

export const ACADEMIC_YEAR_STATUSES = ["upcoming", "current", "historical", "closed"] as const;
export const academicYearStatusSchema = z.enum(ACADEMIC_YEAR_STATUSES);
export type AcademicYearStatus = z.infer<typeof academicYearStatusSchema>;

export const academicYearSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  label: z.string().min(1),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  status: academicYearStatusSchema,
});
export type AcademicYear = z.infer<typeof academicYearSchema>;

export const GRADE_SECTION_STATUSES = ["active", "archived"] as const;
export const gradeSectionStatusSchema = z.enum(GRADE_SECTION_STATUSES);
export type GradeSectionStatus = z.infer<typeof gradeSectionStatusSchema>;

export const gradeSectionSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  gradeLabel: z.string().min(1),
  sectionLabel: z.string().min(1),
  academicYearId: opaqueIdSchema,
  status: gradeSectionStatusSchema,
});
export type GradeSection = z.infer<typeof gradeSectionSchema>;

export const ENROLLMENT_STATUSES = ["pending", "active", "completed", "transferred", "withdrawn"] as const;
export const enrollmentStatusSchema = z.enum(ENROLLMENT_STATUSES);
export type EnrollmentStatus = z.infer<typeof enrollmentStatusSchema>;

export const enrollmentSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  studentId: opaqueIdSchema,
  academicYearId: opaqueIdSchema,
  gradeSectionId: opaqueIdSchema,
  status: enrollmentStatusSchema,
  effectiveFromIso: z.string().datetime(),
  effectiveToIso: z.string().datetime().nullable(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;

/* ------------------------------------------------------------------ */
/* Shared contexts                                                     */
/* ------------------------------------------------------------------ */

export const familyPortalContextSchema = z.object({
  accountId: opaqueIdSchema,
  guardianId: opaqueIdSchema.optional(),
  activeStudentId: opaqueIdSchema,
  activeEnrollmentId: opaqueIdSchema,
  academicYearId: opaqueIdSchema,
  allowedCapabilities: z.array(familyCapabilitySchema),
  relationshipVersion: z.number().int().positive(),
});
export type FamilyPortalContext = z.infer<typeof familyPortalContextSchema>;

export const staffWorkspaceContextSchema = z.object({
  accountId: opaqueIdSchema,
  staffMemberId: opaqueIdSchema,
  activeRoleGrantId: opaqueIdSchema,
  activeRole: staffRoleSchema,
  activeAssignmentIds: z.array(opaqueIdSchema),
  academicYearId: opaqueIdSchema,
});
export type StaffWorkspaceContext = z.infer<typeof staffWorkspaceContextSchema>;
