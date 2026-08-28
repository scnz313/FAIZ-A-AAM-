/**
 * Typed users-service boundary for the staff users page.
 *
 * Account rows are derived from the mutable relationship store (people, user
 * accounts, staff members, and role grants) so admin operations — invite,
 * grant/revoke role, suspend/reactivate — persist in the demo session and are
 * visible to every consumer. Emails, last-activity labels, and 2FA states are
 * fictional (the graph carries no contact or security details). Role labels
 * come from the shared staff-context label map so the page never resolves
 * roles itself.
 */

import { type RoleGrant, type StaffRole, STAFF_ROLES } from "@fass/contracts";

import { formatKolkata } from "@/modules/iot/domain";
import { demoNowIso } from "@/modules/demo/clock";
import {
  loadRelationshipStore,
  saveRelationshipStore,
  type RelationshipDemoStore,
} from "@/modules/services/family-context";
import { roleLabel } from "@/modules/services/staff-context";
import { auditService } from "@/modules/services/audit";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

export type UserStatus = "Active" | "Invited" | "Suspended" | "Expired";

export type UserRow = {
  key: string;
  accountId: string;
  invitationRef?: string;
  name: string;
  /** Display role label; an account with several grants lists them all. */
  role: string;
  email: string;
  status: UserStatus;
  lastActiveLabel: string;
  twoFa: string;
  /** All active role grants for this account. */
  grants: Array<{ id: string; ref: string; role: StaffRole; roleLabel: string; reason: string }>;
};

/** Canonical staff roles available for grant — sourced from the contracts. */
export const GRANTABLE_ROLES: readonly StaffRole[] = STAFF_ROLES;

export type StaffInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type StaffInvitationRecord = {
  invitationRef: string;
  oneTimeHash: string;
  contact: string;
  displayName: string;
  role: StaffRole;
  reason: string;
  expiresAtIso: string;
  status: StaffInvitationStatus;
  accountId: string | null;
  acceptedAtIso: string | null;
};

export const STAFF_INVITATIONS_SESSION_KEY = sessionKey("staff-invitations");

function loadStaffInvitations(): StaffInvitationRecord[] {
  const stored = sessionGet<Array<StaffInvitationRecord & { oneTimeRef?: string }>>(STAFF_INVITATIONS_SESSION_KEY) ?? [];
  let changed = false;
  const normalized = stored.map((record) => {
    const { oneTimeRef: _legacyPlaintext, ...withoutPlaintext } = record;
    if (record.oneTimeHash === undefined || _legacyPlaintext !== undefined) {
      changed = true;
      return {
        ...withoutPlaintext,
        oneTimeHash: record.oneTimeHash ?? "",
        status: record.status === "pending" && record.oneTimeHash === undefined ? "expired" : record.status,
      } as StaffInvitationRecord;
    }
    return withoutPlaintext as StaffInvitationRecord;
  });
  if (changed) saveStaffInvitations(normalized);
  return normalized;
}

function saveStaffInvitations(value: StaffInvitationRecord[]): void {
  sessionSet(STAFF_INVITATIONS_SESSION_KEY, value);
}

