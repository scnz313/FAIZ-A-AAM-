import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("@/lib/supabase/env", () => ({
  dataAdapter: () => "supabase",
  demoPasswordSignInEnabled: () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/auth/identity-server", () => ({ previewGuardianActivation: mocks.preview }));
vi.mock("@/modules/services/guardians", () => ({
  demoGuardianActivationPreview: vi.fn(),
}));

import GuardianActivationPage from "@/app/sign-in/activate/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.preview.mockResolvedValue({ ok: true, value: { valid: false, reason: "claim not found" } });
});

describe("guardian activation page", () => {
  it("asks a visitor without a provider session to open the activation email", async () => {
    const element = await GuardianActivationPage({ searchParams: Promise.resolve({ claim: "guardian-activation-token" }) });
    render(element);

    expect(screen.getByRole("heading", { name: "Open your activation email" })).toBeInTheDocument();
    expect(screen.getByText(/secure link in the school activation email/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("offers a primary sign-in button when the activation was already used", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.preview.mockResolvedValue({ ok: true, value: { valid: false, reason: "claim has already been used" } });

    const element = await GuardianActivationPage({ searchParams: Promise.resolve({ claim: "guardian-activation-token" }) });
    render(element);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveClass("btn-primary");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });
});
