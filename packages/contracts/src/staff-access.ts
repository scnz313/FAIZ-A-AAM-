/**
 * Staff access profiles (provisioning presets, never an authorization
 * shortcut). The signed-in product exposes exactly two staff portals:
 * Administrator and Principal. Each profile expands into the canonical
 * internal role grants defined in `relationships.ts`. Server authorization
 * always evaluates the active granular grants, AAL2, assignment scope, and
 * maker/checker actor identity.
 *
 * Teachers are not a portal profile. They remain non-login school records
 * for timetable and subject attribution (see teaching_assignments).
 */

import { z } from "zod";

import { STAFF_PROFILE_CODES, staffProfileCodeSchema, type StaffProfileCode } from "./staff-profile-code";
import { ASSIGNABLE_STAFF_ROLES, opaqueIdSchema, STAFF_ROLES, type StaffRole } from "./relationships";

export { STAFF_PROFILE_CODES, staffProfileCodeSchema } from "./staff-profile-code";
export type { StaffProfileCode } from "./staff-profile-code";

/**
 * Canonical profile → internal role expansion. Changes land here and in the
 * matching seed migration; there is no runtime profile builder.
 *
 * Administrator — accounts, configuration, import/export, audit, guardian-
 * access approval, final admission/finance/HR decisions, content approval,
 * and result checking/publication. Does not originate Principal maker work.
 *
 * Principal — daily admissions, careers, finance operations/reconciliation,
 * result entry/import, timetable management, content/notices drafting, and
 * support. Cannot manage staff access/system settings, run protected bulk
 * exports, or perform final checker actions.
 */
export const STAFF_PROFILE_ROLES: Readonly<Record<StaffProfileCode, readonly StaffRole[]>> = {
  administrator: [
    "system_administrator",
    "content_publisher",
    "admissions_approver",
    "finance_approver",
    "hr_approver",
    "exam_reviewer",
    "result_publisher",
    "auditor",
  ],
  principal: [
    "content_editor",
    "admissions_officer",
    "finance_officer",
    "hr_reviewer",
    "result_entry_officer",
    "timetable_manager",
    "support_officer",
  ],
};

/**
 * Every assignable internal staff role must belong to exactly one profile.
 * Legacy non-assignable roles (teacher) are intentionally excluded from
 * coverage — they are retained for history/audit only.
 */
export function profileRoleCoverageError(): string | null {
  const covered = new Set<string>();
  for (const roles of Object.values(STAFF_PROFILE_ROLES)) {
    for (const role of roles) {
      if (covered.has(role)) return `Role ${role} is granted by more than one profile.`;
      covered.add(role);
    }
  }
  for (const role of ASSIGNABLE_STAFF_ROLES) {
    if (!covered.has(role)) return `Role ${role} is not covered by any profile.`;
  }
  return null;
}

const MAKER_CHECKER_PAIRS: ReadonlyArray<readonly [StaffRole, StaffRole]> = [
  ["content_editor", "content_publisher"],
  ["admissions_officer", "admissions_approver"],
  ["finance_officer", "finance_approver"],
  ["hr_reviewer", "hr_approver"],
  ["result_entry_officer", "exam_reviewer"],
  ["result_entry_officer", "result_publisher"],
  /* exam_reviewer → result_publisher is intentionally NOT a profile-level
     pair: the plan permits the same independent Administrator to move a
     submitted Principal sheet through both moderation and publication.
     The actor-level no-self-approval rule is enforced server-side. */
];

