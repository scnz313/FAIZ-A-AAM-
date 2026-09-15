// @vitest-environment jsdom

/**
 * Staff module editor for active guardian links on /staff/link-requests. An
 * Administrator sees the current module scope on each row, can open an inline
 * editor, uncheck a module, and save through the relationship service. The
 * editor follows the page's inline confirm pattern: Escape closes and returns
 * focus, a failed save keeps the selection and offers retry, and an empty set
 * is blocked in favour of revoking the link (see LinkModulesEditor).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FamilyCapability, GuardianStudentLink } from "@fass/contracts";

const staffMocks = vi.hoisted(() => ({ useStaffContext: vi.fn() }));

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: staffMocks.useStaffContext,
}));

import LinkRequestsPage from "@/app/staff/link-requests/page";
import { familyContextService, type LinkRequestSummary } from "@/modules/services/family-context";

const LINK_ID = "00000000-0000-4000-8000-000000001501";
const ALL_CAPABILITIES: FamilyCapability[] = ["academics", "finance", "documents", "notices", "profile"];

function link(capabilities: FamilyCapability[]): GuardianStudentLink {
  return {
    id: LINK_ID,
    ref: "LINK-2026-0501",
    guardianId: "00000000-0000-4000-8000-000000000201",
    studentId: "00000000-0000-4000-8000-000000000901",
    relationshipLabel: "Parent",
    status: "active",
    verificationSource: "guardian_request",
    approvedByPersonId: null,
    approvedAtIso: "2026-07-01T05:00:00.000Z",
    effectiveFromIso: "2026-07-01T05:00:00.000Z",
    effectiveToIso: null,
    restrictionReason: null,
    rejectionReason: null,
    contactPriority: 1,
    isEmergencyContact: false,
    isBillingContact: false,
    capabilities,
    version: 3,
  };
}

function activeSummary(capabilities: FamilyCapability[]): LinkRequestSummary {
  return {
    link: link(capabilities),
    guardianName: "Firdous Ahmad",
    studentName: "Aarif Khan",
    studentRef: "STU-2026-0901",
  };
}

/** Mock every family-context read the page performs; returns the active spy. */
function mockPage(active: LinkRequestSummary) {
  vi.spyOn(familyContextService, "listLinkRequests").mockResolvedValue({ rows: [], total: 0, nextOffset: null });
  vi.spyOn(familyContextService, "listLinkRequestSummaries").mockResolvedValue({ rows: [], total: 0, nextOffset: null });
  return vi.spyOn(familyContextService, "listActiveLinkSummaries").mockResolvedValue({
    rows: [active],
    total: 1,
    nextOffset: null,
  });
}

async function openEditor(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: "Modules" }));
  return screen.findByRole("group", { name: /Modules for Firdous Ahmad and Aarif Khan/ });
}

describe("link module editor", () => {
  beforeEach(() => {
    staffMocks.useStaffContext.mockReturnValue({
      summary: {
        profileCode: "administrator",
        roles: ["system_administrator"],
        roleLabel: "Administrator",
        displayName: "Fictional Administrator",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the current module scope on the active link row", async () => {
    mockPage(activeSummary(["academics", "documents", "notices"]));

    render(<LinkRequestsPage />);

    expect(await screen.findByText(/Modules: 3 of 5/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modules" })).toBeInTheDocument();
  });

  it("saves the changed set and updates the row without a reload", async () => {
    const user = userEvent.setup();
    const listActive = mockPage(activeSummary(ALL_CAPABILITIES));
    const change = vi
      .spyOn(familyContextService, "changeLinkCapabilities")
      .mockResolvedValue(link(["academics", "finance", "documents", "profile"]));

    render(<LinkRequestsPage />);
    expect(await screen.findByText(/Modules: all/)).toBeInTheDocument();

    await openEditor(user);
    await user.click(screen.getByRole("checkbox", { name: /Notices/ }));
    await user.click(screen.getByRole("button", { name: "Save modules" }));

    await waitFor(() =>
      expect(change).toHaveBeenCalledWith(LINK_ID, ["academics", "finance", "documents", "profile"]),
    );
    await waitFor(() => expect(screen.queryByRole("group", { name: /Modules for/ })).not.toBeInTheDocument());
    expect(await screen.findByText(/Modules updated for LINK-2026-0501/)).toBeInTheDocument();
    expect(screen.getByText(/Modules: 4 of 5/)).toBeInTheDocument();
    expect(listActive).toHaveBeenCalledTimes(1);
  });

  it("keeps the selection and offers retry when the save fails", async () => {
    const user = userEvent.setup();
    mockPage(activeSummary(ALL_CAPABILITIES));
    const change = vi
      .spyOn(familyContextService, "changeLinkCapabilities")
      .mockRejectedValueOnce(new Error("The server rejected the change because the link was updated elsewhere."))
      .mockResolvedValueOnce(link(["academics", "documents", "notices", "profile"]));

    render(<LinkRequestsPage />);
    await screen.findByText(/Modules: all/);

    await openEditor(user);
    const finance = screen.getByRole("checkbox", { name: /Fees and payments/ });
    await user.click(finance);
    await user.click(screen.getByRole("button", { name: "Save modules" }));

    expect(
      await screen.findByText("The server rejected the change because the link was updated elsewhere."),
    ).toBeInTheDocument();
    expect(finance).not.toBeChecked();
    expect(screen.getByRole("group", { name: /Modules for/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith(LINK_ID, ["academics", "documents", "notices", "profile"]),
    );
    await waitFor(() => expect(screen.queryByRole("group", { name: /Modules for/ })).not.toBeInTheDocument());
    expect(screen.getByText(/Modules: 4 of 5/)).toBeInTheDocument();
  });

  it("keeps the required profile capability and warns when only it remains", async () => {
    const user = userEvent.setup();
    mockPage(activeSummary(ALL_CAPABILITIES));
    const change = vi.spyOn(familyContextService, "changeLinkCapabilities").mockResolvedValue({
      ...activeSummary(ALL_CAPABILITIES).link,
      capabilities: ["profile"],
    });

    render(<LinkRequestsPage />);
    await screen.findByText(/Modules: all/);
    await openEditor(user);

    const profileCheckbox = screen.getByRole("checkbox", { name: /Profile and linked children/ });
    expect(profileCheckbox).toBeChecked();
    expect(profileCheckbox).toBeDisabled();
    await user.click(profileCheckbox);
    expect(profileCheckbox).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: /Academics and results/ }));
    await user.click(screen.getByRole("checkbox", { name: /Fees and payments/ }));
    await user.click(screen.getByRole("checkbox", { name: /^Documents/ }));
    await user.click(screen.getByRole("checkbox", { name: /Notices/ }));

    expect(await screen.findByText(/No school modules selected/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save modules" }));
    expect(change).toHaveBeenCalledWith(LINK_ID, ["profile"]);
  });

  it("closes on Escape and returns focus to the Modules toggle", async () => {
    const user = userEvent.setup();
    mockPage(activeSummary(ALL_CAPABILITIES));

    render(<LinkRequestsPage />);
    await screen.findByText(/Modules: all/);
    await openEditor(user);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: /Modules for/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modules" })).toHaveFocus();
  });
});
