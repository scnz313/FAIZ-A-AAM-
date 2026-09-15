// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { dataAdapter, developmentAuthEnabled, providerEnvReadiness, totpRequired } from "@/lib/supabase/env";
import { settingsService } from "@/modules/services/settings";

afterEach(() => vi.unstubAllEnvs());

describe("Supabase adapter configuration", () => {
  it("rejects an invalid server adapter value", () => {
    vi.stubEnv("FASS_DATA_ADAPTER", "staging");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
    expect(() => dataAdapter()).toThrow(/FASS_DATA_ADAPTER must be demo or supabase/);
  });

  it("rejects a server/public adapter mismatch", () => {
    vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
    expect(() => dataAdapter()).toThrow(/Data adapter mismatch/);
  });

  it("keeps demo as the safe default when no adapter is configured", () => {
    vi.stubEnv("FASS_DATA_ADAPTER", "");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "");
    expect(dataAdapter()).toBe("demo");
  });

  it("enables quick sign-in only for a Supabase next-dev runtime", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("FASS_DEV_AUTH_BYPASS", "true");
    expect(developmentAuthEnabled()).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(developmentAuthEnabled()).toBe(false);
  });

  it("always requires TOTP outside next dev unless the labelled demo flag is on", () => {
    vi.stubEnv("FASS_TOTP_REQUIRED", "false");
    vi.stubEnv("NODE_ENV", "development");
    expect(totpRequired()).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    expect(totpRequired()).toBe(true);

    vi.stubEnv("FASS_DEMO_NO_TOTP", "true");
    expect(totpRequired()).toBe(false);

    vi.stubEnv("FASS_DEMO_NO_TOTP", "false");
    expect(totpRequired()).toBe(true);
    vi.stubEnv("FASS_DEMO_NO_TOTP", "");
  });

  it("does not silently serve demo settings in Supabase mode", async () => {
    vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    await expect(settingsService.getSettings()).rejects.toThrow(/server adapter boundary/);
    await expect(
      settingsService.saveSettings(
        {
          resultsPolicy: { gradingScheme: "Letter grades (A1–E2)", publicationRequiresTwoReviewers: true },
          noticeDefaults: { defaultExpiryDays: 30, emailSender: "notices@example.test" },
        },
        "Test administrator",
      ),
    ).rejects.toThrow(/server adapter boundary/);
  });

  it("derives scanner readiness from the selected provider in Supabase mode", () => {
    vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("DOCUMENT_SCANNER_PROVIDER", "http");
    vi.stubEnv("DOCUMENT_SCANNER_URL", "");
    vi.stubEnv("DOCUMENT_SCANNER_SECRET", "");
    const httpReadiness = providerEnvReadiness();
    expect(httpReadiness.scanner).toMatchObject({ provider: "http", ready: false });
    expect(httpReadiness.missing).toContain("DOCUMENT_SCANNER_URL");
    expect(httpReadiness.missing).toContain("DOCUMENT_SCANNER_SECRET");

    vi.stubEnv("DOCUMENT_SCANNER_PROVIDER", "manual");
    vi.stubEnv("DOCUMENT_SCANNER_SECRET", "s".repeat(32));
    const manualReadiness = providerEnvReadiness();
    expect(manualReadiness.scanner).toMatchObject({ provider: "manual", ready: true, missing: [] });
    expect(manualReadiness.missing).not.toContain("DOCUMENT_SCANNER_URL");
  });

  it("lists only genuinely unset provider names in Supabase mode", () => {
    vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "APP_URL",
      "CRON_SECRET",
      "RESEND_API_KEY",
      "EMAIL_FROM",
      "RESEND_WEBHOOK_SECRET",
    ]) {
      vi.stubEnv(name, "configured-value");
    }
    vi.stubEnv("DOCUMENT_SCANNER_PROVIDER", "manual");
    vi.stubEnv("DOCUMENT_SCANNER_SECRET", "s".repeat(32));
    const readiness = providerEnvReadiness();
    expect(readiness.missing).toEqual([]);
    expect(readiness.ready).toBe(true);

    vi.stubEnv("APP_URL", "");
    const degraded = providerEnvReadiness();
    expect(degraded.missing).toEqual(["APP_URL"]);
    expect(degraded.ready).toBe(false);
  });
});
