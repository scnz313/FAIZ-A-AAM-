// @vitest-environment node
/**
 * Contract tests for the settings service demo adapter
 * (modules/services/settings.ts). Verifies default view, session
 * persistence of overrides, audit recording on save, and that
 * policy-pending fields are preserved. The audit session key is
 * cleared between tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { formatKolkata } from "@/modules/iot/domain";
import { AUDIT_SESSION_KEY_EXPORT } from "@/modules/services/audit";
import {
  mapAuthoritativeSettings,
  SETTINGS_SESSION_KEY_EXPORT,
  settingsService,
} from "@/modules/services/settings";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");

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

  it("keeps a future-dated change inert until its effective instant", async () => {
    setDemoNow(PINNED);
    try {
      const staged = await settingsService.saveSettings(
        {
          resultsPolicy: { gradingScheme: "Percentage", publicationRequiresTwoReviewers: false },
          noticeDefaults: { defaultExpiryDays: 60, emailSender: "future@faizaam.example" },
          effectiveFromIso: "2026-08-20T00:00:00.000Z",
        },
        "Test Admin",
      );

      /* Upcoming change stored but inert: the current effective view still shows seeded values. */
      expect(staged.resultsPolicy.gradingScheme).toBe("Letter grades (A1–E2)");
      expect(staged.noticeDefaults.defaultExpiryDays).toBe(30);
      expect((await settingsService.getSettings()).resultsPolicy.gradingScheme).toBe("Letter grades (A1–E2)");

      /* Past the effective instant, the same read serves the staged version. */
      setDemoNow(new Date("2026-08-21T00:00:00.000Z"));
      const effective = await settingsService.getSettings();
      expect(effective.resultsPolicy.gradingScheme).toBe("Percentage");
      expect(effective.noticeDefaults.emailSender).toBe("future@faizaam.example");
      expect(effective.savedBy).toBe("Test Admin");
    } finally {
      setDemoNow(null);
    }
  });

  it("versions sequential saves — the latest effective version wins", async () => {
    setDemoNow(PINNED);
    try {
      await settingsService.saveSettings(
        {
          resultsPolicy: { gradingScheme: "CGPA", publicationRequiresTwoReviewers: true },
          noticeDefaults: { defaultExpiryDays: 45, emailSender: "first@faizaam.example" },
        },
        "First Admin",
      );
      const updated = await settingsService.saveSettings(
        {
          resultsPolicy: { gradingScheme: "Percentage", publicationRequiresTwoReviewers: false },
          noticeDefaults: { defaultExpiryDays: 60, emailSender: "second@faizaam.example" },
        },
        "Second Admin",
      );
      expect(updated.resultsPolicy.gradingScheme).toBe("Percentage");
      expect(updated.savedBy).toBe("Second Admin");
    } finally {
      setDemoNow(null);
    }
  });

  it("rejects an invalid effective date", async () => {
    await expect(
      settingsService.saveSettings(
        {
          resultsPolicy: { gradingScheme: "CGPA", publicationRequiresTwoReviewers: true },
          noticeDefaults: { defaultExpiryDays: 45, emailSender: "bad@faizaam.example" },
          effectiveFromIso: "not-a-date",
        },
        "Test Admin",
      ),
    ).rejects.toThrow(/effective date/);
  });

  it("mapAuthoritativeSettings keeps upcoming rows fully policy-pending and serves effective rows", () => {
    const policy = {
      admissionWindow: { fromIso: "2026-02-01", toIso: "2026-04-30" },
      feePolicy: { partialPaymentsAllowed: true, lateFeeEnabled: false, concessionsRequireApproval: true },
      results: { gradingScheme: "CGPA", publicationRequiresTwoReviewers: true },
      notices: { defaultExpiryDays: 30, emailSender: "notices@faizaam.example", smsEnabled: false },
      workingDays: { days: ["Monday"], periodsPerDay: 6 },
      notifications: { emailSender: "notices@faizaam.example" },
      academicYears: [{ label: "2026–27", status: "current" }],
    };
    const upcoming = mapAuthoritativeSettings({
      version: 3,
      status: "scheduled",
      policy,
      changed_by_account_id: "admin-1",
      created_at: "2026-08-10T05:00:00.000Z",
    });
    /* An upcoming change is inert: nothing reads as configured. */
    expect(upcoming.policyPending).toHaveLength(5);
    expect(upcoming.resultsPolicy.gradingScheme).toBe("Not configured");

    const effective = mapAuthoritativeSettings({
      version: 3,
      status: "effective",
      policy,
      changed_by_account_id: "admin-1",
      created_at: "2026-08-10T05:00:00.000Z",
    });
    expect(effective.policyPending).toHaveLength(0);
    expect(effective.resultsPolicy.gradingScheme).toBe("CGPA");
    expect(effective.admissionWindow.fromIso).toBe("2026-02-01");
  });

  it("a profile with no effective settings row yields an empty saved date instead of an invalid one", () => {
    /* Regression: the settings page formats savedAtIso; an empty string must
       flow through as "no saved version yet" and never reach Intl formatting,
       which throws RangeError on an invalid date. */
    const none = mapAuthoritativeSettings(null);
    expect(none.savedAtIso).toBe("");
    expect(none.policyPending).toHaveLength(5);
    expect(formatKolkata(none.savedAtIso, { format: "day" })).toBe("");
  });

  it("never renders a raw account UUID as the saved-by label", () => {
    /* Regression: the effective row previously passed changed_by_account_id
       straight to the page, so "Saved by 9db153ae-…" appeared on screen. The
       adapter resolves the label; without one the line must stay generic. */
    const resolved = mapAuthoritativeSettings({
      version: 2,
      status: "effective",
      policy: { gradingScheme: "CGPA" },
      changed_by_account_id: "9db153ae-a4b7-449f-9c5c-83e6a00ee770",
      changed_by_label: "Aam Admin",
      created_at: "2026-09-11T11:03:03.237Z",
    });
    expect(resolved.savedBy).toBe("Aam Admin");

    const unresolved = mapAuthoritativeSettings({
      version: 2,
      status: "effective",
      policy: { gradingScheme: "CGPA" },
      changed_by_account_id: "9db153ae-a4b7-449f-9c5c-83e6a00ee770",
      created_at: "2026-09-11T11:03:03.237Z",
    });
    expect(unresolved.savedBy).toBe("Not configured");
    expect(unresolved.savedBy).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("keeps the results policy policy-pending while the grading scheme is Not configured", () => {
    const unconfigured = mapAuthoritativeSettings({
      version: 2,
      status: "effective",
      policy: { gradingScheme: "Not configured", publicationRequiresTwoReviewers: true, defaultExpiryDays: 14, emailSender: "notices@faizaam.example" },
      created_at: "2026-09-11T11:03:03.237Z",
    });
    expect(unconfigured.resultsPolicy.gradingScheme).toBe("Not configured");
    expect(unconfigured.policyPending).toContain("results-policy");

    const configured = mapAuthoritativeSettings({
      version: 2,
      status: "effective",
      policy: { gradingScheme: "Percentage with grades", publicationRequiresTwoReviewers: true, defaultExpiryDays: 14, emailSender: "notices@faizaam.example" },
      created_at: "2026-09-11T11:03:03.237Z",
    });
    expect(configured.policyPending).not.toContain("results-policy");
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
