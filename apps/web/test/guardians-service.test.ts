import { describe, expect, it } from "vitest";

import { deriveGuardianAccessState, type GuardianAdminRow } from "@/modules/services/guardians";

const NOW = "2026-09-16T00:00:00.000Z";

function row(overrides: Partial<Omit<GuardianAdminRow, "accessState">> = {}): Omit<GuardianAdminRow, "accessState"> {
  return {
    guardianId: "guardian-1",
    personId: "person-1",
    displayName: "Test Guardian",
    givenName: "Test",
    familyName: "Guardian",
    status: "active",
    contacts: [{ contactId: "contact-1", channel: "email", value: "guardian@example.test", state: "recorded", verifiedAt: null }],
    students: [],
    account: null,
    claim: null,
    ...overrides,
  };
}

describe("guardian access state derivation", () => {
  it.each([
    ["active account", row({ account: { accountId: "account-1", status: "active", lastSignInAt: null } }), "active"],
    ["suspended account", row({ account: { accountId: "account-1", status: "suspended", lastSignInAt: null } }), "suspended"],
    ["closed account", row({ account: { accountId: "account-1", status: "closed", lastSignInAt: null } }), "suspended"],
    ["missing email", row({ contacts: [] }), "no_contact"],
    ["recorded email only", row(), "not_activated"],
    ["dispatched claim", row({ claim: { claimId: "claim-1", reference: "GCL-1", status: "dispatched", channel: "email", contactValue: "guardian@example.test", expiresAt: "2026-09-20T00:00:00.000Z", dispatchedAt: NOW, claimedAt: null, lastDeliveryState: "sent", lastDeliveryError: null } }), "invited"],
    ["overdue claim", row({ claim: { claimId: "claim-1", reference: "GCL-1", status: "dispatched", channel: "email", contactValue: "guardian@example.test", expiresAt: "2026-09-15T00:00:00.000Z", dispatchedAt: NOW, claimedAt: null, lastDeliveryState: "sent", lastDeliveryError: null } }), "expired"],
    ["failed delivery", row({ claim: { claimId: "claim-1", reference: "GCL-1", status: "dispatched", channel: "email", contactValue: "guardian@example.test", expiresAt: "2026-09-20T00:00:00.000Z", dispatchedAt: NOW, claimedAt: null, lastDeliveryState: "failed", lastDeliveryError: "Provider rejected delivery" } }), "delivery_failed"],
    ["revoked claim", row({ claim: { claimId: "claim-1", reference: "GCL-1", status: "revoked", channel: "email", contactValue: "guardian@example.test", expiresAt: "2026-09-20T00:00:00.000Z", dispatchedAt: NOW, claimedAt: null, lastDeliveryState: "sent", lastDeliveryError: null } }), "revoked"],
  ] as const)("maps %s to %s", (_label, input, expected) => {
    expect(deriveGuardianAccessState(input, NOW)).toBe(expected);
  });
});
