import {
  demoGradeSections,
  demoGuardians,
  demoRelationshipGraph,
} from "@/modules/relationships/demo";
import { demoNowIso } from "@/modules/demo/clock";
import { loadRelationshipStore } from "@/modules/services/family-context";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

export type GuardianContactRow = {
  contactId: string;
  channel: "email" | "sms";
  value: string;
  state: string;
  verifiedAt: string | null;
};

export type GuardianStudentRow = {
  studentId: string;
  displayName: string;
  classLabel: string;
  linkId: string;
  linkStatus: string;
};

export type GuardianClaimRow = {
  claimId: string;
  reference: string;
  status: string;
  channel: "email" | "sms";
  contactValue: string;
  expiresAt: string;
  dispatchedAt: string | null;
  claimedAt: string | null;
  lastDeliveryState: string | null;
  lastDeliveryError: string | null;
};

export type GuardianAccessState = "active" | "suspended" | "invited" | "expired" | "delivery_failed" | "no_contact" | "not_activated" | "revoked";

export type GuardianAdminRow = {
  guardianId: string;
  personId: string;
  displayName: string;
  givenName: string;
  familyName: string;
  status: string;
  contacts: GuardianContactRow[];
  students: GuardianStudentRow[];
  account: { accountId: string; status: string; lastSignInAt: string | null } | null;
  claim: GuardianClaimRow | null;
  accessState: GuardianAccessState;
};

export type GuardianActivationPreview = {
  valid: boolean;
  reason?: string;
  claimReference?: string;
  givenName?: string;
  familyName?: string;
  guardianDisplayName?: string;
  students?: Array<{ displayName: string; classLabel: string }>;
  expiresAt?: string;
};

type DemoGuardianState = {
  contacts: Record<string, GuardianContactRow[]>;
  claims: Record<string, GuardianClaimRow & { guardianId: string; contactId: string; token: string }>;
  activatedGuardianIds: string[];
  sequence: number;
};

const DEMO_GUARDIANS_KEY = sessionKey("guardian-activations");

function loadDemoState(): DemoGuardianState {
  return sessionGet<DemoGuardianState>(DEMO_GUARDIANS_KEY) ?? {
    contacts: {},
    claims: {},
    activatedGuardianIds: [],
    sequence: 1,
  };
}

