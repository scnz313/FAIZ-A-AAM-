import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const staffMocks = vi.hoisted(() => ({
  useStaffContext: vi.fn(),
}));

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: staffMocks.useStaffContext,
}));
vi.mock("@/modules/services/adapter-client", () => ({
  clientAdapterMode: () => "supabase",
  adapterCall: vi.fn(),
}));

import { GrievanceInbox } from "@/components/staff/GrievanceInbox";
import { supportService, type Grievance } from "@/modules/services/support";

const requests: Grievance[] = [
  {
    ref: "SR-2026-NEW0001",
    category: "Fees",
    subject: "Receipt missing from portal",
    message: "The receipt is not visible after payment.",
    contactName: "Demo Guardian",
    contactPhone: "+91 90000 00000",
    raisedAtIso: "2026-09-16T05:00:00.000Z",
    status: "New",
    thread: [{ kind: "submission", by: "Demo Guardian", atIso: "2026-09-16T05:00:00.000Z", text: "The receipt is not visible after payment." }],
  },
  {
    ref: "SR-2026-DONE002",
    category: "Documents",
    subject: "Transfer certificate collected",
    message: "Please confirm the collection record.",
    contactName: "Demo Applicant",
    raisedAtIso: "2026-09-15T05:00:00.000Z",
    status: "Resolved",
    thread: [
      { kind: "submission", by: "Demo Applicant", atIso: "2026-09-15T05:00:00.000Z", text: "Please confirm the collection record." },
      { kind: "response", by: "School support", atIso: "2026-09-15T06:00:00.000Z", text: "Collection is recorded." },
    ],
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  staffMocks.useStaffContext.mockReturnValue({
    summary: { displayName: "Demo Principal", roles: ["support_officer"] },
  });
});

describe("GrievanceInbox", () => {
  it("renders a searchable queue and moves the case record with the results", async () => {
    const user = userEvent.setup();
    render(<GrievanceInbox initialItems={requests} />);

    expect(screen.getByRole("heading", { name: "Requests" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Receipt missing from portal" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search support requests"), "transfer");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Transfer certificate collected" })).toBeInTheDocument());
    expect(screen.queryByText("Receipt missing from portal")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search support requests"));
    await user.click(screen.getByRole("button", { name: /^New 1$/ }));
    expect(screen.getAllByText("Receipt missing from portal")).toHaveLength(2);
    expect(screen.queryByText("Transfer certificate collected")).not.toBeInTheDocument();
  });

  it("records a response with the signed-in staff display name", async () => {
    const user = userEvent.setup();
    const updated: Grievance = {
      ...requests[0]!,
      status: "Resolved",
      thread: [...requests[0]!.thread, { kind: "response", by: "Demo Principal", atIso: "2026-09-16T06:00:00.000Z", text: "The receipt is now available." }],
    };
    const respond = vi.spyOn(supportService, "respond").mockResolvedValue(updated);
    render(<GrievanceInbox initialItems={requests} />);

    await user.type(screen.getByLabelText(/^Response/), "The receipt is now available.");
    await user.click(screen.getByLabelText("Resolve after sending"));
    await user.click(screen.getByRole("button", { name: "Send response" }));

    await waitFor(() => expect(respond).toHaveBeenCalledWith(
      "SR-2026-NEW0001",
      "The receipt is now available.",
      "Demo Principal",
      true,
    ));
    expect(screen.getByText("The receipt is now available.")).toBeInTheDocument();
  });
});
