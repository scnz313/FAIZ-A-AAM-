import { render, waitFor } from "@testing-library/react";
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
});
