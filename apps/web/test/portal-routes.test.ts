import { describe, expect, it } from "vitest";

import {
  canonicalStaffUrl,
  isLegacyStaffPath,
  isStaffPath,
  isStaffPortalPath,
  portalPrefixForProfile,
  staffSubPathForPathname,
} from "@/lib/auth/portal-routes";

describe("portalPrefixForProfile", () => {
  it("maps each profile to its canonical prefix", () => {
    expect(portalPrefixForProfile("administrator")).toBe("/administrator");
    expect(portalPrefixForProfile("principal")).toBe("/principal");
  });

  it("returns null for unknown/legacy profiles", () => {
    expect(portalPrefixForProfile(null)).toBeNull();
    expect(portalPrefixForProfile(undefined)).toBeNull();
  });
});

describe("canonicalStaffUrl", () => {
  it("resolves a profile code to the canonical prefix", () => {
    expect(canonicalStaffUrl("administrator", "/users")).toBe("/administrator/users");
    expect(canonicalStaffUrl("principal", "/results")).toBe("/principal/results");
  });

  it("accepts an already-resolved portal prefix without falling back to /staff", () => {
    expect(canonicalStaffUrl("/administrator", "/users")).toBe("/administrator/users");
    expect(canonicalStaffUrl("/principal", "/results")).toBe("/principal/results");
  });

  it("maps the root sub-path to the exact portal root (no trailing slash)", () => {
    expect(canonicalStaffUrl("administrator", "")).toBe("/administrator");
    expect(canonicalStaffUrl("principal", "/")).toBe("/principal");
    expect(canonicalStaffUrl("/administrator", "")).toBe("/administrator");
  });

  it("normalizes a sub-path without a leading slash", () => {
    expect(canonicalStaffUrl("principal", "timetables")).toBe("/principal/timetables");
  });

  it("uses the canonical Administrator landing for an unresolved profile", () => {
    expect(canonicalStaffUrl(null, "/users")).toBe("/administrator/users");
  });
});

describe("staffSubPathForPathname", () => {
  it("extracts the sub-path from canonical portal prefixes", () => {
    expect(staffSubPathForPathname("/administrator")).toBe("");
    expect(staffSubPathForPathname("/administrator/users")).toBe("/users");
    expect(staffSubPathForPathname("/principal/results/RB-2026-0141/entry")).toBe("/results/RB-2026-0141/entry");
  });

  it("extracts the sub-path from the legacy /staff tree", () => {
    expect(staffSubPathForPathname("/staff")).toBe("");
    expect(staffSubPathForPathname("/staff/users")).toBe("/users");
  });

  it("returns an empty string for non-staff paths", () => {
    expect(staffSubPathForPathname("/portal")).toBe("");
    expect(staffSubPathForPathname("/sign-in")).toBe("");
  });
});

describe("path classification", () => {
  it("distinguishes canonical, legacy, and non-staff paths", () => {
    expect(isStaffPortalPath("/administrator")).toBe(true);
    expect(isStaffPortalPath("/principal/finance")).toBe(true);
    expect(isStaffPortalPath("/staff")).toBe(false);
    expect(isLegacyStaffPath("/staff")).toBe(true);
    expect(isLegacyStaffPath("/staff/users")).toBe(true);
    expect(isLegacyStaffPath("/administrator")).toBe(false);
    expect(isStaffPath("/administrator/users")).toBe(true);
    expect(isStaffPath("/staff/audit")).toBe(true);
    expect(isStaffPath("/portal")).toBe(false);
  });
});
