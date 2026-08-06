/**
 * Focused careers applicant draft-recovery tests. These cover the local-only
 * demo boundary: stale and legacy values are preserved, explicit recovery is
 * required before a stale draft is rewritten, and malformed storage is not
 * silently replaced.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import JobForm from "@/components/applicant/JobForm";
import { demoNowIso } from "@/modules/demo/clock";
import { sessionKey } from "@/modules/services/session";
import { vacancies } from "@/modules/content/demo";

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
}));

const vacancy = vacancies[0]!;
const draftKey = sessionKey(`job-draft:${vacancy.slug}`);
const values = {
  fullName: "Aisha Mir",
  phone: "+919000000000",
  email: "aisha@example.com",
  qualification: "Bachelor of Education (B.Ed.)",
  subject: "Mathematics",
  year: "2020",
  institution: "Demo College",
  experience: "3–5 years",
  currentRole: "Teacher",
  documents: {},
  consent: false,
};

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  pushMock.mockClear();
});

describe("JobForm draft recovery", () => {
  it("preserves a stale draft until an explicit recovery action and saves the demo timestamp", async () => {
    const staleEnvelope = {
      step: 0,
      values,
      savedAtIso: "2026-07-20T03:00:00.000Z",
    };
    window.sessionStorage.setItem(draftKey, JSON.stringify(staleEnvelope));

    const user = userEvent.setup();
    render(<JobForm vacancy={vacancy} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("This draft may be out of date");
    expect(screen.getByDisplayValue("Aisha Mir")).toBeInTheDocument();
    expect(screen.getByText("Draft stale — review before submitting")).toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem(draftKey) ?? "{}").savedAtIso).toBe(staleEnvelope.savedAtIso);

    await user.click(screen.getByRole("button", { name: "Review draft" }));
    expect(await screen.findByRole("heading", { name: "Review & consent" })).toBeInTheDocument();
    expect(screen.getByText("Aisha Mir")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(screen.getByText(/Draft saved — autosave on/)).toBeInTheDocument());
    expect(screen.queryByText("This draft may be out of date")).not.toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem(draftKey) ?? "{}").savedAtIso).toBe(demoNowIso());
  });

  it("keeps a stale envelope untouched until the applicant edits or saves it", async () => {
    const staleEnvelope = {
      step: 0,
      values,
      savedAtIso: "2026-07-20T03:00:00.000Z",
    };
    window.sessionStorage.setItem(draftKey, JSON.stringify(staleEnvelope));

    const user = userEvent.setup();
    render(<JobForm vacancy={vacancy} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This draft may be out of date");

    await user.click(screen.getByRole("button", { name: "Keep draft" }));
    expect(screen.queryByText("This draft may be out of date")).not.toBeInTheDocument();
    expect(screen.getByText("Draft stale — review before submitting")).toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem(draftKey) ?? "{}").savedAtIso).toBe(staleEnvelope.savedAtIso);

    const nameInput = screen.getByDisplayValue("Aisha Mir");
    await user.clear(nameInput);
    await user.type(nameInput, "Aisha Khan");
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(draftKey) ?? "{}").savedAtIso).toBe(demoNowIso()));

    expect(screen.getByText(/Draft saved — autosave on/)).toBeInTheDocument();
  });

  it("keeps a legacy draft and asks the applicant to review before submitting", async () => {
    window.sessionStorage.setItem(draftKey, JSON.stringify({ step: 0, values }));

    render(<JobForm vacancy={vacancy} />);

    expect(await screen.findByText("Older draft format — review before submitting")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Aisha Mir")).toBeInTheDocument();
    expect(screen.getByText("Draft current — not saved yet")).toBeInTheDocument();
  });

  it("reports malformed browser storage without replacing it", async () => {
    const malformed = "{not-json";
    window.sessionStorage.setItem(draftKey, malformed);

    render(<JobForm vacancy={vacancy} />);

    expect(await screen.findByText("Autosave unavailable", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The saved browser draft could not be read. We did not replace it",
    );
    expect(window.sessionStorage.getItem(draftKey)).toBe(malformed);
  });
});
