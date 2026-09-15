// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardianActivationEmail, guardianWelcomeEmail } from "@/lib/email/templates";

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://school.example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("guardian activation emails", () => {
  it("renders the signed activation link, reference, expiry and linked student names", () => {
    const actionLink = "https://provider.example.test/verify?token=secret";
    const { subject, html } = guardianActivationEmail({
      reference: "GCL-2026-1234567890",
      actionLink,
      expiresAt: "2026-10-01T12:00:00.000Z",
      guardianName: "Test Guardian",
      studentNames: ["Student One", "Student Two"],
    });

    expect(subject).toBe("Activate your Faiz E Aam School family portal access");
    expect(html).toContain(`href="${actionLink}"`);
    expect(html).toContain("GCL-2026-1234567890");
    expect(html).toContain("Student One");
    expect(html).toContain("Student Two");
    expect(html).toContain("Asia/Kolkata");
    expect(html).not.toContain("—");
  });

  it("renders the welcome template with an authenticated portal link", () => {
    const { subject, html } = guardianWelcomeEmail({ guardianName: "Test Guardian", studentNames: ["Student One"] });
    expect(subject).toBe("Welcome to the Faiz E Aam School family portal");
    expect(html).toContain("Student One");
    expect(html).toContain("href=\"https://school.example.test/portal\"");
  });
});
