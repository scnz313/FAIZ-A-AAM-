import { describe, expect, it } from "vitest";

import { canonicalStaffUrl } from "@/lib/auth/portal-routes";

describe("guardians workspace canonical staff URLs", () => {
  it("resolves /guardians for each staff profile code", () => {
    expect(canonicalStaffUrl("administrator", "/guardians")).toBe("/administrator/guardians");
    expect(canonicalStaffUrl("principal", "/guardians")).toBe("/principal/guardians");
  });

  it("resolves /guardians for each already-resolved portal prefix", () => {
    expect(canonicalStaffUrl("/administrator", "/guardians")).toBe("/administrator/guardians");
    expect(canonicalStaffUrl("/principal", "/guardians")).toBe("/principal/guardians");
  });

  it("resolves /link-requests for each staff profile code", () => {
    expect(canonicalStaffUrl("administrator", "/link-requests")).toBe("/administrator/link-requests");
    expect(canonicalStaffUrl("principal", "/link-requests")).toBe("/principal/link-requests");
  });

  it("resolves /link-requests for each already-resolved portal prefix", () => {
    expect(canonicalStaffUrl("/administrator", "/link-requests")).toBe("/administrator/link-requests");
    expect(canonicalStaffUrl("/principal", "/link-requests")).toBe("/principal/link-requests");
  });
});
