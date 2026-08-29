import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  updateUser: vi.fn().mockResolvedValue({ error: null }),
}));
const adapterMocks = vi.hoisted(() => ({
  call: vi.fn().mockResolvedValue({ ok: true, value: {} }),
}));
const routerMocks = vi.hoisted(() => ({
  replace: vi.fn(),
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

import PasswordResetForm from "@/components/identity/PasswordResetForm";

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.updateUser.mockResolvedValue({ error: null });
  adapterMocks.call.mockResolvedValue({ ok: true, value: {} });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

describe("PasswordResetForm", () => {
  it("updates the recovery-session password, signs out globally, and returns to sign in", async () => {
    const user = userEvent.setup();
    render(<PasswordResetForm />);
    await user.type(screen.getByLabelText(/^new password/i), "SecurePass9");
    await user.type(screen.getByLabelText(/^confirm new password/i), "SecurePass9");
    await user.click(screen.getByRole("button", { name: "Save new password" }));

    await waitFor(() => expect(authMocks.updateUser).toHaveBeenCalledWith({ password: "SecurePass9" }));
    expect(fetch).toHaveBeenCalledWith("/api/auth/sign-out", expect.objectContaining({ method: "POST" }));
    expect(routerMocks.replace).toHaveBeenCalledWith("/sign-in?reset=complete");
  });

  it("keeps mismatched passwords in the form", async () => {
    const user = userEvent.setup();
    render(<PasswordResetForm />);
    await user.type(screen.getByLabelText(/^new password/i), "SecurePass9");
    await user.type(screen.getByLabelText(/^confirm new password/i), "Different9");
    await user.click(screen.getByRole("button", { name: "Save new password" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
    expect(authMocks.updateUser).not.toHaveBeenCalled();
  });
});
