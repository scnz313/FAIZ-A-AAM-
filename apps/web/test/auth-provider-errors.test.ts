import { beforeEach, describe, expect, it, vi } from "vitest";

const generateLink = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { generateLink } } }),
}));

import { AuthProviderError, authProvider, setAuthProviderForTests } from "@/lib/auth/provider";

beforeEach(() => {
  generateLink.mockReset();
  setAuthProviderForTests(null);
});

describe("staff invitation provider errors", () => {
  it.each([
    [{ code: "email_exists", status: 422, message: "User already registered" }, "email_exists"],
    [{ code: "over_email_send_rate_limit", status: 429, message: "Too many requests" }, "rate_limited"],
    [{ code: "unexpected", status: 503, message: "Provider unavailable" }, "unavailable"],
  ] as const)("maps provider failure %# to %s", async (error, expectedCode) => {
    generateLink.mockResolvedValue({ data: { user: null, properties: null }, error });

    await expect(
      authProvider().createInviteLink({
        email: "staff@example.test",
        redirectTo: "https://school.test/auth/callback",
        mode: "invite",
      }),
    ).rejects.toMatchObject({ name: "AuthProviderError", code: expectedCode } satisfies Partial<AuthProviderError>);
  });
});
