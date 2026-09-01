import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import DevelopmentAccountSwitcher from "@/components/identity/DevelopmentAccountSwitcher";
import SignInForm from "@/components/identity/SignInForm";

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.signInWithOtp.mockResolvedValue({ error: { message: "User not found" } });
  authMocks.signInWithPassword.mockResolvedValue({ error: null });
  authMocks.signOut.mockResolvedValue({ error: null });
  adapterMocks.call.mockResolvedValue({ ok: true, value: true });
});

afterEach(() => vi.unstubAllGlobals());

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

  it("uses password first factor for staff and routes directly to TOTP", async () => {
    const user = userEvent.setup();
    render(<SignInForm adapter="supabase" audience="staff" navigate={routerMocks.push} />);
    await user.type(screen.getByLabelText(/^email/i), "staff@example.test");
    await user.type(screen.getByLabelText(/^password/i), "SecurePass9");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
      email: "staff@example.test",
      password: "SecurePass9",
    }));
    expect(routerMocks.push).toHaveBeenCalledWith("/sign-in/totp?next=%2Fstaff");
  });

  it("shows a recoverable error for a failed staff sign-in", async () => {
    authMocks.signInWithPassword.mockResolvedValue({ error: { message: "Invalid credentials" } });
    const user = userEvent.setup();
    render(<SignInForm adapter="supabase" audience="staff" />);
    await user.type(screen.getByLabelText(/^email/i), "staff@example.test");
    await user.type(screen.getByLabelText(/^password/i), "SecurePass9");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not be accepted/i));
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it("uses password sign-in instead of email OTP for local family development", async () => {
    const user = userEvent.setup();
    render(
      <SignInForm
        adapter="supabase"
        developmentPasswordAuth
        navigate={routerMocks.push}
      />,
    );
    await user.type(screen.getByLabelText(/^email/i), "p@faizaam.example");
    await user.type(screen.getByLabelText(/^password/i), "test1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
      email: "p@faizaam.example",
      password: "test1234",
    }));
    expect(authMocks.signInWithOtp).not.toHaveBeenCalled();
    expect(routerMocks.push).toHaveBeenCalledWith("/portal");
  });

  it("opens a guardian account with one click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        value: { destination: "/portal", requiresMfaElevation: false },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<DevelopmentAccountSwitcher audience="family" navigate={routerMocks.push} />);

    await user.click(screen.getByRole("button", { name: /Guardian/ }));

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith("/portal"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ account: "parent" });
  });

  it("auto-elevates a one-click staff account before opening the administrator portal", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: { destination: "/administrator", requiresMfaElevation: true },
        }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<DevelopmentAccountSwitcher audience="staff" navigate={routerMocks.push} />);

    await user.click(screen.getByRole("button", { name: /Administrator/ }));

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith("/administrator"));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/mfa/dev-elevate", expect.objectContaining({ method: "POST" }));
  });
});
