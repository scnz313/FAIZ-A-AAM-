/**
 * ApplicationForm component tests. Step 1 renders, validation blocks an
 * empty submit, filling the required fields advances to step 2, and —
 * the P0-A regression guard — the "Save & continue →" button lives
 * inside the <form> so submit actually runs the validation handler.
 *
 * The final test covers the submit path: the eight-step form is filled
 * end to end and submitted through the admissions demo adapter, which
 * issues the deterministic reference APP-2026-0424 and routes to its
 * status page. (Previously the submit path was async-free; queries now
 * wait for the adapter latency with findBy/waitFor.)
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApplicationForm from "@/components/applicant/ApplicationForm";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    prefetch: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/apply/student",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  /* The tab-session draft must not leak between tests. */
  window.sessionStorage.clear();
  window.localStorage.clear();
  pushMock.mockClear();
});

describe("ApplicationForm", () => {
  it("renders step 1 with the Save & continue control", () => {
    render(<ApplicationForm />);

    expect(screen.getByRole("heading", { name: "Academic" })).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Save & continue →" });
    expect(continueButton).toBeInTheDocument();
    expect(continueButton).toHaveAttribute("type", "submit");
  });

  it("associates the Save & continue button with the form (P0-A CTA guard)", () => {
    const { container } = render(<ApplicationForm />);

    const continueButton = screen.getByRole("button", { name: "Save & continue →" });
    expect(continueButton.closest("form")).not.toBeNull();
    /* The form lives in the same section as the action bar. */
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("shows validation errors when step 1 is submitted empty", async () => {
    const user = userEvent.setup();
    render(<ApplicationForm />);

    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Please check the highlighted fields.");
    expect(screen.getByText("Select the academic session.")).toBeInTheDocument();
    expect(screen.getByText("Select the class you are applying for.")).toBeInTheDocument();
    expect(document.querySelectorAll(".field-error").length).toBeGreaterThanOrEqual(2);
    /* Still on step 1. */
    expect(screen.getByRole("heading", { name: "Academic" })).toBeInTheDocument();
  });

  it("advances to step 2 after the required fields are filled", async () => {
    const user = userEvent.setup();
    render(<ApplicationForm />);

    await user.selectOptions(screen.getByLabelText(/^Academic session/), "2026-27");
    await user.selectOptions(screen.getByLabelText(/^Class /), "Class 6");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    expect(screen.getByRole("heading", { name: "Student details" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Full name/)).toBeInTheDocument();
  });

  it("submits the completed form through the admissions service and routes to the issued reference", async () => {
    const user = userEvent.setup();
    render(<ApplicationForm />);

    /* Step 1 — academic */
    await user.selectOptions(screen.getByLabelText(/^Academic session/), "2026-27");
    await user.selectOptions(screen.getByLabelText(/^Class /), "Class 6");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 2 — student details */
    await user.type(screen.getByLabelText(/^Full name/), "Demo Student");
    await user.type(screen.getByLabelText(/^Date of birth/), "2014-04-10");
    await user.selectOptions(screen.getByLabelText(/^Gender/), "Female");
    await user.type(screen.getByLabelText(/^Place of birth/), "Bandipora");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 3 — guardian */
    await user.type(screen.getByLabelText(/^Parent \/ guardian name/), "Demo Guardian");
    await user.selectOptions(screen.getByLabelText(/^Relationship to the student/), "Father");
    await user.type(screen.getByLabelText(/^Phone/), "+919000000000");
    await user.type(screen.getByLabelText(/^Email/), "demo@example.com");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 4 — address */
    await user.type(screen.getByLabelText(/^House & street/), "Main Road");
    await user.type(screen.getByLabelText(/^Village \/ town/), "Bandipora");
    await user.type(screen.getByLabelText(/^District/), "Bandipora");
    await user.type(screen.getByLabelText(/^PIN code/), "193502");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 5 — prior school */
    await user.type(screen.getByLabelText(/^Current or last school/), "Demo High School");
    await user.selectOptions(screen.getByLabelText(/^Class last attended/), "Class 5");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 6 — medical */
    await user.click(screen.getByLabelText(/None — nothing to declare/));
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 7 — documents */
    await user.upload(screen.getByLabelText(/^Birth certificate/), new File(["x"], "birth.pdf", { type: "application/pdf" }));
    await user.upload(screen.getByLabelText(/^Student photograph/), new File(["x"], "photo.jpg", { type: "image/jpeg" }));
    await user.upload(screen.getByLabelText(/^Previous report card/), new File(["x"], "report.pdf", { type: "application/pdf" }));
    await user.upload(screen.getByLabelText(/^Address proof/), new File(["x"], "address.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 8 — review & declaration */
    await user.click(screen.getByLabelText(/I have read the declaration/));
    await user.click(screen.getByRole("button", { name: "Submit application" }));

    /* The demo adapter issues the first deterministic reference (session
       counter seeded at 424) and the form routes to its status page. */
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/apply/student/APP-2026-0424/status");
    });
  });
});
