import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  setSession: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: authMocks }),
}));

import AuthHashHandler, { readAuthHashTokens } from "@/components/identity/AuthHashHandler";

const navigate = vi.fn();

function setLocation(url: string) {
  window.history.replaceState(null, "", url);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.setSession.mockResolvedValue({ error: null });
  setLocation("/sign-in");
});

afterEach(() => {
  setLocation("/sign-in");
});

describe("readAuthHashTokens", () => {
  it("reads a complete implicit-flow session and ignores anything else", () => {
    expect(readAuthHashTokens("#access_token=at&refresh_token=rt&type=invite")).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      type: "invite",
    });
    expect(readAuthHashTokens("")).toBeNull();
    expect(readAuthHashTokens("#access_token=at")).toBeNull();
    expect(readAuthHashTokens("#code=pkce-code")).toBeNull();
  });
});

describe("AuthHashHandler", () => {
  it("establishes the session from implicit-flow tokens and continues to the forwarded next path", async () => {
    setLocation("/sign-in?error=auth&next=%2Fsign-in%2Finvite#access_token=at-1&refresh_token=rt-1&type=invite");
    render(<AuthHashHandler next="/sign-in/invite" navigate={navigate} />);

    await waitFor(() =>
      expect(authMocks.setSession).toHaveBeenCalledWith({ access_token: "at-1", refresh_token: "rt-1" }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sign-in/invite"));
    expect(window.location.hash).toBe("");
  });

  it("does nothing when the URL carries no session tokens", async () => {
    setLocation("/sign-in?error=auth&next=%2Fsign-in%2Finvite");
    render(<AuthHashHandler next="/sign-in/invite" navigate={navigate} />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(authMocks.setSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("routes an invite token hash to the invitation page when no next is forwarded", async () => {
    setLocation("/sign-in#access_token=at-2&refresh_token=rt-2&type=invite");
    render(<AuthHashHandler navigate={navigate} />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sign-in/invite"));
  });

  it("rejects an external next and falls back to the staff portal home", async () => {
    setLocation("/sign-in#access_token=at-3&refresh_token=rt-3");
    render(<AuthHashHandler next="https://evil.test/portal" navigate={navigate} />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/administrator"));
  });

  it("shows a recoverable message when the session cannot be established", async () => {
    authMocks.setSession.mockResolvedValue({ error: { message: "invalid token" } });
    setLocation("/sign-in#access_token=at-4&refresh_token=rt-4&type=invite");
    render(<AuthHashHandler next="/sign-in/invite" navigate={navigate} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not start a sign-in session/i);
    expect(navigate).not.toHaveBeenCalled();
  });
});
