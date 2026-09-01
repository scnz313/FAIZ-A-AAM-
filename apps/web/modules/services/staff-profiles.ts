/**
 * Staff access profile policy (provisioning presets). Profiles are display
 * and provisioning concepts; server authorization always evaluates active
 * granular role grants, AAL2, assignment scope, and maker/checker identity.
 * This module powers the staff-access UI and the demo adapter only.
 *
 * The signed-in product exposes exactly two staff portals: Administrator
 * and Principal. Teachers are non-login school records.
 */

import {
  profileMakerCheckerError,
  profileRoleCoverageError,
  STAFF_PROFILE_CODES,
  STAFF_PROFILE_ROLES,
  type StaffProfileCode,
  type StaffProfileSummary,
} from "@fass/contracts";

import type { StaffAction } from "./staff-authorization";
import { canRole } from "./staff-authorization";

const PROFILE_META: Readonly<Record<StaffProfileCode, { label: string; description: string; version: number }>> = {
  administrator: {
    label: "Administrator",
    description:
      "Manages accounts, configuration, import/export, audit, and guardian-access approval, and performs final admissions, finance, HR, content, and result decisions.",
    version: 1,
  },
  principal: {
    label: "Principal",
    description:
      "Handles daily admissions, careers, finance operations, result entry/import, timetable management, content drafting, and support.",
    version: 1,
  },
};

export const STAFF_PROFILE_LIST: readonly StaffProfileCode[] = STAFF_PROFILE_CODES;

export function rolesForProfile(profileCode: StaffProfileCode): readonly string[] {
  return STAFF_PROFILE_ROLES[profileCode];
}

export function inferStaffProfile(roles: ReadonlyArray<string>): StaffProfileCode | null {
  const actual = [...new Set(roles)].sort();
  return STAFF_PROFILE_CODES.find((profileCode) => {
    const expected = [...STAFF_PROFILE_ROLES[profileCode]].sort();
    return expected.length === actual.length && expected.every((role, index) => role === actual[index]);
  }) ?? null;
}

export function profileLabel(profileCode: StaffProfileCode | null | undefined): string | null {
  if (profileCode === null || profileCode === undefined) return null;
  return PROFILE_META[profileCode]?.label ?? profileCode;
}

export function profileSummary(profileCode: StaffProfileCode): StaffProfileSummary {
  const meta = PROFILE_META[profileCode];
  return {
    code: profileCode,
    label: meta.label,
    description: meta.description,
    roles: [...STAFF_PROFILE_ROLES[profileCode]],
    version: meta.version,
  };
}

export function listProfileSummaries(): StaffProfileSummary[] {
  return STAFF_PROFILE_CODES.map(profileSummary);
}

/** True when any of the account's active role grants can perform the action. */
export function canAnyRole(roles: ReadonlyArray<string | undefined>, action: StaffAction): boolean {
  return roles.some((role) => role !== undefined && canRole(role, action));
}

/** The first active role that can perform the action, or null. */
export function roleForAction(roles: ReadonlyArray<string | undefined>, action: StaffAction): string | null {
  return roles.find((role) => role !== undefined && canRole(role, action)) ?? null;
}

/** Consistency guard used by the invite/change UI before calling the service. */
export function validateProfileInvitation(input: {
  profileCode: StaffProfileCode;
}): string | null {
  if (profileRoleCoverageError() !== null || profileMakerCheckerError() !== null) {
    return "The staff profile configuration is inconsistent — contact the school office.";
  }
  return null;
}
