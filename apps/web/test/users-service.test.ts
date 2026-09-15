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

/**
 * Seed a second active Administrator so last-Administrator protection
 * (mirrors migration 000056 §5, which serializes the same count for
 * staff_profile_change and accounts_suspend) allows operating on the seed
 * administrator account. Each test resets sessionStorage, so this is
 * per-scenario cover.
 */
async function seedCoverAdministrator(): Promise<void> {
  const invite = await usersService.inviteUser({
    name: "Cover Administrator",
    email: "cover.admin@faizaam.example",
    profileCode: "administrator",
    reason: "Last-administrator cover for this scenario.",
  });
  await usersService.acceptInvitation({
    invitationRef: invite.invitationRef,
    oneTimeRef: invite.oneTimeRef,
    givenName: "Cover",
    familyName: "Administrator",
  });
}

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
    await seedCoverAdministrator();
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
    await seedCoverAdministrator();
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
    await seedCoverAdministrator();
    const result = await usersService.suspendAccount({
      accountId: AISHA_ACCOUNT_ID,
      reason: "Security investigation.",
    });

    expect(result.status).toBe("Suspended");
    expect(result.grants).toHaveLength(0);
  });

  it("rejects suspending an already-suspended account", async () => {
    await seedCoverAdministrator();
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
    await seedCoverAdministrator();
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

describe("usersService — one portal profile per account (S4)", () => {
  it("refuses a grant from a second profile instead of mixing maker and checker roles", async () => {
    /* Aisha holds the Administrator profile — a Principal grant must not mix in. */
    await expect(
      usersService.grantRole({
        accountId: AISHA_ACCOUNT_ID,
        role: "content_editor",
        reason: "Cross-profile attempt.",
      }),
    ).rejects.toThrow(/profile/);
  });

  it("allows a second grant from the same profile", async () => {
    const FIRDOUS_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";
    const first = await usersService.grantRole({
      accountId: FIRDOUS_ACCOUNT_ID,
      role: "exam_reviewer",
      reason: "Moderation duty.",
    });
    expect(first.grants.some((g) => g.role === "exam_reviewer")).toBe(true);

    /* content_publisher shares the Administrator profile — same-profile growth is fine. */
    const second = await usersService.grantRole({
      accountId: FIRDOUS_ACCOUNT_ID,
      role: "content_publisher",
      reason: "Notice publishing.",
    });
    expect(second.grants.some((g) => g.role === "content_publisher")).toBe(true);

    /* But a Principal role on the now-Administrator account is refused. */
    await expect(
      usersService.grantRole({
        accountId: FIRDOUS_ACCOUNT_ID,
        role: "finance_officer",
        reason: "Cross-profile attempt.",
      }),
    ).rejects.toThrow(/profile/);
  });

  it("refuses legacy non-assignable roles", async () => {
    const FIRDOUS_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";
    await expect(
      usersService.grantRole({
        accountId: FIRDOUS_ACCOUNT_ID,
        role: "teacher",
        reason: "Legacy attempt.",
      }),
    ).rejects.toThrow(/history only/);
  });

  it("refuses grants on suspended accounts", async () => {
    await seedCoverAdministrator();
    await usersService.suspendAccount({ accountId: AISHA_ACCOUNT_ID, reason: "Suspension first." });
    await expect(
      usersService.grantRole({
        accountId: AISHA_ACCOUNT_ID,
        role: "auditor",
        reason: "Grant while suspended.",
      }),
    ).rejects.toThrow(/suspended/);
  });
});

describe("usersService — last-administrator protection (S4)", () => {
  it("blocks moving the last administrator to another profile", async () => {
    const users = await usersService.listUsers();
    const aisha = users.find((u) => u.accountId === AISHA_ACCOUNT_ID)!;
    await expect(
      usersService.changeProfile({
        accountId: AISHA_ACCOUNT_ID,
        profileCode: "principal",
        reason: "Orphan the admin profile.",
        expectedVersion: aisha.profileVersion ?? 1,
      }),
    ).rejects.toThrow(/last administrator/);
  });

  it("allows the move once a second administrator exists", async () => {
    const invite = await usersService.inviteUser({
      name: "Second Admin",
      email: "second.admin@faizaam.example",
      profileCode: "administrator",
      reason: "Admin cover.",
    });
    await usersService.acceptInvitation({
      invitationRef: invite.invitationRef,
      oneTimeRef: invite.oneTimeRef,
      givenName: "Second",
      familyName: "Admin",
    });

    const users = await usersService.listUsers();
    const aisha = users.find((u) => u.accountId === AISHA_ACCOUNT_ID)!;
    const moved = await usersService.changeProfile({
      accountId: AISHA_ACCOUNT_ID,
      profileCode: "principal",
      reason: "Planned rotation with cover in place.",
      expectedVersion: aisha.profileVersion ?? 1,
    });
    expect(moved.profileCode).toBe("principal");
    expect(moved.profileLabel).toBe("Principal");
  });

  it("blocks suspending the last administrator", async () => {
    await expect(
      usersService.suspendAccount({ accountId: AISHA_ACCOUNT_ID, reason: "Orphan the admin profile." }),
    ).rejects.toThrow(/last administrator/);
  });

  it("blocks revoking the last administrator's system_administrator grant", async () => {
    await expect(
      usersService.revokeRole({ grantId: SYSTEM_ADMIN_GRANT_ID, reason: "Orphan the admin profile." }),
    ).rejects.toThrow(/last administrator/);
  });

  it("allows suspension once a second administrator exists", async () => {
    await seedCoverAdministrator();
    const result = await usersService.suspendAccount({
      accountId: AISHA_ACCOUNT_ID,
      reason: "Planned rotation with cover in place.",
    });
    expect(result.status).toBe("Suspended");
  });
});

describe("usersService — invitation expiry and token binding (S4)", () => {
  it("expires a pending invitation after 14 days and rejects acceptance", async () => {
    const invite = await usersService.inviteUser({
      name: "Slow Joiner",
      email: "slow.joiner@faizaam.example",
      profileCode: "principal",
      reason: "Delayed joining.",
    });

    setDemoNow(new Date(PINNED.getTime() + 15 * 24 * 60 * 60 * 1000));
    await expect(
      usersService.acceptInvitation({
        invitationRef: invite.invitationRef,
        oneTimeRef: invite.oneTimeRef,
        givenName: "Slow",
        familyName: "Joiner",
      }),
    ).rejects.toThrow(/expired/);

    const users = await usersService.listUsers();
    expect(users.find((u) => u.invitationRef === invite.invitationRef)?.status).toBe("Expired");
  });

  it("rejects a one-time reference bound to a different invitation", async () => {
    const first = await usersService.inviteUser({
      name: "First Invitee",
      email: "first.invitee@faizaam.example",
      profileCode: "principal",
      reason: "First.",
    });
    const second = await usersService.inviteUser({
      name: "Second Invitee",
      email: "second.invitee@faizaam.example",
      profileCode: "principal",
      reason: "Second.",
    });

    await expect(
      usersService.acceptInvitation({
        invitationRef: first.invitationRef,
        oneTimeRef: second.oneTimeRef,
        givenName: "First",
        familyName: "Invitee",
      }),
    ).rejects.toThrow(/one-time reference is not valid/);
  });

  it("keeps a single identity per contact — a second invite cannot materialize another account", async () => {
    const first = await usersService.inviteUser({
      name: "Single Identity",
      email: "single.identity@faizaam.example",
      profileCode: "principal",
      reason: "First invite.",
    });
    const second = await usersService.inviteUser({
      name: "Single Identity",
      email: "single.identity@faizaam.example",
      profileCode: "administrator",
      reason: "Second invite, same contact.",
    });
    await usersService.acceptInvitation({
      invitationRef: first.invitationRef,
      oneTimeRef: first.oneTimeRef,
      givenName: "Single",
      familyName: "Identity",
    });
    await expect(
      usersService.acceptInvitation({
        invitationRef: second.invitationRef,
        oneTimeRef: second.oneTimeRef,
        givenName: "Single",
        familyName: "Identity",
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("usersService — revocation immediacy (S4)", () => {
  it("suspending an account denies its staff workspace on the next read", async () => {
    await seedCoverAdministrator();
    const { staffContextService } = await import("@/modules/services/staff-context");
    const { can } = await import("@/modules/services/staff-authorization");

    await usersService.suspendAccount({ accountId: AISHA_ACCOUNT_ID, reason: "Immediate denial." });
    await expect(staffContextService.getWorkspace(AISHA_ACCOUNT_ID)).rejects.toMatchObject({
      code: "account-not-found",
    });
    expect(await can(AISHA_ACCOUNT_ID, "content.publish")).toBe(false);
    expect(await can(AISHA_ACCOUNT_ID, "users.manage")).toBe(false);
  });
});

describe("usersService — staff context integration", () => {
  it("revoking the active workspace grant causes the context to pick a new workspace", async () => {
    /* Aisha's active workspace is system_administrator by default (last grant).
       Revoking it should let the context service resolve to another grant. */
    const { staffContextService } = await import("@/modules/services/staff-context");

    /* Set Aisha's workspace to system_administrator */
    await seedCoverAdministrator();
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
