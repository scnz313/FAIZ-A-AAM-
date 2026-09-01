import { describe, expect, it } from "vitest";

import { FakeAuthProvider } from "@/lib/auth/provider";
import { isSameOrigin } from "@/lib/auth/identity-server";
import { safeAuthRedirect } from "@/lib/auth/redirect";

describe("server auth provider boundary", () => {
  it("creates provider-verification applicant invitations deterministically and de-duplicates contact", async () => {
    const provider = new FakeAuthProvider();
    const first = await provider.createApplicantUser({ email: "Applicant@Example.test", redirectTo: "https://school.test/auth/callback" });
    const second = await provider.createApplicantUser({ email: "applicant@example.test", redirectTo: "https://school.test/auth/callback" });
    expect(first).toEqual(second);
    expect(first.verificationRequired).toBe(true);
    expect(provider.applicantInvites.size).toBe(1);
  });

  it("keeps invite, recovery, and rollback calls behind the fake", async () => {
    const provider = new FakeAuthProvider();
    const invite = await provider.inviteUser({ email: "staff@example.test", redirectTo: "https://school.test/sign-in/invite" });
    await provider.sendRecovery({ email: "staff@example.test", redirectTo: "https://school.test/security" });
    await provider.deleteUser(invite.userId);
    expect(invite.providerRef).toMatch(/^fake-invite-/);
    expect(provider.recoveryEmails).toEqual(["staff@example.test"]);
    expect(provider.deletedUserIds).toEqual([invite.userId]);
  });

  it("allows missing/same Origin and rejects cross-origin auth POSTs", () => {
    expect(isSameOrigin("https://school.test/api/auth/recovery", null)).toBe(true);
    expect(isSameOrigin("https://school.test/api/auth/recovery", "https://school.test")).toBe(true);
    expect(isSameOrigin("http://localhost:3000/api/auth/recovery", "http://127.0.0.1:3000", "127.0.0.1:3000")).toBe(true);
    expect(isSameOrigin("https://school.test/api/auth/recovery", "https://evil.test", "school.test")).toBe(false);
    expect(isSameOrigin("https://school.test/api/auth/recovery", "not an origin")).toBe(false);
  });

  it("allows only approved post-authentication destinations", () => {
    expect(safeAuthRedirect("/portal/fees?year=2026", "/portal")).toBe("/portal/fees?year=2026");
    expect(safeAuthRedirect("/sign-in/invite?invitation=INV-1", "/portal")).toBe("/sign-in/invite?invitation=INV-1");
    expect(safeAuthRedirect("//evil.test", "/portal")).toBe("/portal");
    expect(safeAuthRedirect("/api/outbox", "/portal")).toBe("/portal");
    expect(safeAuthRedirect("https://evil.test/staff", "/portal")).toBe("/portal");
  });
});
