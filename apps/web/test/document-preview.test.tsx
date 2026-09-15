import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import DocumentsPage from "@/app/portal/documents/page";
import { FamilyContextProvider } from "@/components/portal/FamilyContextProvider";
import { setDemoNow } from "@/modules/demo/clock";
import { RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const IDENTITY_SESSION_KEY = sessionKey("identity");

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(new Date("2026-08-10T05:00:00.000Z"));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(null);
});

describe("portal document preview", () => {
  it("shows safe missing/access-denied states, reports the unavailable demo file, and returns focus", async () => {
    const user = userEvent.setup();
    render(
      <FamilyContextProvider>
        <DocumentsPage />
      </FamilyContextProvider>,
    );

    /* The page reads the per-student bundle through the documents service
       (academics + finance adapters resolve asynchronously), so the preview
       triggers appear after the load settles. */
    const triggers = await screen.findAllByRole("button", { name: /PDF/ });
    const trigger = triggers[0];
    if (!trigger) throw new Error("Expected at least one document preview trigger");
    await user.click(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("FICTIONAL DEMO · NOT AN OFFICIAL DOCUMENT")).toBeInTheDocument();

    const state = screen.getByLabelText("Demo file state");
    await user.selectOptions(state, "missing");
    expect(screen.getByText("File not available")).toBeInTheDocument();

    await user.selectOptions(state, "access-denied");
    expect(screen.getByText("Access denied", { selector: "p" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download demo" }));
    expect(screen.getByText(/Demo download blocked · access denied/, { selector: "p" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Close$/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
