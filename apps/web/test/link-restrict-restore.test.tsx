// @vitest-environment jsdom

/**
 * Staff Restrict/Restore controls on /staff/link-requests. An Administrator
 * can pause an active guardian link with a typed reason (the row moves to the
 * Restricted links queue) and restore a restricted link (the row moves back).
 * A failed command keeps the reason visible for a retry, Escape cancels inline
 * confirms, and a failed restricted-queue load must not blank the active queue.
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

const ACTIVE_LINK_ID = "00000000-0000-4000-8000-000000001601";
const RESTRICTED_LINK_ID = "00000000-0000-4000-8000-000000001602";
const ALL_CAPABILITIES: FamilyCapability[] = ["academics", "finance", "documents", "notices", "profile"];

function baseLink(id: string, status: GuardianStudentLink["status"], version: number): GuardianStudentLink {
  return {
    id,
    ref: status === "restricted" ? "LINK-2026-1602" : "LINK-2026-1601",
    guardianId: "00000000-0000-4000-8000-000000000201",
    studentId: "00000000-0000-4000-8000-000000000901",
    relationshipLabel: "Parent",
    status,
    verificationSource: "guardian_request",
    approvedByPersonId: null,
    approvedAtIso: "2026-07-01T05:00:00.000Z",
    effectiveFromIso: "2026-07-01T05:00:00.000Z",
    effectiveToIso: null,
    restrictionReason: status === "restricted" ? "Identity evidence requires a fresh school review." : null,
    rejectionReason: null,
    contactPriority: 1,
    isEmergencyContact: false,
    isBillingContact: false,
    capabilities: status === "restricted" ? ["notices", "profile"] : ALL_CAPABILITIES,
    version,
  };
}

const ACTIVE_SUMMARY: LinkRequestSummary = {
  link: baseLink(ACTIVE_LINK_ID, "active", 2),
  guardianName: "Firdous Ahmad",
  studentName: "Aarif Khan",
  studentRef: "STU-2026-0901",
};

const RESTRICTED_SUMMARY: LinkRequestSummary = {
  link: baseLink(RESTRICTED_LINK_ID, "restricted", 2),
  guardianName: "Nida Bhat",
  studentName: "Zoya Khan",
  studentRef: "STU-2026-0903",
};

function summaryPage(rows: LinkRequestSummary[]): { rows: LinkRequestSummary[]; total: number; nextOffset: number | null } {
  return { rows, total: rows.length, nextOffset: null };
}

function mockQueues(active: LinkRequestSummary[], restricted: LinkRequestSummary[]): void {
  vi.spyOn(familyContextService, "listLinkRequests").mockResolvedValue({ rows: [], total: 0, nextOffset: null });
  vi.spyOn(familyContextService, "listLinkRequestSummaries").mockResolvedValue(summaryPage([]));
  vi.spyOn(familyContextService, "listActiveLinkSummaries").mockResolvedValue(summaryPage(active));
  vi.spyOn(familyContextService, "listRestrictedLinkSummaries").mockResolvedValue(summaryPage(restricted));
}

describe("link restrict and restore", () => {
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

  it("restricts an active link with the typed reason and moves it to the restricted queue", async () => {
    const user = userEvent.setup();
    mockQueues([ACTIVE_SUMMARY], []);
    const restrict = vi
      .spyOn(familyContextService, "restrictLink")
      .mockResolvedValue(baseLink(ACTIVE_LINK_ID, "restricted", 3));

    render(<LinkRequestsPage />);
    await user.click(await screen.findByRole("button", { name: "Restrict" }));

    const reason = await screen.findByRole("textbox", { name: /Restriction reason/ });
    await user.type(reason, "Child well-being review opened by the office.");
    await user.click(screen.getByRole("button", { name: "Confirm restriction" }));

    await waitFor(() =>
      expect(restrict).toHaveBeenCalledWith(ACTIVE_LINK_ID, "Child well-being review opened by the office."),
    );
    expect(await screen.findByText(/restricted · portal access is paused/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restrict" })).not.toBeInTheDocument();
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    expect(screen.getByText(/Child well-being review opened by the office\./)).toBeInTheDocument();
  });

  it("keeps the typed reason and shows the inline error when restricting fails", async () => {
    const user = userEvent.setup();
    mockQueues([ACTIVE_SUMMARY], []);
    const restrict = vi
      .spyOn(familyContextService, "restrictLink")
      .mockRejectedValueOnce(new Error("The link was updated elsewhere; nothing changed."));

    render(<LinkRequestsPage />);
    await user.click(await screen.findByRole("button", { name: "Restrict" }));

    const reason = await screen.findByRole("textbox", { name: /Restriction reason/ });
    await user.type(reason, "Pending evidence check");
    await user.click(screen.getByRole("button", { name: "Confirm restriction" }));

    expect(await screen.findByText("The link was updated elsewhere; nothing changed.")).toBeInTheDocument();
    expect(reason).toHaveValue("Pending evidence check");
    expect(restrict).toHaveBeenCalledWith(ACTIVE_LINK_ID, "Pending evidence check");
    expect(screen.queryByText("Restricted")).not.toBeInTheDocument();
  });

  it("restores a restricted link and moves it back to the active queue", async () => {
    const user = userEvent.setup();
    mockQueues([], [RESTRICTED_SUMMARY]);
    const restore = vi
      .spyOn(familyContextService, "restoreLink")
      .mockResolvedValue(baseLink(RESTRICTED_LINK_ID, "active", 3));

    render(<LinkRequestsPage />);
    await user.click(await screen.findByRole("button", { name: "Restore" }));

    const reason = await screen.findByRole("textbox", { name: /Restoration reason/ });
    await user.type(reason, "Review completed without findings.");
    await user.click(screen.getByRole("button", { name: "Confirm restore" }));

    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith(RESTRICTED_LINK_ID, "Review completed without findings."),
    );
    expect(await screen.findByText(/restored · the guardian's original module set is active again/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restrict" })).toBeInTheDocument();
    expect(screen.getByText("· v3")).toBeInTheDocument();
  });

  it("cancels the restrict confirm on Escape without calling the service", async () => {
    const user = userEvent.setup();
    mockQueues([ACTIVE_SUMMARY], []);
    const restrict = vi.spyOn(familyContextService, "restrictLink");

    render(<LinkRequestsPage />);
    await user.click(await screen.findByRole("button", { name: "Restrict" }));
    await screen.findByRole("textbox", { name: /Restriction reason/ });

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox", { name: /Restriction reason/ })).not.toBeInTheDocument();
    expect(restrict).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Restrict" })).toBeInTheDocument();
  });

  it("keeps the active queue when the restricted queue fails, then retries", async () => {
    const user = userEvent.setup();
    vi.spyOn(familyContextService, "listLinkRequests").mockResolvedValue({ rows: [], total: 0, nextOffset: null });
    vi.spyOn(familyContextService, "listLinkRequestSummaries").mockResolvedValue(summaryPage([]));
    vi.spyOn(familyContextService, "listActiveLinkSummaries").mockResolvedValue(summaryPage([ACTIVE_SUMMARY]));
    vi.spyOn(familyContextService, "listRestrictedLinkSummaries")
      .mockRejectedValueOnce(new Error("Paused links are unavailable."))
      .mockResolvedValueOnce(summaryPage([RESTRICTED_SUMMARY]));

    render(<LinkRequestsPage />);

    expect(await screen.findByRole("button", { name: "Restrict" })).toBeInTheDocument();
    expect(await screen.findByText("Restricted links could not be loaded.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByText("Restricted links could not be loaded.")).not.toBeInTheDocument();
  });
});