function saveDemoState(state: DemoGuardianState): void {
  sessionSet(DEMO_GUARDIANS_KEY, state);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deriveGuardianAccessState(
  row: Omit<GuardianAdminRow, "accessState">,
  nowIso = new Date().toISOString(),
): GuardianAccessState {
  if (row.account?.status === "suspended" || row.account?.status === "closed") return "suspended";
  if (row.account?.status === "active") return "active";
  if (!row.contacts.some((contact) => contact.channel === "email" && contact.state !== "revoked")) return "no_contact";
  if (row.claim === null) return "not_activated";
  if (row.claim.status === "failed" || row.claim.lastDeliveryState === "failed") return "delivery_failed";
  if (row.claim.status === "expired" || (["pending", "dispatched"].includes(row.claim.status) && row.claim.expiresAt <= nowIso)) return "expired";
  if (row.claim.status === "pending" || row.claim.status === "dispatched") return "invited";
  if (row.claim.status === "revoked") return "revoked";
  if (row.claim.status === "claimed") return "active";
  return "not_activated";
}

function mapGuardianRow(value: Record<string, unknown>): GuardianAdminRow {
  const base = {
    guardianId: String(value.guardianId ?? ""),
    personId: String(value.personId ?? ""),
    displayName: String(value.displayName ?? "Unnamed guardian"),
    givenName: String(value.givenName ?? ""),
    familyName: String(value.familyName ?? ""),
    status: String(value.status ?? "active"),
    contacts: Array.isArray(value.contacts) ? value.contacts as GuardianContactRow[] : [],
    students: Array.isArray(value.students) ? value.students as GuardianStudentRow[] : [],
    account: value.account && typeof value.account === "object" ? value.account as GuardianAdminRow["account"] : null,
    claim: value.claim && typeof value.claim === "object" ? value.claim as GuardianClaimRow : null,
  };
  return { ...base, accessState: deriveGuardianAccessState(base) };
}

function demoRows(): GuardianAdminRow[] {
  const relationship = loadRelationshipStore();
  const activation = loadDemoState();
  return demoGuardians.map((guardian) => {
    const person = demoRelationshipGraph.people.find((candidate) => candidate.id === guardian.personId);
    const students = relationship.links
      .filter((link) => link.guardianId === guardian.id)
      .map((link) => {
        const student = relationship.students.find((candidate) => candidate.id === link.studentId);
        const enrollment = relationship.enrollments.find((candidate) => candidate.studentId === link.studentId && candidate.status === "active");
        const section = demoGradeSections.find((candidate) => candidate.id === enrollment?.gradeSectionId);
        return {
          studentId: link.studentId,
          displayName: student?.displayName ?? "Unnamed student",
          classLabel: section ? `${section.gradeLabel}-${section.sectionLabel}` : "No active class",
          linkId: link.id,
          linkStatus: link.status,
        };
      });
    const account = relationship.userAccounts.find((candidate) => candidate.personId === guardian.personId);
    const latestClaim = Object.values(activation.claims)
      .filter((claim) => claim.guardianId === guardian.id)
      .sort((left, right) => right.reference.localeCompare(left.reference))[0] ?? null;
    const base = {
      guardianId: guardian.id,
      personId: guardian.personId,
      displayName: person?.displayName ?? "Unnamed guardian",
      givenName: person?.givenName ?? "",
      familyName: person?.familyName ?? "",
      status: guardian.status,
      contacts: activation.contacts[guardian.id] ?? [],
      students,
      account: account || activation.activatedGuardianIds.includes(guardian.id)
        ? { accountId: account?.id ?? `demo-guardian-${guardian.id}`, status: "active", lastSignInAt: null }
        : null,
      claim: latestClaim === null ? null : {
        claimId: latestClaim.claimId,
        reference: latestClaim.reference,
        status: latestClaim.status,
        channel: latestClaim.channel,
        contactValue: latestClaim.contactValue,
        expiresAt: latestClaim.expiresAt,
        dispatchedAt: latestClaim.dispatchedAt,
        claimedAt: latestClaim.claimedAt,
        lastDeliveryState: latestClaim.lastDeliveryState,
        lastDeliveryError: latestClaim.lastDeliveryError,
      },
    };
    return { ...base, accessState: deriveGuardianAccessState(base, demoNowIso()) };
  });
}

async function demoActivate(guardianId: string, contactId: string): Promise<{ claimReference: string; expiresAt: string }> {
  const state = loadDemoState();
  const contact = (state.contacts[guardianId] ?? []).find((candidate) => candidate.contactId === contactId && candidate.state !== "revoked");
  if (contact === undefined) throw new Error("Record an email contact before sending activation.");
  const suffix = String(state.sequence).padStart(4, "0");
  const reference = `GCL-2026-${suffix}`;
  const token = `GUARDIAN-DEMO-TOKEN-${guardianId}-${suffix}`;
  const now = demoNowIso();
  const expiresAt = new Date(new Date(now).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  state.claims[reference] = {
    claimId: `demo-claim-${suffix}`,
    reference,
    status: "dispatched",
    channel: "email",
    contactValue: contact.value,
    expiresAt,
    dispatchedAt: now,
    claimedAt: null,
    lastDeliveryState: "sent",
    lastDeliveryError: null,
    guardianId,
    contactId,
    token,
  };
  state.sequence += 1;
  saveDemoState(state);
  return { claimReference: reference, expiresAt };
}

export function demoGuardianActivationPreview(token: string): GuardianActivationPreview {
  const match = /^GUARDIAN-DEMO-TOKEN-([0-9a-f-]{36})-\d{4}$/i.exec(token);
  const row = match ? demoRows().find((candidate) => candidate.guardianId === match[1]) : undefined;
  if (!row) return { valid: false, reason: "claim not found" };
  return {
    valid: true,
    claimReference: "Demo activation",
    givenName: row.givenName,
    familyName: row.familyName,
    guardianDisplayName: row.displayName,
    students: row.students.map(({ displayName, classLabel }) => ({ displayName, classLabel })),
    expiresAt: new Date(new Date(demoNowIso()).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export const guardiansService = {
  async list(): Promise<GuardianAdminRow[]> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<Record<string, unknown>[]>("guardians.adminList");
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Guardians could not be loaded.");
      return result.value.map(mapGuardianRow);
    }
    return clone(demoRows());
  },

  async recordContact(input: { guardianId: string; value: string; reason: string }): Promise<void> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall("guardians.recordContact", { ...input, channel: "email" });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Email contact could not be recorded.");
      return;
    }
    const state = loadDemoState();
    const value = input.value.trim().toLowerCase();
    const contacts = state.contacts[input.guardianId] ?? [];
    const existing = contacts.find((contact) => contact.value === value);
    if (existing) existing.state = "recorded";
    else contacts.push({ contactId: `demo-contact-${input.guardianId}-${contacts.length + 1}`, channel: "email", value, state: "recorded", verifiedAt: null });
    state.contacts[input.guardianId] = contacts;
    saveDemoState(state);
  },

  async activate(input: { guardianId: string; contactId: string; reason: string }) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ claimReference: string; expiresAt: string }>("guardians.activate", input);
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Activation could not be sent.");
      return result.value;
    }
    return demoActivate(input.guardianId, input.contactId);
  },

  async resend(input: { claimReference: string; reason: string }) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ claimReference: string; expiresAt: string }>("guardians.activationResend", input);
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Activation could not be resent.");
      return result.value;
    }
    const state = loadDemoState();
    const claim = state.claims[input.claimReference];
    if (!claim || claim.status === "claimed") throw new Error("That activation cannot be resent.");
    claim.status = "revoked";
    saveDemoState(state);
    return demoActivate(claim.guardianId, claim.contactId);
  },

  async revoke(input: { claimReference: string; reason: string }): Promise<void> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall("guardians.activationRevoke", input);
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Activation could not be revoked.");
      return;
    }
    const state = loadDemoState();
    const claim = state.claims[input.claimReference];
    if (!claim || claim.status === "claimed") throw new Error("That activation cannot be revoked.");
    claim.status = "revoked";
    saveDemoState(state);
  },

  async preview(token: string): Promise<GuardianActivationPreview> {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<Record<string, unknown>>("guardianClaims.preview", { token });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Activation could not be checked.");
      return result.value as GuardianActivationPreview;
    }
    const state = loadDemoState();
    const claim = Object.values(state.claims).find((candidate) => candidate.token === token);
    if (!claim) return { valid: false, reason: "claim not found" };
    if (claim.status === "claimed") return { valid: false, reason: "claim has already been used" };
    if (claim.status === "revoked") return { valid: false, reason: "claim has been revoked" };
    if (claim.expiresAt <= demoNowIso()) return { valid: false, reason: "claim has expired" };
    const row = demoRows().find((candidate) => candidate.guardianId === claim.guardianId);
    return {
      valid: true,
      claimReference: claim.reference,
      givenName: row?.givenName ?? "",
      familyName: row?.familyName ?? "",
      guardianDisplayName: row?.displayName ?? "Guardian",
      students: row?.students.map(({ displayName, classLabel }) => ({ displayName, classLabel })) ?? [],
      expiresAt: claim.expiresAt,
    };
  },

  async accept(input: { token: string; givenName: string; familyName: string }): Promise<void> {
    if (clientAdapterMode() === "supabase") {
      const response = await fetch("/api/auth/guardian-claim-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; errors?: Array<{ message?: string }> } | null;
      if (!response.ok || result?.ok !== true) throw new Error(result?.errors?.[0]?.message ?? "Activation could not be completed.");
      return;
    }
    const state = loadDemoState();
    const claim = Object.values(state.claims).find((candidate) => candidate.token === input.token);
    if (!claim || claim.status !== "dispatched") throw new Error("That activation is not available.");
    claim.status = "claimed";
    claim.claimedAt = demoNowIso();
    if (!state.activatedGuardianIds.includes(claim.guardianId)) state.activatedGuardianIds.push(claim.guardianId);
    saveDemoState(state);
  },
};
