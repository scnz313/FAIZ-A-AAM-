// @vitest-environment node

/**
 * Careers email templates are part of an email-only journey (owner
 * instruction, 11 September 2026): there is no applicant portal or status
 * route, so a job email must never carry a portal or status link.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jobApplicationStatusEmail, jobApplicationSubmittedEmail } from "@/lib/email/templates";

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://school.example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("email-only careers templates", () => {
  it("acknowledges submission without a status or portal link", () => {
    const { subject, html } = jobApplicationSubmittedEmail({ applicationRef: "JOB-2026-0116" });
    expect(subject).toContain("JOB-2026-0116");
    expect(html).toContain("JOB-2026-0116");
    expect(html).toMatch(/email/i);
    expect(html).not.toContain("/apply/job/");
    expect(html).not.toContain("/status");
    expect(html).not.toContain("/portal");
    expect(html).not.toContain("Open the school portal");
  });

  it("carries status changes by email without a portal link", () => {
    const { subject, html } = jobApplicationStatusEmail({ applicationRef: "JOB-2026-0116" });
    expect(subject).toContain("JOB-2026-0116");
    expect(html).toMatch(/every update arrives by email/i);
    expect(html).not.toContain("/apply/job/");
    expect(html).not.toContain("/status");
    expect(html).not.toContain("/portal");
    expect(html).not.toContain("Open the school portal");
  });

  it("includes the HR decision reason in a rejection email", () => {
    const { subject, html } = jobApplicationStatusEmail({
      applicationRef: "JOB-2026-0116",
      status: "not_selected",
      reason: "We required a B.Ed. qualification for this position.",
    });
    expect(subject).toContain("JOB-2026-0116");
    expect(html).toContain("We required a B.Ed. qualification for this position.");
    expect(html).toContain("The reason recorded by the school");
  });

  it("carries the reason for interview and offer stages too", () => {
    for (const status of ["shortlisted", "interview", "offered"] as const) {
      const { html } = jobApplicationStatusEmail({ applicationRef: "JOB-2026-0116", status, reason: `Reason for ${status}` });
      expect(html).toContain(`Reason for ${status}`);
    }
  });

  it("never fabricates a reason when the decision recorded none", () => {
    const { html } = jobApplicationStatusEmail({ applicationRef: "JOB-2026-0116", status: "not_selected", reason: "   " });
    expect(html).not.toContain("The reason recorded by the school");
  });

  it("escapes a reason that contains markup", () => {
    const { html } = jobApplicationStatusEmail({
      applicationRef: "JOB-2026-0116",
      status: "not_selected",
      reason: "<script>alert('x')</script>",
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});
