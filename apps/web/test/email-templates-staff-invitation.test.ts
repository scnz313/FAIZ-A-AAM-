// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffInvitationEmail } from "@/lib/email/templates";

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://school.example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("staff invitation email", () => {
  it("renders the provider action link, reference, and no em dash", () => {
    const actionLink = "https://provider.example.test/verify?token=secret";
    const { subject, html } = staffInvitationEmail({
      reference: "INV-2026-14A5963F8B",
      actionLink,
      expiresAt: "2026-09-30T12:00:00.000Z",
      displayName: "Probe Invitee",
    });

    expect(subject).toBe("Your Faiz E Aam School staff account invitation");
    expect(html).toContain(`href="${actionLink}"`);
    expect(html).toContain("Accept invitation");
    expect(html).toContain("INV-2026-14A5963F8B");
    expect(html).toContain("Asia/Kolkata");
    expect(html).not.toContain("—");
  });
});
