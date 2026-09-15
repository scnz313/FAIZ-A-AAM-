/**
 * C5 alert strip: the selection rule (latest urgent, published, unexpired)
 * and the render contract (content when the caller resolves a notice,
 * nothing when it resolves none).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AlertStrip, { selectUrgentNotice } from "@/components/public/AlertStrip";

const NOW = "2026-08-10T00:00:00.000Z";

type Fixture = {
  title: string;
  excerpt: string;
  dateIso: string;
  urgent?: boolean;
  status: "draft" | "scheduled" | "published" | "expired" | "archived";
  expiresAtIso?: string | null;
};

function notice(overrides: Partial<Fixture> = {}): Fixture {
  return {
    title: "Winter air-quality advisory",
    excerpt: "Morning assembly moves indoors.",
    dateIso: "2026-08-01T06:30:00Z",
    urgent: true,
    status: "published",
    expiresAtIso: null,
    ...overrides,
  };
}

describe("selectUrgentNotice", () => {
  it("picks the newest urgent, published, unexpired notice", () => {
    const older = notice({ title: "Older urgent", dateIso: "2026-08-01T06:30:00Z" });
    const newer = notice({ title: "Newer urgent", dateIso: "2026-08-05T06:30:00Z" });

    expect(selectUrgentNotice([older, newer], NOW)?.title).toBe("Newer urgent");
  });

  it("ignores non-urgent, draft, and expired notices", () => {
    const nonUrgent = notice({ title: "Non-urgent", urgent: false, dateIso: "2026-08-09T06:30:00Z" });
    const draft = notice({ title: "Draft", status: "draft", dateIso: "2026-08-08T06:30:00Z" });
    const expired = notice({
      title: "Expired",
      dateIso: "2026-08-07T06:30:00Z",
      expiresAtIso: "2026-08-09T00:00:00.000Z",
    });

    expect(selectUrgentNotice([nonUrgent, draft, expired], NOW)).toBeNull();
  });

  it("keeps an urgent notice whose expiry is still in the future", () => {
    const active = notice({ expiresAtIso: "2026-08-11T00:00:00.000Z" });

    expect(selectUrgentNotice([active], NOW)?.title).toBe(active.title);
  });

  it("returns null when no notice qualifies", () => {
    expect(selectUrgentNotice([], NOW)).toBeNull();
  });
});

describe("AlertStrip", () => {
  it("renders the title, date, and notice link when given a notice", () => {
    render(
      <AlertStrip
        notice={{
          title: "Winter air-quality advisory",
          excerpt: "Morning assembly moves indoors.",
          dateIso: "2026-08-01T06:30:00Z",
          href: "/notices/winter-air-quality-advisory",
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "Urgent notice" })).toBeInTheDocument();
    expect(screen.getByText("Winter air-quality advisory")).toBeInTheDocument();
    expect(screen.getByText("Sat 01 Aug")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Read notice/ })).toHaveAttribute(
      "href",
      "/notices/winter-air-quality-advisory",
    );
  });

  it("renders nothing when there is no urgent notice", () => {
    const { container } = render(<AlertStrip notice={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
