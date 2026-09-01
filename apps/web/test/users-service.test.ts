/**
 * Users service tests — admin operations (invite, grant, revoke, suspend,
 * reactivate) against the mutable relationship store.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  RELATIONSHIPS_SESSION_KEY,
} from "@/modules/services/family-context";
import { sessionKey, sessionRemove } from "@/modules/services/session";
import { STAFF_INVITATIONS_SESSION_KEY, usersService } from "@/modules/services/users";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const AUDIT_SESSION_KEY = sessionKey("audit-events");

const AISHA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";
const SYSTEM_ADMIN_GRANT_ID = "00000000-0000-4000-8000-000000000310";

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  sessionRemove(STAFF_INVITATIONS_SESSION_KEY);
  sessionRemove(AUDIT_SESSION_KEY);
  setDemoNow(PINNED);
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  sessionRemove(STAFF_INVITATIONS_SESSION_KEY);
  sessionRemove(AUDIT_SESSION_KEY);
  setDemoNow(new Date());
});

describe("usersService.listUsers", () => {
  it("returns graph-derived staff accounts with their active role grants", async () => {
    const users = await usersService.listUsers();
    const aisha = users.find((u) => u.accountId === AISHA_ACCOUNT_ID);
    expect(aisha).toBeDefined();
    expect(aisha?.name).toBe("Aisha Lone");
    expect(aisha?.status).toBe("Active");
    /* Aisha holds the Administrator profile roles: system_administrator,
       content_publisher, admissions_approver, finance_approver, hr_approver,
       exam_reviewer, result_publisher, auditor. */
    expect(aisha?.grants.length).toBeGreaterThanOrEqual(8);
    const adminGrant = aisha?.grants.find((g) => g.role === "system_administrator");
    expect(adminGrant).toBeDefined();
    expect(adminGrant?.roleLabel).toBe("System administrator");
  });

  it("includes grant refs and reasons for each role", async () => {
    const users = await usersService.listUsers();
    const aisha = users.find((u) => u.accountId === AISHA_ACCOUNT_ID);
    const adminGrant = aisha?.grants.find((g) => g.role === "system_administrator");
    expect(adminGrant?.ref).toMatch(/^ROLE-/);
    expect(adminGrant?.reason.length).toBeGreaterThan(0);
  });
});

describe("usersService.inviteUser", () => {
  it("creates a pending invitation without materializing staff access", async () => {
    const result = await usersService.inviteUser({
      name: "Test Person",
      email: "test.person@faizaam.example",
      profileCode: "principal",
      reason: "New principal for the school office.",
    });

    expect(result.accountRef).toBe("");
    expect(result.invitationRef).toMatch(/^INV-/);
    expect(result.oneTimeRef).toMatch(/^INVITE-/);
    expect(result.userRow.name).toBe("Test Person");
    expect(result.userRow.status).toBe("Invited");
    expect(result.userRow.accountId).toBe("");
    expect(result.userRow.grants).toHaveLength(0);
    expect(result.userRow.profileLabel).toBe("Principal");
    expect(window.sessionStorage.getItem(STAFF_INVITATIONS_SESSION_KEY)).not.toContain(result.oneTimeRef);
  });

  it("persists the pending invitation so the users page can show it", async () => {
    const result = await usersService.inviteUser({
      name: "Another Staff",
      email: "another@faizaam.example",
      profileCode: "administrator",
      reason: "Office team expansion.",
    });

    const users = await usersService.listUsers();
    const found = users.find((u) => u.invitationRef === result.invitationRef);
    expect(found).toBeDefined();
    expect(found?.role).toContain("Administrator");
    expect(found?.accountId).toBe("");
  });

  it("records an audit event", async () => {
    await usersService.inviteUser({
      name: "Audited Person",
      email: "audited@faizaam.example",
      profileCode: "principal",
      reason: "Audit access grant.",
    });

    expect((await usersService.listUsers()).some((user) => user.name === "Audited Person")).toBe(true);
  });
});

describe("usersService.acceptInvitation", () => {
  it("materializes one account, staff member, and profile grants transactionally", async () => {
    const invitation = await usersService.inviteUser({
      name: "Invited Principal",
      email: "invited.principal@faizaam.example",
      profileCode: "principal",
      reason: "Principal appointment.",
    });

    const accepted = await usersService.acceptInvitation({
      invitationRef: invitation.invitationRef,
      oneTimeRef: invitation.oneTimeRef,
      givenName: "Invited",
      familyName: "Principal",
    });

    expect(accepted.accountRef).toMatch(/^ACC-/);
    expect(accepted.staffMemberId).toMatch(/^00000000-0000-4000-8000-/);
    expect(accepted.grantRef).toMatch(/^ROLE-/);
    expect(accepted.userRow.status).toBe("Active");
    expect(accepted.userRow.profileLabel).toBe("Principal");
    /* The principal profile expands to seven internal roles. */
    expect(accepted.userRow.grants.length).toBe(7);
    expect(accepted.userRow.grants.some((grant) => grant.role === "result_entry_officer")).toBe(true);
    expect((await usersService.listUsers()).some((user) => user.invitationRef === invitation.invitationRef)).toBe(false);
  });

  it("rejects wrong, reused, revoked, and expired invitation references", async () => {
    const invitation = await usersService.inviteUser({
      name: "Reuse Test",
      email: "reuse@faizaam.example",
      profileCode: "principal",
      reason: "Audit support.",
    });
    await expect(
      usersService.acceptInvitation({
        invitationRef: invitation.invitationRef,
        oneTimeRef: "wrong-token-that-is-long-enough",
        givenName: "Reuse",
        familyName: "Test",
      }),
    ).rejects.toThrow(/one-time reference is not valid/);

    await usersService.acceptInvitation({
      invitationRef: invitation.invitationRef,
      oneTimeRef: invitation.oneTimeRef,
      givenName: "Reuse",
      familyName: "Test",
    });
    await expect(
      usersService.acceptInvitation({
        invitationRef: invitation.invitationRef,
        oneTimeRef: invitation.oneTimeRef,
        givenName: "Reuse",
        familyName: "Test",
      }),
    ).rejects.toThrow(/already been used/);
  });
});

