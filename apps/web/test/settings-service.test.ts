// @vitest-environment node
/**
 * Contract tests for the settings service demo adapter
 * (modules/services/settings.ts). Verifies default view, session
 * persistence of overrides, audit recording on save, and that
 * policy-pending fields are preserved. The audit session key is
 * cleared between tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AUDIT_SESSION_KEY_EXPORT } from "@/modules/services/audit";
import { SETTINGS_SESSION_KEY_EXPORT, settingsService } from "@/modules/services/settings";
import { sessionRemove } from "@/modules/services/session";

beforeEach(() => {
  sessionRemove(SETTINGS_SESSION_KEY_EXPORT);
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
});

afterEach(() => {
  sessionRemove(SETTINGS_SESSION_KEY_EXPORT);
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
});

describe("settingsService.getSettings", () => {
  it("returns the default view with seeded values when no overrides exist", async () => {
    const view = await settingsService.getSettings();
    expect(view.academicYear.label).toBe("2026–27");
    expect(view.resultsPolicy.gradingScheme).toBe("Letter grades (A1–E2)");
    expect(view.resultsPolicy.publicationRequiresTwoReviewers).toBe(true);
    expect(view.noticeDefaults.defaultExpiryDays).toBe(30);
    expect(view.noticeDefaults.emailSender).toBe("notices@faizaam.example");
    expect(view.policyPending).toContain("admission-window");
    expect(view.policyPending).toContain("fee-policy");
  });

  it("derives academic years from the relationship graph", async () => {
    const view = await settingsService.getSettings();
    expect(view.academicYears.length).toBeGreaterThanOrEqual(1);
    expect(view.academicYears.some((y) => y.status === "current")).toBe(true);
  });
});

describe("settingsService.saveSettings", () => {
  it("persists editable fields to the session and returns the updated view", async () => {
    const updated = await settingsService.saveSettings(
      {
        resultsPolicy: { gradingScheme: "Percentage", publicationRequiresTwoReviewers: false },
        noticeDefaults: { defaultExpiryDays: 60, emailSender: "new@faizaam.example" },
      },
      "Test Admin",
    );

    expect(updated.resultsPolicy.gradingScheme).toBe("Percentage");
    expect(updated.resultsPolicy.publicationRequiresTwoReviewers).toBe(false);
    expect(updated.noticeDefaults.defaultExpiryDays).toBe(60);
    expect(updated.noticeDefaults.emailSender).toBe("new@faizaam.example");
    expect(updated.savedBy).toBe("Test Admin");
  });

  it("recorded overrides persist across subsequent getSettings calls", async () => {
    await settingsService.saveSettings(
      {
        resultsPolicy: { gradingScheme: "CGPA", publicationRequiresTwoReviewers: true },
        noticeDefaults: { defaultExpiryDays: 45, emailSender: "test@faizaam.example" },
      },
      "Persistent Admin",
    );

    const view = await settingsService.getSettings();
    expect(view.resultsPolicy.gradingScheme).toBe("CGPA");
    expect(view.noticeDefaults.defaultExpiryDays).toBe(45);
    expect(view.savedBy).toBe("Persistent Admin");
  });

  it("records an audit event on save", async () => {
    const { auditService } = await import("@/modules/services/audit");
    const before = await auditService.listEvents();

    await settingsService.saveSettings(
      {
        resultsPolicy: { gradingScheme: "Percentage", publicationRequiresTwoReviewers: true },
        noticeDefaults: { defaultExpiryDays: 15, emailSender: "audit@faizaam.example" },
      },
      "Audit Admin",
    );

    const after = await auditService.listEvents();
    const beforeIds = new Set(before.map((e) => e.id));
    const newEvents = after.filter((e) => !beforeIds.has(e.id));
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0]?.action).toBe("Setting changed");
    expect(newEvents[0]?.actor).toBe("Audit Admin");
    expect(newEvents[0]?.outcome).toBe("Success");
  });

  it("preserves policy-pending fields (admission window, fee policy, working days) after save", async () => {
    const updated = await settingsService.saveSettings(
      {
        resultsPolicy: { gradingScheme: "Letter grades (A1–E2)", publicationRequiresTwoReviewers: true },
        noticeDefaults: { defaultExpiryDays: 30, emailSender: "notices@faizaam.example" },
      },
      "Test",
    );

    expect(updated.admissionWindow.fromIso).toBe("2026-02-01");
    expect(updated.feePolicy.partialPaymentsAllowed).toBe(true);
    expect(updated.workingDays.periodsPerDay).toBe(8);
    expect(updated.policyPending).toContain("admission-window");
  });
});
