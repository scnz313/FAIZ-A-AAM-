import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ApplicationForm from "@/components/applicant/ApplicationForm";
import JobForm from "@/components/applicant/JobForm";
import { vacancies } from "@/modules/content/demo";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/apply/student",
  useSearchParams: () => new URLSearchParams(),
}));

describe("Supabase applicant storage boundary", () => {
  const getItem = vi.spyOn(Storage.prototype, "getItem");
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const removeItem = vi.spyOn(Storage.prototype, "removeItem");

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, errors: [{ message: "test unavailable" }] }), { status: 503 })));
    getItem.mockClear();
    setItem.mockClear();
    removeItem.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not read or clear browser storage from the admission form", async () => {
    render(<ApplicationForm />);
    await waitFor(() => expect(getItem).not.toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("does not read or write browser storage from the career form", async () => {
    const vacancy = vacancies.find((candidate) => candidate.status === "open");
    if (!vacancy) throw new Error("expected an open demo vacancy");
    render(<JobForm vacancy={vacancy} />);
    await waitFor(() => expect(getItem).not.toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("never autosaves an account-bound draft as the public applicant types", async () => {
    /* The public applicant has no account. The old form wrote a draft through
       the adapter as soon as a name existed, which forced sign-in; the public
       form keeps answers on the page and calls only the intake routes. */
    const vacancy = vacancies.find((candidate) => candidate.status === "open");
    if (!vacancy) throw new Error("expected an open demo vacancy");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, errors: [{ message: "test unavailable" }] }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<JobForm vacancy={vacancy} />);

    await user.type(screen.getByLabelText(/^Full name/), "Public Candidate");
    await user.type(screen.getByLabelText(/^Email/), "candidate@example.test");
    await user.click(screen.getByRole("button", { name: /Save & continue/ }));

    expect(await screen.findByRole("heading", { name: "Experience & qualification" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    expect(setItem).not.toHaveBeenCalled();
  });
});
