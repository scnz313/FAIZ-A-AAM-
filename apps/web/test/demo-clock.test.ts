// @vitest-environment node
/**
 * Deterministic demo-clock contract tests (see modules/demo/clock.ts).
 * The clock must never read the wall clock: it pins a fixed concept date
 * and exposes a test hook (setDemoNow) that restores the default.
 */
import { afterEach, describe, expect, it } from "vitest";

import { demoNow, demoNowIso, demoTodayLabel, setDemoNow } from "@/modules/demo/clock";

const CONCEPT_DATE = "2026-08-03";
const PINNED_DATE = "2026-08-10";

afterEach(() => {
  /* Never leak a pinned clock into another test. */
  setDemoNow(null);
});

describe("demoNow", () => {
  it("returns the concept date by default", () => {
    expect(demoNow().toISOString().slice(0, 10)).toBe(CONCEPT_DATE);
  });

  it("returns the injected date after setDemoNow", () => {
    setDemoNow(new Date("2026-08-10T00:00:00Z"));
    expect(demoNow().toISOString().slice(0, 10)).toBe(PINNED_DATE);
  });

  it("restores the concept date after setDemoNow(null)", () => {
    setDemoNow(new Date("2026-08-10T00:00:00Z"));
    setDemoNow(null);
    expect(demoNow().toISOString().slice(0, 10)).toBe(CONCEPT_DATE);
  });

  it("demoNowIso stays consistent with demoNow", () => {
    setDemoNow(new Date("2026-08-10T00:00:00Z"));
    expect(demoNowIso()).toBe(demoNow().toISOString());
  });
});

describe("demoTodayLabel", () => {
  it("formats the concept date as an uppercase folio label", () => {
    expect(demoTodayLabel()).toBe("MONDAY, 3 AUGUST 2026");
  });

  it("follows the pinned clock and formats in Asia/Kolkata", () => {
    /* 2026-08-10T00:00:00Z is 05:30 IST on Monday 10 August 2026. */
    setDemoNow(new Date("2026-08-10T00:00:00Z"));
    expect(demoTodayLabel()).toBe("MONDAY, 10 AUGUST 2026");
  });

  it("matches the exported static demo label", () => {
    expect(demoTodayLabel()).toBe("MONDAY, 3 AUGUST 2026");
  });
});
