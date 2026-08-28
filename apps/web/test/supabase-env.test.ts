// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { dataAdapter } from "@/lib/supabase/env";
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
});
