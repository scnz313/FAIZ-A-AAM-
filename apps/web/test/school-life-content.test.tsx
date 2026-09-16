/**
 * SchoolLifeContent renders the managed body through the real V15
 * composition: intro, ruled programme index, facilities grid, gallery with
 * the mapped SVG scenes, and the optional closing note.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCHOOL_LIFE_BODY, type SchoolLifePageBody } from "@fass/contracts";
import SchoolLifeContent from "@/components/public/pages/SchoolLifeContent";

function body(overrides: Partial<SchoolLifePageBody> = {}): SchoolLifePageBody {
  return { ...(JSON.parse(JSON.stringify(DEFAULT_SCHOOL_LIFE_BODY)) as SchoolLifePageBody), ...overrides };
}

describe("SchoolLifeContent", () => {
  it("renders every section of the default body", () => {
    render(<SchoolLifeContent body={body()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(DEFAULT_SCHOOL_LIFE_BODY.intro.title);
    expect(screen.getByText(DEFAULT_SCHOOL_LIFE_BODY.intro.eyebrow)).toBeInTheDocument();
    for (const programme of DEFAULT_SCHOOL_LIFE_BODY.programmes) {
      expect(screen.getByText(programme.title)).toBeInTheDocument();
      expect(screen.getByText(programme.line)).toBeInTheDocument();
    }
    for (const facility of DEFAULT_SCHOOL_LIFE_BODY.facilities) {
      expect(screen.getByText(facility.title)).toBeInTheDocument();
    }
    for (const tile of DEFAULT_SCHOOL_LIFE_BODY.gallery) {
      expect(screen.getByText(tile.caption)).toBeInTheDocument();
    }
  });

  /* ConceptNote intentionally renders null in production — the note is
     carried in the stored body for when the school confirms the copy. */
  it("does not render the note text regardless of its value", () => {
    const { rerender } = render(<SchoolLifeContent body={body()} />);
    expect(screen.queryByText(/concept copy pending/)).not.toBeInTheDocument();
    rerender(<SchoolLifeContent body={body({ note: "" })} />);
    expect(screen.getByText(DEFAULT_SCHOOL_LIFE_BODY.intro.title)).toBeInTheDocument();
  });

  it("renders only the stored items, not the shipped defaults", () => {
    render(
      <SchoolLifeContent
        body={body({
          programmes: [{ id: "p1", icon: "map", title: "Only programme", line: "One line." }],
          facilities: [{ id: "f1", title: "Only facility", line: "One line." }],
          gallery: [{ id: "g1", art: "lake", caption: "Only tile" }],
        })}
      />,
    );
    expect(screen.getByText("Only programme")).toBeInTheDocument();
    expect(screen.queryByText("Sports")).not.toBeInTheDocument();
    expect(screen.getByText("Only tile")).toBeInTheDocument();
    expect(screen.queryByText(/Reading hour under the chinar/)).not.toBeInTheDocument();
  });
});
