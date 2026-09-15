import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState, ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";

describe("LoadingSkeleton", () => {
  it("renders a polite status region with the default label", () => {
    render(<LoadingSkeleton />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders one bar per requested line", () => {
    const { container } = render(<LoadingSkeleton lines={4} />);

    expect(container.querySelectorAll(".skeleton-bar")).toHaveLength(4);
  });

  it("renders a custom line count and label", () => {
    const { container } = render(<LoadingSkeleton lines={2} label="Loading guardian links…" />);

    expect(container.querySelectorAll(".skeleton-bar")).toHaveLength(2);
    expect(screen.getByText("Loading guardian links…")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the title, note, and action child", () => {
    render(
      <EmptyState title="No guardian links yet" note="New guardian link requests will appear here.">
        <a href="/administrator/link-requests">Open Guardian links</a>
      </EmptyState>,
    );

    expect(screen.getByText("No guardian links yet")).toBeInTheDocument();
    expect(screen.getByText("New guardian link requests will appear here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Guardian links" })).toBeInTheDocument();
  });

  it("renders the title without a note when none is given", () => {
    render(<EmptyState title="No imports yet" />);

    expect(screen.getByText("No imports yet")).toBeInTheDocument();
  });
});

describe("ErrorPanel", () => {
  it("renders an alert with the title, note, and action child", () => {
    render(
      <ErrorPanel title="Guardian links could not be loaded" note="Check your connection, then try again.">
        <button type="button">Try again</button>
      </ErrorPanel>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Guardian links could not be loaded");
    expect(alert).toHaveTextContent("Check your connection, then try again.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("renders the title without a note when none is given", () => {
    render(<ErrorPanel title="Imports could not be loaded" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Imports could not be loaded");
  });
});
