import { describe, expect, it } from "vitest";

import {
  canAnyRole,
  inferStaffProfile,
  listProfileSummaries,
  profileSummary,
  roleForAction,
  rolesForProfile,
  STAFF_PROFILE_LIST,
  validateProfileInvitation,
} from "@/modules/services/staff-profiles";

describe("staff profile policy", () => {
  it("lists exactly the two agreed profiles with labels", () => {
    expect(STAFF_PROFILE_LIST).toEqual(["administrator", "principal"]);
    const summaries = listProfileSummaries();
    expect(summaries.map((summary) => summary.label)).toEqual(["Administrator", "Principal"]);
    for (const summary of summaries) {
      expect(summary.roles.length).toBeGreaterThan(0);
    }
  });

  it("expands each profile into its internal roles", () => {
    expect(rolesForProfile("administrator")).toContain("system_administrator");
    expect(rolesForProfile("administrator")).toContain("result_publisher");
    expect(rolesForProfile("principal")).toContain("result_entry_officer");
    expect(rolesForProfile("principal")).toContain("timetable_manager");
  });

  it("infers a profile only from an exact complete role set", () => {
    expect(inferStaffProfile(rolesForProfile("administrator"))).toBe("administrator");
    expect(inferStaffProfile(rolesForProfile("principal"))).toBe("principal");
    expect(inferStaffProfile(["finance_officer"])).toBeNull();
  });

  it("grants users.manage only to the administrator profile", () => {
    expect(canAnyRole(rolesForProfile("administrator"), "users.manage")).toBe(true);
    expect(canAnyRole(rolesForProfile("principal"), "users.manage")).toBe(false);
  });

  it("never lets one profile approve its own maker work", () => {
    const approvals: Array<[string, string]> = [
      ["content.publish", "content.draft"],
      ["admissions.approve", "admissions.review"],
      ["finance.approve", "finance.operate"],
      ["careers.approve", "careers.review"],
      ["results.publish", "results.enter"],
      ["results.approve", "results.enter"],
      /* results.publish vs results.approve is intentionally NOT checked
         here: the plan permits the same independent Administrator to move
         a submitted Principal sheet through both moderation and publication.
         The actor-level no-self-approval rule is enforced server-side. */
    ];
    for (const [checker, maker] of approvals) {
      for (const profile of STAFF_PROFILE_LIST) {
        const roles = rolesForProfile(profile);
        expect(canAnyRole(roles, checker as never) && canAnyRole(roles, maker as never)).toBe(false);
      }
    }
  });

  it("gives result entry to principal and approval/publication to administrator", () => {
    const principal = rolesForProfile("principal");
    const administrator = rolesForProfile("administrator");
    expect(canAnyRole(principal, "results.enter")).toBe(true);
    expect(canAnyRole(principal, "results.approve")).toBe(false);
    expect(canAnyRole(principal, "results.publish")).toBe(false);
    expect(canAnyRole(administrator, "results.approve")).toBe(true);
    expect(canAnyRole(administrator, "results.publish")).toBe(true);
    expect(canAnyRole(administrator, "results.enter")).toBe(false);
  });

  it("aggregates capability across every role in the profile", () => {
    const principal = rolesForProfile("principal");
    expect(canAnyRole(principal, "admissions.view")).toBe(true);
    expect(canAnyRole(principal, "admissions.review")).toBe(true);
    expect(canAnyRole(principal, "admissions.approve")).toBe(false);
    expect(canAnyRole(principal, "content.view")).toBe(true);
    expect(canAnyRole(principal, "content.draft")).toBe(true);
    expect(canAnyRole(principal, "content.publish")).toBe(false);
  });

  it("resolves the first role that can perform an action", () => {
    expect(roleForAction(rolesForProfile("principal"), "results.enter")).toBe("result_entry_officer");
    expect(roleForAction(rolesForProfile("administrator"), "users.manage")).toBe("system_administrator");
    expect(roleForAction(rolesForProfile("principal"), "users.manage")).toBeNull();
  });

  it("reports profile summaries without exposing authorization state", () => {
    expect(profileSummary("administrator").version).toBeGreaterThanOrEqual(1);
    expect(profileSummary("principal").roles.length).toBeGreaterThan(0);
  });
});

describe("validateProfileInvitation", () => {
  it("accepts a principal profile", () => {
    expect(validateProfileInvitation({ profileCode: "principal" })).toBeNull();
  });

  it("accepts an administrator profile", () => {
    expect(validateProfileInvitation({ profileCode: "administrator" })).toBeNull();
  });
});
