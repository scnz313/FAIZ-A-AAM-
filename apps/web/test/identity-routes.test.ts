import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { POST as applicantRegister } from "@/app/api/auth/applicant-register/route";
import { POST as recovery } from "@/app/api/auth/recovery/route";
import { POST as staffInviteAccept } from "@/app/api/auth/staff-invite-accept/route";

function crossOriginRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`https://school.test${path}`, {
    method: "POST",
    headers: { Origin: "https://evil.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("identity POST route boundaries", () => {
  it.each([
    ["applicant registration", applicantRegister, "/api/auth/applicant-register", { email: "x@example.test", givenName: "X", familyName: "Y" }],
    ["recovery", recovery, "/api/auth/recovery", { identifier: "x@example.test" }],
    ["staff invitation acceptance", staffInviteAccept, "/api/auth/staff-invite-accept", { invitationReference: "INV-2026-0001", givenName: "X", familyName: "Y" }],
  ])("rejects mismatched Origin for %s without caching", async (_label, handler, path, body) => {
    const response = await handler(crossOriginRequest(path, body));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
