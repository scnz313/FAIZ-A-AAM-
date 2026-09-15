import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/modules/services/guardians", () => ({
  guardiansService: { accept: mocks.accept },
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { updateUser: mocks.updateUser } }),
}));

import GuardianActivationForm from "@/components/identity/GuardianActivationForm";

const preview = {
  valid: true as const,
  claimReference: "GCL-2026-1234567890",
  guardianDisplayName: "Test Guardian",
  givenName: "Test",
  familyName: "Guardian",
  students: [{ displayName: "Student One", classLabel: "Class 8-A" }],
  expiresAt: "2026-10-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accept.mockResolvedValue(undefined);
  mocks.updateUser.mockResolvedValue({ error: null });
});

describe("GuardianActivationForm", () => {
  it("renders the guardian preview and completes the password branch", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<GuardianActivationForm token="guardian-activation-token" preview={preview} passwordMode navigate={navigate} />);

    expect(screen.getByRole("heading", { name: "Activating access for Test Guardian" })).toBeInTheDocument();
    expect(screen.getByText(/Student One/)).toHaveTextContent("Student One · Class 8-A");
    await user.type(screen.getByLabelText(/^Password/), "SecurePass9");
    await user.type(screen.getByLabelText(/Confirm password/), "SecurePass9");
    await user.click(screen.getByRole("button", { name: "Activate portal access" }));

    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ password: "SecurePass9" }));
    expect(mocks.accept).toHaveBeenCalledWith({ token: "guardian-activation-token", givenName: "Test", familyName: "Guardian" });
    expect(navigate).toHaveBeenCalledWith("/portal");
  });

  it("explains one-time-code sign-in and accepts without asking for a password", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<GuardianActivationForm token="guardian-activation-token" preview={preview} passwordMode={false} navigate={navigate} />);

    expect(screen.getByText("You will sign in with a one-time code sent to this email.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Activate portal access" }));

    await waitFor(() => expect(mocks.accept).toHaveBeenCalled());
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/portal");
  });
});
