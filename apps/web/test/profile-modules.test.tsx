import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ProfilePage from "@/app/portal/profile/page";
import { FamilyContextProvider, type FamilyContextInitialState } from "@/components/portal/FamilyContextProvider";
import { setDemoNow } from "@/modules/demo/clock";
import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  familyContextService,
} from "@/modules/services/family-context";

const PINNED = new Date("2026-08-10T05:00:00.000Z");

afterEach(() => {
  setDemoNow(null);
});

describe("Guardian profile portal modules", () => {
  it("shows which modules the school shares for the active child", async () => {
    setDemoNow(PINNED);
    const [context, students, summary] = await Promise.all([
      familyContextService.getContext(DEMO_GUARDIAN_ACCOUNT_ID),
      familyContextService.listAccessibleStudentContexts(DEMO_GUARDIAN_ACCOUNT_ID),
      familyContextService.getAccountSummary(DEMO_GUARDIAN_ACCOUNT_ID),
    ]);
    const initialState: FamilyContextInitialState = {
      context: { ...context, allowedCapabilities: ["profile", "notices"] },
      students,
      guardianName: summary.displayName,
    };

    render(
      <FamilyContextProvider initialState={initialState}>
        <ProfilePage />
      </FamilyContextProvider>,
    );

    const noticesRow = screen.getByText("Notices").closest(".fl-row");
    const feesRow = screen.getByText("Fees and payments").closest(".fl-row");
    expect(noticesRow?.textContent).toContain("Sharing enabled");
    expect(feesRow?.textContent).toContain("Not enabled");
    expect(screen.getByText(/Set by the school office per linked child/)).toBeInTheDocument();
  });
});
