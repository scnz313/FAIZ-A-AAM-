import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaffContextProvider } from "@/components/staff/StaffContextProvider";
import { StaffRouteGuard } from "@/components/staff/StaffRouteGuard";
import { setDemoNow } from "@/modules/demo/clock";
import { RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import { sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const IDENTITY_SESSION_KEY = sessionKey("identity");
const STAFF_IDENTITY_KEY = sessionKey("staff-identity");
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
  sessionRemove(STAFF_IDENTITY_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(PINNED);
  pathname.current = "/staff/users";
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(STAFF_IDENTITY_KEY);
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

  it("renders protected children once the profile roles are authorized", async () => {
    pathname.current = "/staff/finance"; /* Administrator profile includes finance.view */
    render(
      <StaffContextProvider>
        <StaffRouteGuard>
          <Probe />
        </StaffRouteGuard>
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("protected-children")).toBeTruthy());
  });

  it("denies a route the profile cannot open", async () => {
    /* The Administrator persona aggregates users.manage, so use the
       Principal persona (Rania) to prove denial. */
    sessionSet(STAFF_IDENTITY_KEY, "00000000-0000-4000-8000-000000000205");
    pathname.current = "/staff/users"; /* Principal has no users.manage */
    render(
      <StaffContextProvider>
        <StaffRouteGuard>
          <Probe />
        </StaffRouteGuard>
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByText("This profile cannot open this area")).toBeTruthy());
    expect(screen.getByText(/No granted workspace on this account can perform this action/)).toBeTruthy();
    expect(screen.queryByTestId("protected-children")).toBeNull();
  });

  it("opens the protected route for the administrator persona without a workspace switch", async () => {
    pathname.current = "/staff/users";
    sessionSet(STAFF_IDENTITY_KEY, AISHA_ACCOUNT_ID);
    render(
      <StaffContextProvider>
        <StaffRouteGuard>
          <Probe />
        </StaffRouteGuard>
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("protected-children")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Open as/ })).toBeNull();
  });
});
