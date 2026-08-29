import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn().mockResolvedValue({ error: { message: "User not found" } }),
  signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
  verifyOtp: vi.fn(),
  signOut: vi.fn().mockResolvedValue({ error: null }),
}));
const adapterMocks = vi.hoisted(() => ({
  call: vi.fn().mockResolvedValue({ ok: true, value: true }),
}));
const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: authMocks }),
}));
vi.mock("@/modules/services/adapter-client", () => ({
  adapterCall: adapterMocks.call,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

import SignInForm from "@/components/identity/SignInForm";

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.signInWithOtp.mockResolvedValue({ error: { message: "User not found" } });
  authMocks.signInWithPassword.mockResolvedValue({ error: null });
  authMocks.signOut.mockResolvedValue({ error: null });
  adapterMocks.call.mockResolvedValue({ ok: true, value: true });
});

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

  it("shows a recoverable rate-limit state without revealing account existence", async () => {
    authMocks.signInWithOtp.mockResolvedValue({ error: { status: 429, message: "rate limit" } });
    const user = userEvent.setup();
    render(<SignInForm adapter="supabase" />);
    await user.type(screen.getByLabelText(/^email/i), "unknown@example.test");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/too many code requests/i);
    expect(screen.queryByLabelText(/verification code/i)).toBeNull();
  });

  it("uses password first factor for staff and routes verified staff to TOTP", async () => {
    const user = userEvent.setup();
    render(<SignInForm adapter="supabase" audience="staff" />);
    await user.type(screen.getByLabelText(/^email/i), "staff@example.test");
    await user.type(screen.getByLabelText(/^password/i), "SecurePass9");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
      email: "staff@example.test",
      password: "SecurePass9",
    }));
    expect(adapterMocks.call).toHaveBeenCalledWith("identity.hasStaff");
    expect(routerMocks.push).toHaveBeenCalledWith("/sign-in/totp?next=%2Fstaff");
  });

  it("rejects a valid Auth session that has no staff grant", async () => {
    adapterMocks.call.mockResolvedValue({ ok: true, value: false });
    const user = userEvent.setup();
    render(<SignInForm adapter="supabase" audience="staff" />);
    await user.type(screen.getByLabelText(/^email/i), "applicant@example.test");
    await user.type(screen.getByLabelText(/^password/i), "SecurePass9");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(authMocks.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be accepted/i);
    expect(routerMocks.push).not.toHaveBeenCalled();
  });
});