/** No single profile may contain both sides of a maker/checker pair. */
export function profileMakerCheckerError(): string | null {
  for (const [profileCode, roles] of Object.entries(STAFF_PROFILE_ROLES)) {
    const roleSet = new Set(roles);
    for (const [maker, checker] of MAKER_CHECKER_PAIRS) {
      if (roleSet.has(maker) && roleSet.has(checker)) {
        return `Profile ${profileCode} combines maker ${maker} and checker ${checker}.`;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Catalog and assignment contracts                                    */
/* ------------------------------------------------------------------ */

/**
 * Teaching assignment input for non-login teacher records. Used by the
 * Principal's teaching-assignment workspace, not by staff invitation flows.
 * The canonical schemas live in `teaching-assignments.ts`.
 */
export { teachingAssignmentInputSchema } from "./teaching-assignments";
export type { TeachingAssignmentInput } from "./teaching-assignments";

/**
 * Aggregate staff portal context for a signed-in staff account. Profile
 * accounts expose `profileCode` plus EVERY active role grant; granular
 * workspace selection is nullable and exists only for identified legacy
 * accounts. Server authorization still evaluates each active granular grant,
 * AAL2, record scope, and maker/checker actor identity.
 */
export const staffPortalContextSchema = z.object({
  accountId: opaqueIdSchema,
  staffMemberId: opaqueIdSchema,
  personId: opaqueIdSchema,
  displayName: z.string().min(1),
  title: z.string().nullable(),
  /** Null for legacy/custom accounts pending reconciliation. */
  profileCode: staffProfileCodeSchema.nullable(),
  profileLabel: z.string().nullable(),
  profileVersion: z.number().int().nonnegative().nullable(),
  /** Every active role grant code — aggregate UI checks use this list. */
  roles: z.array(z.enum(STAFF_ROLES)),
  /** The legacy active granular grant; null for profile accounts. */
  activeRoleGrantId: opaqueIdSchema.nullable(),
  activeRole: z.enum(STAFF_ROLES).nullable(),
  academicYearId: opaqueIdSchema.nullable(),
});
export type StaffPortalContext = z.infer<typeof staffPortalContextSchema>;

export const staffProfileSummarySchema = z.object({
  code: staffProfileCodeSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  roles: z.array(z.enum(STAFF_ROLES)),
  version: z.number().int().nonnegative(),
});
export type StaffProfileSummary = z.infer<typeof staffProfileSummarySchema>;

export const staffInvitationProfileInputSchema = z.object({
  contact: z.string().email(),
  displayName: z.string().min(2),
  title: z.string().min(1).optional(),
  profileCode: staffProfileCodeSchema,
  reason: z.string().min(3),
  expiresAt: z.string().datetime().refine((value) => new Date(value).getTime() > Date.now(), "invitation expiry must be in the future"),
});
export type StaffInvitationProfileInput = z.infer<typeof staffInvitationProfileInputSchema>;

export const staffProfileChangeInputSchema = z.object({
  accountId: z.string().uuid(),
  profileCode: staffProfileCodeSchema,
  reason: z.string().min(3),
  expectedVersion: z.number().int().nonnegative(),
});
export type StaffProfileChangeInput = z.infer<typeof staffProfileChangeInputSchema>;

export const staffProfileGrantOutputSchema = z.object({
  id: z.string().uuid(),
  ref: z.string().min(1),
  role: z.enum(STAFF_ROLES),
  status: z.enum(["requested", "granted", "active", "revoked"]),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
  version: z.number().int().nonnegative(),
});
export type StaffProfileGrantOutput = z.infer<typeof staffProfileGrantOutputSchema>;

export const staffDirectoryProfileRowSchema = z.object({
  accountId: z.string().uuid(),
  staffMemberId: z.string().uuid(),
  displayName: z.string().min(1),
  title: z.string().nullable(),
  profileCode: staffProfileCodeSchema.nullable(),
  profileLabel: z.string().nullable(),
  profileVersion: z.number().int().nonnegative().nullable(),
  status: z.enum(["invited", "active", "suspended", "closed"]),
  verifiedContact: z.string().nullable(),
  grants: z.array(staffProfileGrantOutputSchema),
});
export type StaffDirectoryProfileRow = z.infer<typeof staffDirectoryProfileRowSchema>;
