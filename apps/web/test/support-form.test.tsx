import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupportForm } from "@/components/portal/SupportForm";
import { supportService, type Grievance } from "@/modules/services/support";

/**
 * Guardian-side failure recovery: a rejected submission must surface an
 * error, preserve the draft, and offer an idempotent retry (S1 extension).
 */
describe("guardian support failure recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves the draft and retries after a failed submission", async () => {
    const user = userEvent.setup();
    const record: Grievance = {
      ref: "GRV-2026-9001",
      category: "Fees",
      subject: "Fee receipt not visible",
      message: "The receipt for the latest payment is not visible in the portal.",
      contactName: "Test Guardian",
      raisedAtIso: "2026-09-10T00:00:00.000Z",
      status: "New",
      thread: [],
    };
    const submit = vi
      .spyOn(supportService, "submitAuthenticatedGrievance")
      .mockRejectedValueOnce(new Error("Support intake is unavailable."))
      .mockResolvedValue({ ref: record.ref });
    vi.spyOn(supportService, "getGrievance").mockResolvedValue(record);

    render(<SupportForm />);
    await user.selectOptions(screen.getByLabelText(/Category/), record.category);
    await user.type(screen.getByLabelText(/Subject/), record.subject);
    await user.type(screen.getByLabelText(/Message/), record.message);
    await user.type(screen.getByLabelText(/Your name/), record.contactName);
    await user.click(screen.getByLabelText(/I understand/));
    await user.click(screen.getByRole("button", { name: "Submit grievance" }));

    expect(await screen.findByText("The grievance was not submitted")).toBeInTheDocument();
    expect((screen.getByLabelText(/Message/) as HTMLTextAreaElement).value).toBe(record.message);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Concern received")).toBeInTheDocument();
  });
});