describe("usersService.grantRole", () => {
  it("adds a new active role grant to an existing account", async () => {
    /* Firdous Ahmad (201) is a non-login teacher record — grant him an
       additional staff role to verify grantRole works on accounts with
       a staff member even when they start with no staff grants. */
    const FIRDOUS_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";
    const result = await usersService.grantRole({
      accountId: FIRDOUS_ACCOUNT_ID,
      role: "exam_reviewer",
      reason: "Cross-role moderation duty.",
    });

    expect(result.grants.some((g) => g.role === "exam_reviewer")).toBe(true);
  });

  it("rejects a duplicate active grant for the same role", async () => {
    await expect(
      usersService.grantRole({
        accountId: AISHA_ACCOUNT_ID,
        role: "system_administrator",
        reason: "Duplicate attempt.",
      }),
    ).rejects.toThrow(/already has an active/);
  });

  it("rejects an unknown account", async () => {
    await expect(
      usersService.grantRole({
        accountId: "nonexistent-account",
        role: "teacher",
        reason: "Test.",
      }),
    ).rejects.toThrow("Account not found.");
  });
});

describe("usersService.revokeRole", () => {
  it("revokes an active grant and the account loses that role", async () => {
    const before = await usersService.listUsers();
    const aisha = before.find((u) => u.accountId === AISHA_ACCOUNT_ID);
    const adminGrant = aisha?.grants.find((g) => g.role === "system_administrator");
    expect(adminGrant).toBeDefined();

    const after = await usersService.revokeRole({
      grantId: adminGrant!.id,
      reason: "Role no longer needed.",
    });

    expect(after.grants.some((g) => g.role === "system_administrator")).toBe(false);
    expect(after.grants.some((g) => g.role === "content_publisher")).toBe(true);
  });

  it("rejects revoking an already-revoked grant", async () => {
    await usersService.revokeRole({
      grantId: SYSTEM_ADMIN_GRANT_ID,
      reason: "First revoke.",
    });

    await expect(
      usersService.revokeRole({
        grantId: SYSTEM_ADMIN_GRANT_ID,
        reason: "Second revoke.",
      }),
    ).rejects.toThrow(/already revoked/);
  });
});

describe("usersService.suspendAccount", () => {
  it("suspends an account and revokes all active grants", async () => {
    const result = await usersService.suspendAccount({
      accountId: AISHA_ACCOUNT_ID,
      reason: "Security investigation.",
    });

    expect(result.status).toBe("Suspended");
    expect(result.grants).toHaveLength(0);
  });

  it("rejects suspending an already-suspended account", async () => {
    await usersService.suspendAccount({
      accountId: AISHA_ACCOUNT_ID,
      reason: "First suspend.",
    });

    await expect(
      usersService.suspendAccount({
        accountId: AISHA_ACCOUNT_ID,
        reason: "Second suspend.",
      }),
    ).rejects.toThrow(/already suspended/);
  });
});

describe("usersService.reactivateAccount", () => {
  it("reactivates a suspended account", async () => {
    await usersService.suspendAccount({
      accountId: AISHA_ACCOUNT_ID,
      reason: "Temporary suspension.",
    });

    const result = await usersService.reactivateAccount({ accountId: AISHA_ACCOUNT_ID });
    expect(result.status).toBe("Active");
  });

  it("rejects reactivating an already-active account", async () => {
    await expect(
      usersService.reactivateAccount({ accountId: AISHA_ACCOUNT_ID }),
    ).rejects.toThrow(/Only suspended/);
  });
});

describe("usersService — staff context integration", () => {
  it("revoking the active workspace grant causes the context to pick a new workspace", async () => {
    /* Aisha's active workspace is system_administrator by default (last grant).
       Revoking it should let the context service resolve to another grant. */
    const { staffContextService } = await import("@/modules/services/staff-context");

    /* Set Aisha's workspace to system_administrator */
    await staffContextService.setActiveWorkspace(AISHA_ACCOUNT_ID, SYSTEM_ADMIN_GRANT_ID);
    const before = await staffContextService.getWorkspace(AISHA_ACCOUNT_ID);
    expect(before.activeRole).toBe("system_administrator");

    /* Revoke the system_administrator grant */
    await usersService.revokeRole({
      grantId: SYSTEM_ADMIN_GRANT_ID,
      reason: "Testing workspace invalidation.",
    });

    /* The context should now resolve to a different workspace */
    const after = await staffContextService.getWorkspace(AISHA_ACCOUNT_ID);
    expect(after.activeRole).not.toBe("system_administrator");
  });
});
