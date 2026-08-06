import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaffContextProvider } from "@/components/staff/StaffContextProvider";
import { StaffRouteGuard } from "@/components/staff/StaffRouteGuard";
import { setDemoNow } from "@/modules/demo/clock";
import { RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const IDENTITY_SESSION_KEY = sessionKey("identity");
const ADMIN_GRANT_ID = "00000000-0000-4000-8000-000000000310";
const AISHA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";

/* The route under test can change per case. */
const pathname = vi.hoisted(() => ({ current: "/staff/users" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

function Probe() {
  return <p data-testid="protected-children">PROTECTED CONTENT</p>;
}

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(PINNED);
  pathname.current = "/staff/users";
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(null);
});

describe("StaffRouteGuard (fail closed)", () => {
  it("never renders protected children while the workspace is loading", () => {
    render(
      <StaffContextProvider>
        <StaffRouteGuard>
          <Probe />
        </StaffRouteGuard>
      </StaffContextProvider>,
    );

    /* Initial render is the loading state — children are absent. */
    expect(screen.getByText("Checking your workspace…")).toBeTruthy();
    expect(screen.queryByTestId("protected-children")).toBeNull();
  });

  it("renders protected children only once the active workspace is authorized", async () => {
    pathname.current = "/staff/finance"; /* Sana's finance workspace is allowed */
    render(
      <StaffContextProvider>
        <StaffRouteGuard>
          <Probe />
        </StaffRouteGuard>
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("protected-children")).toBeTruthy());
  });

  it("denies an authorized-workspace mismatch and offers a direct grant switch", async () => {
    pathname.current = "/staff/users"; /* Sana has no users.manage workspace */
    render(
      <StaffContextProvider>
        <StaffRouteGuard>
          <Probe />
        </StaffRouteGuard>
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByText("This workspace cannot open this area")).toBeTruthy());
    expect(screen.getByText(/No granted workspace on this account can perform this action/)).toBeTruthy();
    expect(screen.queryByTestId("protected-children")).toBeNull();
  });

  it("opens the protected route after an identity + workspace switch to a granted role", async () => {
    pathname.current = "/staff/users";
    const user = userEvent.setup();
    const first = render(
      <StaffContextProvider>
        <StaffRouteGuard>
          <Probe />
        </StaffRouteGuard>
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByText("This workspace cannot open this area")).toBeTruthy());

    /* Persist the Aisha identity, then mount the provider fresh (navigation). */
    const session = await import("@/modules/services/session");
    session.sessionSet(session.sessionKey("staff-identity"), AISHA_ACCOUNT_ID);
    first.unmount();
    render(
      <StaffContextProvider>
        <StaffRouteGuard>
          <Probe />
        </StaffRouteGuard>
      </StaffContextProvider>,
    );

    /* Aisha's default workspace (content editor) cannot manage users — the
       guard offers her granted system-administrator workspace. */
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Open as System administrator" })).toBeTruthy(),
      { timeout: 5_000 },
    );
    await user.click(screen.getByRole("button", { name: "Open as System administrator" }));
    await waitFor(() => expect(screen.getByTestId("protected-children")).toBeTruthy(), { timeout: 5_000 });
  });
});
