import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hashHandler = vi.hoisted(() => vi.fn((_props: unknown) => null));
const envMocks = vi.hoisted(() => ({
  dataAdapter: vi.fn((): "supabase" | "demo" => "supabase"),
  developmentAuthEnabled: vi.fn(() => true),
  demoPasswordSignInEnabled: vi.fn(() => false),
  totpRequired: vi.fn(() => false),
}));

vi.mock("@/components/identity/AuthHashHandler", () => ({ default: hashHandler }));
vi.mock("@/lib/supabase/env", () => ({
  dataAdapter: envMocks.dataAdapter,
  developmentAuthEnabled: envMocks.developmentAuthEnabled,
  demoPasswordSignInEnabled: envMocks.demoPasswordSignInEnabled,
  totpRequired: envMocks.totpRequired,
}));

import SignInPage from "@/app/sign-in/page";

function propsFor(callIndex = 0): { next?: string | null } {
  return (hashHandler.mock.calls[callIndex]?.[0] ?? {}) as { next?: string | null };
}

beforeEach(() => {
  hashHandler.mockClear();
  envMocks.dataAdapter.mockReturnValue("supabase");
  envMocks.developmentAuthEnabled.mockReturnValue(true);
  envMocks.demoPasswordSignInEnabled.mockReturnValue(false);
  envMocks.totpRequired.mockReturnValue(false);
});

describe("sign-in page implicit-flow handling", () => {
  it("forwards the next destination to the hash handler", async () => {
    const element = await SignInPage({
      searchParams: Promise.resolve({ error: "auth", next: "/sign-in/invite?invitation=INV-2026-C035FD" }),
    });
    render(element);

    expect(hashHandler).toHaveBeenCalled();
    expect(propsFor().next).toBe("/sign-in/invite?invitation=INV-2026-C035FD");
  });

  it("passes null when no next destination is present", async () => {
    const element = await SignInPage({ searchParams: Promise.resolve({ error: "auth" }) });
    render(element);

    expect(propsFor().next).toBeNull();
  });
});

describe("sign-in environment banner", () => {
  it("names password sign-in when development quick sign-in is active", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/password sign-in is live/i)).toBeTruthy();
    expect(screen.queryByText(/email-otp sign-in is live/i)).toBeNull();
  });

  it("names email-OTP sign-in when quick sign-in is off", async () => {
    envMocks.developmentAuthEnabled.mockReturnValue(false);
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/email-otp sign-in is live/i)).toBeTruthy();
    expect(screen.queryByText(/password sign-in is live/i)).toBeNull();
  });
});
