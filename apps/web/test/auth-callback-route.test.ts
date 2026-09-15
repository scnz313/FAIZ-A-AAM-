// @vitest-environment node
/**
 * Auth callback boundary: PKCE `?code=` links exchange server-side and
 * continue to the safe next destination; provider invite links that deliver
 * the session in the URL hash (which never reaches the server) redirect to
 * `/sign-in` with the safe next destination preserved for the client-side
 * hash handler.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAppEnv: vi.fn(() => ({ appUrl: "https://school.test" })),
  createSupabaseServerClient: vi.fn(),
  recordAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/env", () => ({ requireAppEnv: mocks.requireAppEnv }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/supabase/domain", () => ({ recordAuthEvent: mocks.recordAuthEvent }));

import { GET } from "@/app/auth/callback/route";

beforeEach(() => vi.clearAllMocks());

describe("auth callback no-code redirect", () => {
  it("preserves a safe next destination for the client hash handler", async () => {
    const response = await GET(new NextRequest("https://school.test/auth/callback?next=%2Fsign-in%2Finvite"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://school.test/sign-in?error=auth&next=%2Fsign-in%2Finvite",
    );
  });

  it("drops an external next destination", async () => {
    const response = await GET(
      new NextRequest("https://school.test/auth/callback?next=https%3A%2F%2Fevil.test%2Fportal"),
    );

    expect(response.headers.get("location")).toBe("https://school.test/sign-in?error=auth");
  });

  it("still redirects a plain failure without a next destination", async () => {
    const response = await GET(new NextRequest("https://school.test/auth/callback"));

    expect(response.headers.get("location")).toBe("https://school.test/sign-in?error=auth");
  });
});

describe("auth callback PKCE exchange", () => {
  it("exchanges the code and continues to the safe next destination", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { exchangeCodeForSession } });

    const response = await GET(
      new NextRequest("https://school.test/auth/callback?code=pkce-code&next=%2Fsign-in%2Freset-password"),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(mocks.recordAuthEvent).toHaveBeenCalledWith(expect.anything(), "signed_in");
    expect(response.headers.get("location")).toBe("https://school.test/sign-in/reset-password");
  });

  it("falls back to the sign-in error state when the exchange fails", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: { message: "expired" } });
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { exchangeCodeForSession } });

    const response = await GET(
      new NextRequest("https://school.test/auth/callback?code=stale&next=%2Fsign-in%2Finvite"),
    );

    expect(response.headers.get("location")).toBe(
      "https://school.test/sign-in?error=auth&next=%2Fsign-in%2Finvite",
    );
  });
});
