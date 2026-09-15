// @vitest-environment jsdom

/**
 * The link-child form announces a recorded request so the sibling
 * pending-requests panel refreshes instead of showing a stale empty list.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import LinkChildForm from "@/components/identity/LinkChildForm";
import { PENDING_LINK_REQUESTS_REFRESH_EVENT } from "@/components/identity/pending-link-events";
import { identityService } from "@/modules/services/identity";

describe("LinkChildForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("announces a recorded request to the pending-request panel", async () => {
    const requestLink = vi.spyOn(identityService, "requestLink").mockResolvedValue({ ref: "LINK-2026-TEST01" });
    const listener = vi.fn();
    window.addEventListener(PENDING_LINK_REQUESTS_REFRESH_EVENT, listener);
    const user = userEvent.setup();

    render(<LinkChildForm />);

    await user.type(screen.getByLabelText(/Guardian name/), "Firdous Ahmad");
    await user.type(screen.getByLabelText(/Student reference/), "STU-2026-5AB552667D");
    await user.selectOptions(screen.getByLabelText(/Relation to the child/), "Legal guardian");
    await user.click(screen.getByRole("button", { name: "Request to link" }));

    await screen.findByText("Link request pending");
    expect(requestLink).toHaveBeenCalledWith("Firdous Ahmad", "STU-2026-5AB552667D", "Legal guardian");
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(PENDING_LINK_REQUESTS_REFRESH_EVENT, listener);
  });
});
