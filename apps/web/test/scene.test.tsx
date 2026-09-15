/**
 * Shared art wrapper sizing guard: scenes carry intrinsic width/height
 * attributes for their viewBox, but must never widen the page if a
 * stylesheet has not applied or fails to load.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Scene } from "@/components/ui/art/Scene";

describe("Scene", () => {
  it("keeps the viewBox and guards the artwork against container overflow", () => {
    const { container } = render(
      <Scene viewBox="0 0 800 500" width={800} height={500} ariaLabel="Test scene">
        <rect width="800" height="500" />
      </Scene>,
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 800 500");
    expect(svg?.getAttribute("width")).toBe("800");
    expect(svg?.style.maxWidth).toBe("100%");
    expect(svg?.style.height).toBe("auto");
  });

  it("renders decorative scenes outside the accessibility tree", () => {
    const { container } = render(
      <Scene viewBox="0 0 64 64" width={64} height={64} ariaLabel="Decorative" ariaHidden>
        <circle cx="32" cy="32" r="30" />
      </Scene>,
    );

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("aria-label")).toBeNull();
  });
});
