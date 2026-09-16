import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarChart } from "@/components/ui/BarChart";
import { ProgressRail } from "@/components/ui/ProgressRail";
import { StatTile } from "@/components/ui/StatTile";

describe("StatTile", () => {
  it("renders the figure, label, and secondary line as a link", () => {
    render(<StatTile label="Applications" value={12} secondary="3 awaiting decision" href="/administrator/admissions" />);
    const link = screen.getByRole("link", { name: /Applications/ });
    expect(link).toHaveAttribute("href", "/administrator/admissions");
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3 awaiting decision")).toBeInTheDocument();
  });

  it("renders the honest Not available state for a null value", () => {
    render(<StatTile label="Fees outstanding" value={null} secondary="Open the ledger" />);
    expect(screen.getByText("Not available")).toBeInTheDocument();
  });

  it("renders a skeleton while the value is still loading", () => {
    const { container } = render(<StatTile label="Results" value={undefined} />);
    expect(container.querySelector(".skeleton-bar")).not.toBeNull();
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
  });
});

describe("BarChart", () => {
  const data = [
    { label: "Submitted", value: 4, tone: "ink" as const },
    { label: "Under review", value: 2, tone: "saffron" as const },
    { label: "Enrolled", value: 0, tone: "willow" as const },
  ];

  it("exposes an aria label and a hidden table with the same values", () => {
    const { container } = render(<BarChart data={data} ariaLabel="Applications by stage" />);
    expect(screen.getByRole("img", { name: "Applications by stage" })).toBeInTheDocument();
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.textContent).toContain("Submitted");
    expect(table!.textContent).toContain("4");
    expect(table!.textContent).toContain("Enrolled");
  });

  it("renders a zero-value segment without a bar", () => {
    const { container } = render(<BarChart data={data} ariaLabel="Applications by stage" />);
    const fills = container.querySelectorAll(".bar-chart-fill");
    expect(fills).toHaveLength(3);
    expect((fills[2] as HTMLElement).style.width).toBe("0%");
  });
});

describe("ProgressRail", () => {
  it("renders proportional segments, a legend, and the hidden table", () => {
    const { container } = render(
      <ProgressRail
        ariaLabel="Fee collection split"
        data={[
          { label: "Collected", value: 60, tone: "willow" },
          { label: "Overdue", value: 40, tone: "madder" },
        ]}
      />,
    );
    const segments = container.querySelectorAll(".progress-rail-seg");
    expect(segments).toHaveLength(2);
    expect((segments[0] as HTMLElement).style.width).toBe("60%");
    const legend = container.querySelector(".progress-rail-legend");
    expect(legend!.textContent).toContain("Collected");
    expect(legend!.textContent).toContain("Overdue");
    const table = container.querySelector("table");
    expect(table!.textContent).toContain("60");
  });
});