async function hashInvitationSecret(value: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type ServerUserRow = {
  id: string;
  status: string;
  verified_contact: string | null;
  mfa_status?: string | null;
  mfa_verified_at?: string | null;
  people: { display_name: string | null } | null;
  staff_members: Array<{ id: string; reference: string; title: string | null; employment_status: string }> | null;
  role_grants: Array<{
    id: string;
    reference: string;
    role_code: string;
    status: string;
    version: number;
    effective_from: string;
    effective_to: string | null;
    reason?: string | null;
  }> | null;
  account_invitations?: Array<{ reference: string; contact: string; status: string; expires_at: string; provider_state: string; role_code?: string; reason?: string | null }> | null;
};

function isServerMode(): boolean {
  return clientAdapterMode() === "supabase";
}

function toUserStatus(status: string): UserStatus {
  if (status === "suspended") return "Suspended";
  if (status === "invited" || status === "pending") return "Invited";
  if (status === "expired") return "Expired";
  return "Active";
}

function mapServerUser(row: ServerUserRow): UserRow {
  const invitation = row.account_invitations?.[0];
  const grants = (row.role_grants ?? []).filter((grant) => grant.role_code !== "guardian" && grant.role_code !== "student");
  const active = grants.filter((grant) => grant.status === "active");
  const name = row.people?.display_name ?? "Invited staff";
  const status = toUserStatus(row.status);
  const invited = row.id === "" || row.status === "invited";
  const mfaStatus = row.mfa_status === "enrolled" || row.mfa_status === "verified"
    ? "Enabled"
    : row.mfa_status === "required" || row.mfa_status === "pending"
      ? "Pending setup"
      : invited
        ? "Not applicable until acceptance"
        : "Not recorded";
  return {
    key: invited ? `invitation-${invitation?.reference ?? name}` : `account-${row.id}`,
    accountId: invited ? "" : row.id,
    invitationRef: invitation?.reference,
    name,
    role: active.length > 0 ? active.map((grant) => roleLabel(grant.role_code as StaffRole)).join(" · ") : invitation?.role_code ? roleLabel(invitation.role_code as StaffRole) : "No active roles",
    email: row.verified_contact ?? invitation?.contact ?? "",
    status,
    lastActiveLabel: "—",
    twoFa: mfaStatus,
    grants: grants
      .filter((grant) => grant.status === "active")
      .map((grant) => ({
        id: grant.id,
        ref: grant.reference,
        role: grant.role_code as StaffRole,
        roleLabel: roleLabel(grant.role_code as StaffRole),
        reason: grant.reason ?? "",
      })),
  };
}

async function serverListUsers(): Promise<UserRow[]> {
  const result = await adapterCall<ServerUserRow[]>("users.list");
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "Directory unavailable.");
  return result.value.map(mapServerUser);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isEffective(fromIso: string, toIso: string | null, atIso: string): boolean {
  return fromIso <= atIso && (toIso === null || atIso < toIso);
}

/** Fictional email derived from the person's name (the graph stores no contact). */
function emailForPerson(givenName: string, familyName: string): string {
  const slug = `${givenName}.${familyName}`.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  return `${slug}@faizaam.example`;
}

/** Fictional last-active label for graph-derived accounts. */
const GRAPH_LAST_ACTIVE = formatKolkata("2026-08-03T02:10:00Z", { format: "short" });

/**
 * Build user rows from the mutable store: every account that has an active
 * staff member and at least one non-guardian/non-student role grant (active
 * or revoked — revoked grants are shown for history).
 */
function deriveStoreUsers(store: RelationshipDemoStore): UserRow[] {
  const nowIso = demoNowIso();
  const rows: UserRow[] = [];

  for (const account of store.userAccounts) {
    const staff = store.staffMembers.find((candidate) => candidate.personId === account.personId);
    if (staff === undefined) continue;

    const grants = store.roleGrants.filter(
      (grant) =>
        grant.accountId === account.id &&
        grant.role !== "guardian" &&
        grant.role !== "student",
    );
    const activeGrants = grants.filter(
      (grant) =>
        grant.status === "active" && isEffective(grant.effectiveFromIso, grant.effectiveToIso, nowIso),
    );
    if (activeGrants.length === 0 && grants.length === 0) continue;

    const person = store.people.find((candidate) => candidate.id === account.personId);
    const name = person?.displayName ?? account.ref;
    const email = person ? emailForPerson(person.givenName, person.familyName) : `${account.ref.toLowerCase()}@faizaam.example`;

    const status: UserStatus =
      account.status === "suspended" ? "Suspended" :
      account.status === "invited" ? "Invited" : "Active";

    rows.push({
      key: `account-${account.id}`,
      accountId: account.id,
      name,
      role: activeGrants.length > 0
        ? activeGrants.map((grant) => roleLabel(grant.role)).join(" · ")
        : "No active roles",
      email,
      status,
      lastActiveLabel: status === "Invited" ? "—" : GRAPH_LAST_ACTIVE,
      twoFa: status === "Active" ? "Enabled" : "—",
      grants: grants
        .filter((grant) => grant.status === "active" && isEffective(grant.effectiveFromIso, grant.effectiveToIso, nowIso))
        .map((grant) => ({
          id: grant.id,
          ref: grant.ref,
          role: grant.role as StaffRole,
          roleLabel: roleLabel(grant.role),
          reason: grant.reason,
        })),
    });
  }
  return rows;
}

function invitationRow(invitation: StaffInvitationRecord): UserRow {
  return {
    key: `invitation-${invitation.invitationRef}`,
    accountId: invitation.accountId ?? "",
    invitationRef: invitation.invitationRef,
    name: invitation.displayName,
    role: roleLabel(invitation.role),
    email: invitation.contact,
    status: invitation.status === "expired" ? "Expired" : "Invited",
    lastActiveLabel: "—",
    twoFa: "—",
    grants: [],
  };
}

function listDemoUsers(): UserRow[] {
  const invitations = loadStaffInvitations();
  const nowIso = demoNowIso();
  let changed = false;
  for (const invitation of invitations) {
    if (invitation.status === "pending" && invitation.expiresAtIso <= nowIso) {
      invitation.status = "expired";
      changed = true;
    }
  }
  if (changed) saveStaffInvitations(invitations);
  return [
    ...deriveStoreUsers(loadRelationshipStore()),
    ...invitations.filter((invitation) => invitation.status === "pending" || invitation.status === "expired").map(invitationRow),
  ];
}

export interface InviteResult {
  accountRef: string;
  invitationRef: string;
  /** One-time invitation reference — shown once to the admin (demo). */
  oneTimeRef: string;
  userRow: UserRow;
}

export interface InviteAcceptanceResult {
  accountRef: string;
  staffMemberId: string;
  grantRef: string;
  userRow: UserRow;
}

export interface UsersService {
  /** Staff accounts with their active role grants. */
  listUsers(): Promise<UserRow[]>;
  /** Invite a new staff member — creates a person, account, staff member, and initial role grant. */
  inviteUser(input: { name: string; email: string; role: StaffRole; reason: string }): Promise<InviteResult>;
  /** Grant an additional role to an existing account. */
  grantRole(input: { accountId: string; role: StaffRole; reason: string }): Promise<UserRow>;
  /** Revoke a role grant — appends to history, does not delete. */
  revokeRole(input: { grantId: string; reason: string }): Promise<UserRow>;
  /** Suspend an account — revokes access immediately. */
  suspendAccount(input: { accountId: string; reason: string }): Promise<UserRow>;
  /** Reactivate a suspended account. */
  reactivateAccount(input: { accountId: string }): Promise<UserRow>;
  /** Materialize an invited staff account exactly once. */
  acceptInvitation(input: {
    invitationRef: string;
    /** Demo-only legacy token. Supabase mode uses the verified Auth invite session. */
    oneTimeRef?: string;
    givenName: string;
    familyName: string;
  }): Promise<InviteAcceptanceResult>;
}

function nextRef(prefix: string, counter: number): string {
  return `${prefix}-2026-${String(counter).padStart(4, "0")}`;
}

function nextId(base: string, counter: number): string {
  /* Deterministic demo IDs in the reserved range (300+). */
  const num = 300 + counter;
  return `00000000-0000-4000-8000-${String(num).padStart(12, "0")}`;
}

function findUserRow(store: RelationshipDemoStore, accountId: string): UserRow {
  const rows = deriveStoreUsers(store);
  const row = rows.find((candidate) => candidate.accountId === accountId);
  if (row === undefined) {
    throw new Error("Account not found or has no staff role.");
  }
  return row;
}

export const usersService: UsersService = {
  async listUsers() {
    if (isServerMode()) return serverListUsers();
    return clone(listDemoUsers());
  },

  async inviteUser({ name, email, role, reason }) {
    if (isServerMode()) {
      /* The live staff invitation stores the intended role/scope and
         materializes the account only when the invitee accepts it. */
      const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const result = await adapterCall<{ invitationRef: string; status: "pending"; expiresAt: string }>("staffInvites.create", {
        contact: email.trim(),
        expiresAt: expires,
        displayName: name.trim(),
        roleCode: role,
        reason: reason.trim() || `Invited as ${roleLabel(role)}.`,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Invitation could not be created.");
      /* A placeholder row keeps the caller's contract: the invited person
         appears as Invited with no grants until they accept the invitation. */
      const placeholder: UserRow = {
        key: `invite-${email.trim().toLowerCase()}`,
        accountId: "",
        name: name.trim(),
        role: roleLabel(role),
        email: email.trim(),
        status: "Invited",
        lastActiveLabel: "—",
        twoFa: "Not applicable until acceptance",
        grants: [],
      };
      return {
        accountRef: "",
        invitationRef: result.value.invitationRef,
        oneTimeRef: "",
        userRow: placeholder,
      };
    }
    const contact = email.trim().toLowerCase();
    const displayName = name.trim();
    const cleanReason = reason.trim() || `Invited as ${roleLabel(role)}.`;
    const invitations = loadStaffInvitations();
    const existing = invitations.find(
      (invitation) => invitation.status === "pending" && invitation.contact === contact && invitation.role === role,
    );
    if (existing !== undefined) {
      return {
        accountRef: "",
        invitationRef: existing.invitationRef,
        oneTimeRef: "",
        userRow: invitationRow(existing),
      };
    }

    const sequence = 500 + invitations.length + 1;
    const oneTimeRef = `INVITE-${String(sequence).padStart(4, "0")}-${"demo".repeat(4)}`;
    const invitation: StaffInvitationRecord = {
      invitationRef: `INV-2026-${String(sequence).padStart(4, "0")}`,
      oneTimeHash: await hashInvitationSecret(oneTimeRef),
      contact,
      displayName,
      role,
      reason: cleanReason,
      expiresAtIso: new Date(new Date(demoNowIso()).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      accountId: null,
      acceptedAtIso: null,
    };
    invitations.push(invitation);
    saveStaffInvitations(invitations);

    await auditService.record({
      actor: "System administrator",
      action: "Staff invitation created",
      target: invitation.invitationRef,
      outcome: "Success",
      reason: cleanReason,
    });

    return {
      accountRef: "",
      invitationRef: invitation.invitationRef,
      oneTimeRef,
      userRow: invitationRow(invitation),
    };
  },

  async acceptInvitation({ invitationRef, oneTimeRef, givenName, familyName }) {
    if (isServerMode()) {
      const response = await fetch("/api/auth/staff-invite-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitationReference: invitationRef.trim(),
          givenName: givenName.trim(),
          familyName: familyName.trim(),
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; value?: { accountId: string; staffMemberId: string; grantRef: string; roleCode?: string }; errors?: Array<{ message?: string }> } | null;
      if (!response.ok || result?.ok !== true || result.value === undefined) {
        throw new Error(result?.errors?.[0]?.message ?? "Invitation acceptance failed.");
      }
      const userRow: UserRow = {
        key: `account-${result.value.accountId}`,
        accountId: result.value.accountId,
        name: `${givenName.trim()} ${familyName.trim()}`,
        role: result.value.roleCode ? roleLabel(result.value.roleCode as StaffRole) : "Staff workspace",
        email: "Verified invitation contact",
        status: "Active",
        lastActiveLabel: "—",
        twoFa: "Pending setup",
        grants: result.value.roleCode ? [{ id: "", ref: result.value.grantRef, role: result.value.roleCode as StaffRole, roleLabel: roleLabel(result.value.roleCode as StaffRole), reason: "Invitation acceptance" }] : [],
      };
      return {
        accountRef: result.value.accountId,
        staffMemberId: result.value.staffMemberId,
        grantRef: result.value.grantRef,
        userRow,
      };
    }

    const reference = invitationRef.trim().toUpperCase();
    const token = oneTimeRef?.trim() ?? "";
    const first = givenName.trim();
    const last = familyName.trim();
    if (reference === "" || token === "" || first === "" || last === "") {
      throw new Error("Invitation reference, one-time reference, and both names are required.");
    }

    const invitations = loadStaffInvitations();
    const invitation = invitations.find((candidate) => candidate.invitationRef === reference);
    if (invitation === undefined) throw new Error("That invitation could not be found.");
    if (invitation.status === "accepted") throw new Error("That invitation has already been used.");
    if (invitation.status === "revoked") throw new Error("That invitation has been revoked.");
    if (invitation.status === "expired" || invitation.expiresAtIso <= demoNowIso()) {
      invitation.status = "expired";
      saveStaffInvitations(invitations);
      throw new Error("That invitation has expired. Ask the school office for a new one.");
    }
    if ((await hashInvitationSecret(token)) !== invitation.oneTimeHash) throw new Error("The one-time reference is not valid.");
    if (invitations.some((candidate) => candidate.status === "accepted" && candidate.contact === invitation.contact)) {
      throw new Error("An account already exists for this invitation contact.");
    }

    const store = loadRelationshipStore();
    const nowIso = demoNowIso();
    const personId = nextId("person", store.accountCounter);
    const accountId = nextId("account", store.accountCounter);
    const staffId = nextId("staff", store.staffCounter);
    const grantId = nextId("grant", store.grantCounter);
    const person = {
      id: personId,
      ref: nextRef("PER", store.accountCounter),
      givenName: first,
      familyName: last,
      displayName: `${first} ${last}`,
      status: "active" as const,
    };
    const account = {
      id: accountId,
      ref: nextRef("ACC", store.accountCounter),
      personId,
      status: "active" as const,
      verifiedAtIso: nowIso,
    };
    const staff = {
      id: staffId,
      ref: nextRef("STF", store.staffCounter),
      personId,
      status: "active" as const,
      title: roleLabel(invitation.role),
    };
    const grant: RoleGrant = {
      id: grantId,
      ref: nextRef("ROLE", store.grantCounter),
      accountId,
      role: invitation.role,
      status: "active",
      grantedByPersonId: null,
      reason: invitation.reason,
      scope: { academicYearIds: [], gradeSectionIds: [], subjectIds: [] },
      effectiveFromIso: nowIso,
      effectiveToIso: null,
    };
    store.people.push(person);
    store.userAccounts.push(account);
    store.staffMembers.push(staff);
    store.roleGrants.push(grant);
    store.accountCounter += 1;
    store.staffCounter += 1;
    store.grantCounter += 1;
    invitation.status = "accepted";
    invitation.accountId = accountId;
    invitation.acceptedAtIso = nowIso;
    saveRelationshipStore(store);
    saveStaffInvitations(invitations);

    await auditService.record({
      actor: person.displayName,
      action: "Staff invitation accepted",
      target: invitation.invitationRef,
      outcome: "Success",
      reason: invitation.reason,
    });

    return {
      accountRef: account.ref,
      staffMemberId: staff.id,
      grantRef: grant.ref,
      userRow: clone(findUserRow(store, accountId)),
    };
  },

  async grantRole({ accountId, role, reason }) {
    if (isServerMode()) {
      const result = await adapterCall<{ grantRef: string }>("users.grantRole", {
        accountId,
        roleCode: role,
        reason: reason.trim() || `Granted ${roleLabel(role)}.`,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Grant failed.");
      const rows = await serverListUsers();
      const row = rows.find((candidate) => candidate.accountId === accountId);
      if (row === undefined) throw new Error("Account not found after grant.");
      return row;
    }
    const store = loadRelationshipStore();
    const account = store.userAccounts.find((candidate) => candidate.id === accountId);
    if (account === undefined) {
      throw new Error("Account not found.");
    }

    /* Duplicate-active-grant guard: don't create a second active grant for the same role. */
    const existing = store.roleGrants.find(
      (grant) => grant.accountId === accountId && grant.role === role && grant.status === "active",
    );
    if (existing !== undefined) {
      throw new Error(`This account already has an active ${roleLabel(role)} grant.`);
    }

    const grantId = nextId("grant", store.grantCounter);
    const nowIso = demoNowIso();
    const grant: RoleGrant = {
      id: grantId,
      ref: nextRef("ROLE", store.grantCounter),
      accountId,
      role,
      status: "active",
      grantedByPersonId: null,
      reason: reason.trim() || `Granted ${roleLabel(role)} role.`,
      scope: { academicYearIds: [], gradeSectionIds: [], subjectIds: [] },
      effectiveFromIso: nowIso,
      effectiveToIso: null,
    };

    store.roleGrants.push(grant);
    store.grantCounter += 1;
    saveRelationshipStore(store);

    const userRow = findUserRow(store, accountId);

    await auditService.record({
      actor: "System administrator",
      action: "Setting changed",
      target: `Granted ${roleLabel(role)} to ${userRow.name}`,
      outcome: "Success",
      reason: reason.trim() || `Grant ${grant.ref}.`,
    });

    return clone(userRow);
  },

  async revokeRole({ grantId, reason }) {
    if (isServerMode()) {
      /* The server command needs the grant's optimistic version; the page
         supplies grants from users.list, so re-read to find it. */
      const rowsBefore = await serverListUsers();
      const target = rowsBefore
        .flatMap((row) => row.grants.map((grant) => ({ accountId: row.accountId, ...grant })))
        .find((grant) => grant.id === grantId);
      if (target === undefined) throw new Error("Role grant not found.");
      const versionResult = await adapterCall<
        Array<{ id: string; role_grants?: Array<{ id: string; version: number }> }>
      >("users.list");
      const version =
        versionResult.ok
          ? versionResult.value
              .flatMap((account) => account.role_grants ?? [])
              .find((grant) => grant.id === grantId)?.version ?? 1
          : 1;
      const result = await adapterCall<unknown>("users.revokeRole", {
        grantId,
        reason: reason.trim() || "Revoked by administrator.",
        expectedVersion: version,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Revoke failed.");
      const rowsAfter = await serverListUsers();
      const row = rowsAfter.find((candidate) => candidate.accountId === target.accountId);
      if (row === undefined) throw new Error("Account not found after revoke.");
      return row;
    }
    const store = loadRelationshipStore();
    const grant = store.roleGrants.find((candidate) => candidate.id === grantId);
    if (grant === undefined) {
      throw new Error("Role grant not found.");
    }
    if (grant.status === "revoked") {
      throw new Error("This grant is already revoked.");
    }

    grant.status = "revoked";
    grant.effectiveToIso = demoNowIso();
    saveRelationshipStore(store);

    /* If the revoked grant was the active workspace, clear it so the context service picks a new one. */
    delete store.activeWorkspaceByAccount[grant.accountId];
    saveRelationshipStore(store);

    const userRow = findUserRow(store, grant.accountId);

    await auditService.record({
      actor: "System administrator",
      action: "Setting changed",
      target: `Revoked ${roleLabel(grant.role)} from ${userRow.name}`,
      outcome: "Success",
      reason: reason.trim() || `Revoke ${grant.ref}.`,
    });

    return clone(userRow);
  },

  async suspendAccount({ accountId, reason }) {
    if (isServerMode()) {
      const result = await adapterCall<unknown>("users.suspend", {
        accountId,
        reason: reason.trim() || "Account suspended by administrator.",
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Suspension failed.");
      const after = await serverListUsers();
      const updated = after.find((candidate) => candidate.accountId === accountId);
      if (updated === undefined) throw new Error("Account not found after suspension.");
      return updated;
    }
    const store = loadRelationshipStore();
    const account = store.userAccounts.find((candidate) => candidate.id === accountId);
    if (account === undefined) {
      throw new Error("Account not found.");
    }
    if (account.status === "suspended") {
      throw new Error("This account is already suspended.");
    }

    account.status = "suspended";
    /* Revoke all active role grants for this account. */
    const nowIso = demoNowIso();
    for (const grant of store.roleGrants) {
      if (grant.accountId === accountId && grant.status === "active") {
        grant.status = "revoked";
        grant.effectiveToIso = nowIso;
      }
    }
    delete store.activeWorkspaceByAccount[accountId];
    saveRelationshipStore(store);

    const userRow = findUserRow(store, accountId);

    await auditService.record({
      actor: "System administrator",
      action: "Setting changed",
      target: `Suspended ${userRow.name}`,
      outcome: "Success",
      reason: reason.trim() || `Account ${account.ref} suspended.`,
    });

    return clone(userRow);
  },

  async reactivateAccount({ accountId }) {
    if (isServerMode()) {
      const result = await adapterCall<unknown>("users.reactivate", {
        accountId,
        reason: "Account reactivated after access review.",
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Reactivation failed.");
      const rows = await serverListUsers();
      const updated = rows.find((candidate) => candidate.accountId === accountId);
      if (updated === undefined) throw new Error("Account not found after reactivation.");
      return updated;
    }
    const store = loadRelationshipStore();
    const account = store.userAccounts.find((candidate) => candidate.id === accountId);
    if (account === undefined) {
      throw new Error("Account not found.");
    }
    if (account.status !== "suspended") {
      throw new Error("Only suspended accounts can be reactivated.");
    }

    account.status = "active";
    saveRelationshipStore(store);

    const userRow = findUserRow(store, accountId);

    await auditService.record({
      actor: "System administrator",
      action: "Setting changed",
      target: `Reactivated ${userRow.name}`,
      outcome: "Success",
      reason: `Account ${account.ref} reactivated.`,
    });

    return clone(userRow);
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createUsersService = (): UsersService => usersService;
