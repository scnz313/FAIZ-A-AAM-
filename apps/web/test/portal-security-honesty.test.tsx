/**
 * Portal security honesty regressions (11 September 2026): the live security
 * page must not claim an SMS second factor that the provider does not
 * configure, and a failed MFA check must be retryable rather than presented
 * as "not set up".
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SecurityPage from "@/app/portal/security/page";

const mocks = vi.hoisted(() => ({ listFactors: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { mfa: { listFactors: mocks.listFactors } } }),
}));

beforeEach(() => {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
  mocks.listFactors.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("live security page", () => {
  it("never claims an SMS factor and surfaces a failed TOTP check with retry", async () => {
    mocks.listFactors.mockResolvedValue({ data: null, error: { message: "offline" } });
    render(<SecurityPage />);

    await screen.findByText("Could not check");
    expect(screen.queryByText("Second factor (SMS)")).toBeNull();

    const user = userEvent.setup();
    mocks.listFactors.mockResolvedValue({ data: { totp: [{ status: "verified" }] }, error: null });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("Enabled")).toBeInTheDocument());
    expect(screen.queryByText("Could not check")).toBeNull();
    expect(screen.queryByText("Second factor (SMS)")).toBeNull();
  });

  it("states the real enrollment state when the provider answers", async () => {
    mocks.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    render(<SecurityPage />);

    await screen.findByText("Not set up");
    expect(screen.queryByText("Second factor (SMS)")).toBeNull();
  });
});
