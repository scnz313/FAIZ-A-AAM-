/**
 * School-life page body contract: the shipped default must validate, bounds
 * hold on every section, and malformed stored bodies parse to null so the
 * public route and the editor fall back to the default copy.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCHOOL_LIFE_BODY,
  SCHOOL_LIFE_LIMITS,
  parseSchoolLifePageBody,
  schoolLifePageBodySchema,
  type SchoolLifePageBody,
} from "@fass/contracts";

function clone(): SchoolLifePageBody {
  return JSON.parse(JSON.stringify(DEFAULT_SCHOOL_LIFE_BODY)) as SchoolLifePageBody;
}

describe("schoolLifePageBodySchema", () => {
  it("accepts the shipped default body", () => {
    const result = schoolLifePageBodySchema.safeParse(DEFAULT_SCHOOL_LIFE_BODY);
    expect(result.success).toBe(true);
  });

  it("rejects a body missing the page marker", () => {
    const body = clone() as unknown as Record<string, unknown>;
    delete body.page;
    expect(schoolLifePageBodySchema.safeParse(body).success).toBe(false);
  });

  it("rejects an empty programmes array and more than the maximum", () => {
    const empty = clone();
    empty.programmes = [];
    expect(schoolLifePageBodySchema.safeParse(empty).success).toBe(false);

    const over = clone();
    for (let index = 0; index < 4; index += 1) {
      over.programmes.push({ id: `p-extra-${index}`, icon: "group", title: `Extra ${index}`, line: "Line." });
    }
    expect(over.programmes.length).toBeGreaterThan(SCHOOL_LIFE_LIMITS.programmes.max);
    expect(schoolLifePageBodySchema.safeParse(over).success).toBe(false);
  });

  it("rejects an unknown programme icon and gallery art key", () => {
    const badIcon = clone();
    const foreignIcon = "rocket";
    badIcon.programmes[0]!.icon = foreignIcon as never;
    expect(schoolLifePageBodySchema.safeParse(badIcon).success).toBe(false);

    const badArt = clone();
    badArt.gallery[0]!.art = "fireworks" as never;
    expect(schoolLifePageBodySchema.safeParse(badArt).success).toBe(false);
  });

  it("rejects over-length fields", () => {
    const body = clone();
    body.intro.title = "x".repeat(SCHOOL_LIFE_LIMITS.introTitle.max + 1);
    expect(schoolLifePageBodySchema.safeParse(body).success).toBe(false);

    const body2 = clone();
    body2.note = "x".repeat(SCHOOL_LIFE_LIMITS.note.max + 1);
    expect(schoolLifePageBodySchema.safeParse(body2).success).toBe(false);
  });

  it("accepts an empty note", () => {
    const body = clone();
    body.note = "";
    expect(schoolLifePageBodySchema.safeParse(body).success).toBe(true);
  });
});

describe("parseSchoolLifePageBody", () => {
  it("parses a stored body and returns null for legacy or malformed shapes", () => {
    expect(parseSchoolLifePageBody(DEFAULT_SCHOOL_LIFE_BODY)?.intro.title).toBe(
      DEFAULT_SCHOOL_LIFE_BODY.intro.title,
    );
    expect(parseSchoolLifePageBody(null)).toBeNull();
    expect(parseSchoolLifePageBody("text")).toBeNull();
    expect(parseSchoolLifePageBody({ blocks: [{ type: "paragraph", text: "legacy" }] })).toBeNull();
    expect(parseSchoolLifePageBody({ schemaVersion: 1, page: "school-life" })).toBeNull();
  });
});
