import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaffContextProvider } from "@/components/staff/StaffContextProvider";
import { StaffShell } from "@/components/layouts/StaffShell";
import { setDemoNow } from "@/modules/demo/clock";
import { RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const IDENTITY_SESSION_KEY = sessionKey("identity");
const FINANCE_GRANT_ID = "00000000-0000-4000-8000-000000000304";
const PUBLISHER_GRANT_ID = "00000000-0000-4000-8000-000000000305";
const ADMISSIONS_GRANT_ID = "00000000-0000-4000-8000-000000000306";
const EXAM_REVIEWER_GRANT_ID = "00000000-0000-4000-8000-000000000315";

vi.mock("next/navigation", () => ({
  usePathname: () => "/staff",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(PINNED);
  /* The drawer breakpoint query is missing in jsdom. */
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(null);
});

describe("StaffShell workspace selector", () => {
  it("options carry the role-grant IDs and the select value is the active grant", async () => {
    render(
      <StaffContextProvider>
        <StaffShell>content</StaffShell>
      </StaffContextProvider>,
    );

    const select = (await screen.findByLabelText("Workspace")) as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option"));
    expect(options.map((option) => option.value)).toEqual([
      FINANCE_GRANT_ID,
      PUBLISHER_GRANT_ID,
      ADMISSIONS_GRANT_ID,
      EXAM_REVIEWER_GRANT_ID,
    ]);
    expect(select.value).toBe(FINANCE_GRANT_ID);
    expect(screen.getByText("Finance officer · demo session")).toBeTruthy();
  });

  it("switching the workspace by grant ID updates role, context strip, and navigation", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <StaffShell>content</StaffShell>
      </StaffContextProvider>,
    );

    const select = (await screen.findByLabelText("Workspace")) as HTMLSelectElement;
    await user.selectOptions(select, PUBLISHER_GRANT_ID);

    await waitFor(() => expect(screen.getByText("Result publisher · demo session")).toBeTruthy());
    /* Role-filtered navigation follows the active workspace: Results yes,
       Finance and Admissions no. */
    expect(screen.getByRole("link", { name: "Results" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Finance" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Admissions" })).toBeNull();

    /* Switching back to the finance workspace restores its navigation. */
    await user.selectOptions(select, FINANCE_GRANT_ID);
    await waitFor(() => expect(screen.getByRole("link", { name: "Finance" })).toBeTruthy());
  });
});
