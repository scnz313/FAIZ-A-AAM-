// @vitest-environment jsdom

/**
 * Guardian pending-link-request panel tests for /portal/link-child. The
 * panel reads the signed-in guardian's own requests through the family
 * context service: it lists relationship, child, public reference, and the
 * requested date with a Pending verification badge, never renders an empty
 * reference cell, shows the honest empty note, and recovers from a failed
 * read through an idempotent Try again control.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/portal/FamilyContextProvider", () => ({
  useFamilyContext: () => ({ context: { accountId: "00000000-0000-4000-8000-000000000901" } }),
}));

import PendingLinkRequests from "@/components/identity/PendingLinkRequests";
import { PENDING_LINK_REQUESTS_REFRESH_EVENT } from "@/components/identity/pending-link-events";
import { formatKolkata } from "@/modules/iot/domain";
import { familyContextService, type PendingLinkRequestView } from "@/modules/services/family-context";

const PENDING_ITEM: PendingLinkRequestView = {
  ref: "LINK-2026-1103",
  studentRef: "STU-2026-0903",
  studentName: "Zoya Khan",
  relationshipLabel: "Parent",
  status: "pending_verification",
  requestedAtIso: "2026-08-10T05:00:00.000Z",
};

describe("PendingLinkRequests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders relationship, child, reference, request date, and pending status", async () => {
    const list = vi.spyOn(familyContextService, "listPendingLinkRequests").mockResolvedValue([PENDING_ITEM]);

    render(<PendingLinkRequests />);

    expect(await screen.findByText("Zoya Khan")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000901");
    expect(screen.getByText("Parent")).toBeInTheDocument();
    expect(screen.getByText("STU-2026-0903")).toBeInTheDocument();
    expect(
      screen.getByText(formatKolkata(PENDING_ITEM.requestedAtIso, { format: "day" })),
    ).toBeInTheDocument();
    expect(screen.getByText("Pending verification")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Student reference" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("never renders an empty reference cell when studentRef is empty", async () => {
    vi.spyOn(familyContextService, "listPendingLinkRequests").mockResolvedValue([
      { ...PENDING_ITEM, studentRef: "" },
    ]);

    render(<PendingLinkRequests />);

    expect(await screen.findByText("Zoya Khan")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Student reference" })).not.toBeInTheDocument();
    expect(screen.queryByText("STU-2026-0903")).not.toBeInTheDocument();
    const emptyCells = Array.from(document.querySelectorAll("td")).filter(
      (cell) => (cell.textContent ?? "").trim() === "",
    );
    expect(emptyCells).toHaveLength(0);
  });

  it("renders the honest empty note when nothing is pending", async () => {
    vi.spyOn(familyContextService, "listPendingLinkRequests").mockResolvedValue([]);

    render(<PendingLinkRequests />);

    expect(await screen.findByText("No pending link requests")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing is active until the office approves the link/)).toBeInTheDocument();
  });

  it("re-reads when a link request is recorded by the sibling form", async () => {
    const list = vi
      .spyOn(familyContextService, "listPendingLinkRequests")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([PENDING_ITEM]);

    render(<PendingLinkRequests />);

    expect(await screen.findByText("No pending link requests")).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event(PENDING_LINK_REQUESTS_REFRESH_EVENT)));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Zoya Khan")).toBeInTheDocument();
  });

  it("surfaces a load failure and re-reads through Try again", async () => {
    const user = userEvent.setup();
    const list = vi
      .spyOn(familyContextService, "listPendingLinkRequests")
      .mockRejectedValueOnce(new Error("The link service is unavailable."))
      .mockResolvedValueOnce([PENDING_ITEM]);

    render(<PendingLinkRequests />);

    expect(await screen.findByText("Your pending requests could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Zoya Khan")).toBeInTheDocument();
  });
});
