import { describe, expect, it } from "vitest";

import {
  profileMakerCheckerError,
  profileRoleCoverageError,
  STAFF_PROFILE_CODES,
  STAFF_PROFILE_ROLES,
  staffInvitationProfileInputSchema,
  staffProfileCodeSchema,
} from "./staff-access";
import { ASSIGNABLE_STAFF_ROLES, isLegacyStaffRole, STAFF_ROLES } from "./relationships";

const UUID = "3f8b0b1e-2c7a-4f4d-9e1e-6a2c1f9d4b0a";

describe("staff profile contracts", () => {
  it("defines exactly the two agreed profiles", () => {
    expect(STAFF_PROFILE_CODES).toEqual(["administrator", "principal"]);
    for (const code of STAFF_PROFILE_CODES) {
      expect(staffProfileCodeSchema.parse(code)).toBe(code);
    }
    expect(staffProfileCodeSchema.safeParse("teacher").success).toBe(false);
  });

  it("covers every assignable internal role exactly once", () => {
    expect(profileRoleCoverageError()).toBeNull();
    const covered = Object.values(STAFF_PROFILE_ROLES).flat();
    expect([...covered].sort()).toEqual([...ASSIGNABLE_STAFF_ROLES].sort());
  });

  it("keeps every maker/checker pair in separate profiles", () => {
    expect(profileMakerCheckerError()).toBeNull();
  });

  it("grants account management only to the administrator profile", () => {
    expect(STAFF_PROFILE_ROLES.administrator).toContain("system_administrator");
    expect(STAFF_PROFILE_ROLES.principal).not.toContain("system_administrator");
  });

  it("gives result entry to the principal profile and approval/publication to administrator", () => {
    expect(STAFF_PROFILE_ROLES.principal).toContain("result_entry_officer");
    expect(STAFF_PROFILE_ROLES.administrator).toContain("exam_reviewer");
    expect(STAFF_PROFILE_ROLES.administrator).toContain("result_publisher");
    expect(STAFF_PROFILE_ROLES.principal).not.toContain("exam_reviewer");
    expect(STAFF_PROFILE_ROLES.principal).not.toContain("result_publisher");
  });

  it("keeps timetable management with the principal profile", () => {
    expect(STAFF_PROFILE_ROLES.principal).toContain("timetable_manager");
    expect(STAFF_PROFILE_ROLES.administrator).not.toContain("timetable_manager");
  });

  it("marks teacher as a legacy non-assignable role", () => {
    expect(STAFF_ROLES).toContain("teacher");
    expect(isLegacyStaffRole("teacher")).toBe(true);
    expect(isLegacyStaffRole("system_administrator")).toBe(false);
    expect(ASSIGNABLE_STAFF_ROLES).not.toContain("teacher");
  });
});

describe("staffInvitationProfileInputSchema", () => {
  const base = {
    contact: "principal@faizaam.example",
    displayName: "New Principal",
    profileCode: "principal" as const,
    reason: "Approved principal appointment.",
    expiresAt: "2026-12-01T00:00:00.000Z",
  };

  it("parses a principal invitation", () => {
    const parsed = staffInvitationProfileInputSchema.parse(base);
    expect(parsed.profileCode).toBe("principal");
  });

  it("parses an administrator invitation", () => {
    expect(
      staffInvitationProfileInputSchema.parse({ ...base, profileCode: "administrator" }).profileCode,
    ).toBe("administrator");
  });

  it("rejects the legacy teacher profile code", () => {
    expect(staffInvitationProfileInputSchema.safeParse({ ...base, profileCode: "teacher" }).success).toBe(false);
  });

  it("rejects an invalid profile code", () => {
    expect(staffInvitationProfileInputSchema.safeParse({ ...base, profileCode: "superuser" }).success).toBe(false);
  });

  it("rejects a short reason and a stale expiry", () => {
    expect(staffInvitationProfileInputSchema.safeParse({ ...base, reason: "ok" }).success).toBe(false);
    expect(staffInvitationProfileInputSchema.safeParse({ ...base, expiresAt: "2020-01-01T00:00:00.000Z" }).success).toBe(false);
  });
});
