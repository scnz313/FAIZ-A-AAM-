import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn().mockResolvedValue({ error: { message: "User not found" } }),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: authMocks }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import SignInForm from "@/components/identity/SignInForm";

describe("Supabase sign-in privacy", () => {
  it("keeps an unknown-account OTP response in the same generic code state", async () => {
    const user = userEvent.setup();
    render(<SignInForm adapter="supabase" />);
    await user.type(screen.getByLabelText(/^email/i), "unknown@example.test");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(authMocks.signInWithOtp).toHaveBeenCalledWith({
      email: "unknown@example.test",
      options: expect.objectContaining({ shouldCreateUser: false }),
    });
    expect(screen.getAllByText(/if an account exists/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/user not found/i)).toBeNull();
    expect(screen.getByLabelText(/verification code/i)).toBeTruthy();
  });
});
