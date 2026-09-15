import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));

import RetryButton from "@/components/ui/RetryButton";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RetryButton", () => {
  it("renders the default label", () => {
    render(<RetryButton />);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("renders a custom label", () => {
    render(<RetryButton label="Reload guardian links" />);

    expect(screen.getByRole("button", { name: "Reload guardian links" })).toBeInTheDocument();
  });

  it("calls router.refresh exactly once on click", async () => {
    const user = userEvent.setup();
    render(<RetryButton />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  });
});
