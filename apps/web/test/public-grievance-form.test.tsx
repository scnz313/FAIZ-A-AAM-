import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GrievanceForm } from "@/components/public/GrievanceForm";
import { supportService } from "@/modules/services/support";

/**
 * Public concern form (contact page): invalid submissions are marked and
 * focused, and a rejected submission surfaces a recoverable error that keeps
 * the draft and retries the same intent.
 */
describe("public grievance form", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks every required field and focuses the first invalid one", async () => {
    const user = userEvent.setup();
    render(<GrievanceForm />);

    await user.click(screen.getByRole("button", { name: "Submit concern" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please correct the marked fields");
    expect(screen.getByText("Choose the category that fits your concern.")).toBeInTheDocument();
    expect(document.activeElement?.id).toBe("public-grievance-category");
  });

  it("preserves the draft and retries after a failed submission", async () => {
    const user = userEvent.setup();
    const submit = vi
      .spyOn(supportService, "submitGrievance")
      .mockRejectedValueOnce(new Error("column \"author_account_id\" is of type uuid but expression is of type text"))
      .mockResolvedValue({ ref: "GRV-2026-9001" });

    render(<GrievanceForm />);
    await user.selectOptions(screen.getByLabelText(/Category/), "Fees");
    await user.type(screen.getByLabelText(/Subject/), "Fee receipt not received");
    await user.type(screen.getByLabelText(/Message/), "The term 1 receipt was not issued at the office counter.");
    await user.type(screen.getByLabelText(/Your name/), "Test Guardian");
    await user.click(screen.getByLabelText(/The school will use these details/));
    await user.click(screen.getByRole("button", { name: "Submit concern" }));

    expect(await screen.findByText("The concern was not sent")).toBeInTheDocument();
    /* Internal storage details never reach the public page. */
    expect(screen.queryByText(/author_account_id/)).not.toBeInTheDocument();
    expect((screen.getByLabelText(/Subject/) as HTMLInputElement).value).toBe("Fee receipt not received");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Concern received · reference GRV-2026-9001/)).toBeInTheDocument();
  });
});
