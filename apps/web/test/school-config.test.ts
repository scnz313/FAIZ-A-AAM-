// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { schoolConfigService } from "@/modules/services/school-config";

beforeEach(() => setDemoNow(new Date("2026-08-10T05:00:00.000Z")));
afterEach(() => setDemoNow(null));

describe("schoolConfigService", () => {
  it("returns one deterministic configuration snapshot with policy-pending values", async () => {
    const configuration = await schoolConfigService.getConfiguration();

    expect(configuration.academicYears.find((year) => year.status === "current")?.label).toBe("2026–27");
    expect(configuration.gradeSections.map((section) => `${section.gradeLabel}-${section.sectionLabel}`)).toEqual([
      "Class 7-B",
      "Class 8-A",
      "Class 9-C",
    ]);
    expect(configuration.subjects.some((subject) => subject.name === "Mathematics")).toBe(true);
    expect(configuration.periods).toHaveLength(48);
    expect(configuration.policy).toMatchObject({ version: 1, status: "policy_pending" });
  });

  it("filters sections and periods to the requested academic year", async () => {
    const configuration = await schoolConfigService.getConfiguration("00000000-0000-4000-8000-000000000601");

    expect(configuration.gradeSections.map((section) => section.id)).toEqual([
      "00000000-0000-4000-8000-000000000701",
    ]);
    expect(configuration.periods).toHaveLength(0);
  });
});
