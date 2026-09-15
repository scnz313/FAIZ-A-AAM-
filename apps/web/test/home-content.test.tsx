/**
 * C6 home content: published managed pages override the institutional
 * fallback copy field by field, missing pages keep the fallback, and the
 * dates ledger reads published notices or the honest empty state. No
 * fixture calendar and no fabricated dates.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Hero from "@/components/public/Hero";
import SchoolLife from "@/components/public/SchoolLife";
import SchoolStory from "@/components/public/SchoolStory";
import ServiceRail from "@/components/public/ServiceRail";
import UpcomingDates, { formatUpcomingDate, selectUpcomingDates } from "@/components/public/UpcomingDates";
import {
  mergeHeroCopy,
  selectAdmissionHeroCopy,
  selectHeroFields,
  selectManagedItems,
  selectStoryFields,
  type ManagedItem,
  type ManagedPage,
} from "@/components/public/homeContent";
import type { AdmissionConfiguration } from "@/modules/services/school-config";

const HERO_PAGE: ManagedPage = {
  title: "Managed headline",
  body: ["Managed kicker", "Managed lede", "Managed primary", "Managed secondary", "Managed note"],
};

const SERVICES_PAGE: ManagedPage = {
  title: "Home services",
  body: [
    "Managed admissions\nManaged admissions line",
    "Managed fees · Managed fees line",
    "Managed results",
    "Managed timetable\nManaged timetable line",
  ],
};

const STORY_PAGE: ManagedPage = {
  title: "Managed story heading",
  body: ["Managed story sub", "Managed narrative one.", "Managed narrative two."],
};

const LIFE_PAGE: ManagedPage = {
  title: "School life",
  body: ["Managed sport\nManaged sport line", "Managed arts\nManaged arts line"],
};

describe("selectHeroFields", () => {
  it("maps a managed body onto the hero fields", () => {
    expect(selectHeroFields(HERO_PAGE)).toEqual({
      kicker: "Managed kicker",
      title: "Managed headline",
      lede: "Managed lede",
      primaryCta: "Managed primary",
      secondaryCta: "Managed secondary",
      note: "Managed note",
    });
  });

  it("returns null for a missing or empty page", () => {
    expect(selectHeroFields(null)).toBeNull();
    expect(selectHeroFields({ title: "  ", body: [] })).toBeNull();
  });
});

describe("Hero", () => {
  it("renders managed copy when a managed page supplies it", () => {
    render(<Hero copy={selectHeroFields(HERO_PAGE)} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Managed headline");
    expect(screen.getByText("Managed kicker")).toBeInTheDocument();
    expect(screen.getByText(/Managed lede/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Managed primary/ })).toHaveAttribute("href", "/admissions/apply");
    expect(screen.getByRole("link", { name: "Managed secondary" })).toHaveAttribute("href", "/admissions");
  });

  it("keeps the current copy when no managed page exists", () => {
    render(<Hero />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Rooted in Bandipora, measured in every lesson.",
    );
    expect(screen.getByText(/Admissions 2027-28 · open this November/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Begin an admission application/ })).toHaveAttribute(
      "href",
      "/admissions/apply",
    );
  });
});

describe("selectManagedItems", () => {
  it("reads one row per entry, splitting title and supporting line", () => {
    expect(selectManagedItems(SERVICES_PAGE)).toEqual([
      { title: "Managed admissions", line: "Managed admissions line" },
      { title: "Managed fees", line: "Managed fees line" },
      { title: "Managed results", line: "" },
      { title: "Managed timetable", line: "Managed timetable line" },
    ]);
  });

  it("returns null when a page has no usable rows", () => {
    expect(selectManagedItems(null)).toBeNull();
    expect(selectManagedItems({ title: "Empty", body: ["", "   "] })).toBeNull();
  });
});

describe("ServiceRail", () => {
  it("keeps exactly four services and overlays managed copy by position", () => {
    const partial: ManagedItem[] = [{ title: "Managed admissions", line: "Managed admissions line" }];
    render(<ServiceRail items={partial} />);

    const rail = screen.getByRole("navigation", { name: "School services" });
    const links = within(rail).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(within(rail).getByText("Managed admissions")).toBeInTheDocument();
    expect(within(rail).getByText("Pay fees")).toBeInTheDocument();
    expect(links[0]).toHaveAttribute("href", "/admissions/apply");
    expect(links[3]).toHaveAttribute("href", "/portal/timetable");
  });

  it("keeps the fallback rail when no managed page exists", () => {
    render(<ServiceRail />);

    expect(screen.getByText("Apply for admission")).toBeInTheDocument();
    expect(screen.getByText("See timetable")).toBeInTheDocument();
  });
});

describe("selectStoryFields and SchoolStory", () => {
  it("maps heading, sub, and narrative from the managed page", () => {
    expect(selectStoryFields(STORY_PAGE)).toEqual({
      heading: "Managed story heading",
      sub: "Managed story sub",
      narrative: ["Managed narrative one.", "Managed narrative two."],
    });
  });

  it("renders managed story copy and keeps the facts ledger", () => {
    render(<SchoolStory content={selectStoryFields(STORY_PAGE)} />);

    expect(screen.getByRole("heading", { level: 2, name: "Managed story heading" })).toBeInTheDocument();
    expect(screen.getByText("Managed story sub")).toBeInTheDocument();
    expect(screen.getByText("Managed narrative two.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "School record" })).toBeInTheDocument();
  });

  it("keeps the fallback story when no managed page exists", () => {
    render(<SchoolStory />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "A quiet, serious school on the northern shore of Wular.",
    );
    expect(screen.getByText(/Every school day here is recorded/)).toBeInTheDocument();
  });
});

describe("SchoolLife", () => {
  it("replaces the index rows and drops the unconfirmed-copy note when managed", () => {
    render(<SchoolLife items={selectManagedItems(LIFE_PAGE)} />);

    expect(screen.getByText("Managed sport")).toBeInTheDocument();
    expect(screen.getByText("Managed sport line")).toBeInTheDocument();
    expect(screen.queryByText("Sports")).not.toBeInTheDocument();
    expect(screen.queryByText(/still to be confirmed by the school/)).not.toBeInTheDocument();
  });

  it("keeps the fallback index and the unconfirmed-copy note when no managed page exists", () => {
    render(<SchoolLife />);

    expect(screen.getByText("Sports")).toBeInTheDocument();
    expect(screen.getByText(/still to be confirmed by the school/)).toBeInTheDocument();
  });
});

describe("selectAdmissionHeroCopy", () => {
  const configuration = {
    academicYears: [
      { id: "year-current", label: "2026-27", status: "current" },
      { id: "year-old", label: "2025-26", status: "historical" },
    ],
    grades: [
      { id: "g8", ref: "class-8", code: "class-8", label: "Class 8", sortOrder: 8 },
    ],
    windows: [
      {
        id: "w1",
        ref: "ADMW-2026-717998",
        academicYearId: "year-current",
        gradeId: "g8",
        opensAtIso: "2026-07-31T18:30:00.000Z",
        closesAtIso: "2026-10-31T18:29:59.000Z",
        capacity: 60,
        status: "open",
        version: 1,
        policy: {},
        eligibilityPolicy: {},
      },
    ],
    documentRequirements: [],
    policy: null,
  } as unknown as AdmissionConfiguration;

  it("names the open window's year, classes, and close date", () => {
    const copy = selectAdmissionHeroCopy(configuration);
    expect(copy.kicker).toBe("Admissions 2026-27 · open for Class 8");
    expect(copy.note).toBe("Applications close 31 October 2026. Seats per grade are limited and filled in order.");
  });

  it("points to the notices board when no window is open or no configuration is readable", () => {
    const closed = selectAdmissionHeroCopy({
      ...configuration,
      windows: [{ ...configuration.windows[0]!, status: "closed" }],
    });
    expect(closed.kicker).toBe("Admissions · dates announced on the notices board");
    expect(closed.note).toBe("Admission dates for the next session are published on the notices board.");
    expect(selectAdmissionHeroCopy(null)).toEqual(closed);
  });
});

describe("mergeHeroCopy", () => {
  it("keeps computed values unless a managed page overrides them by name", () => {
    expect(mergeHeroCopy({ kicker: "Computed", note: "Computed note" }, { note: "Managed note", title: undefined })).toEqual({
      kicker: "Computed",
      note: "Managed note",
    });
    expect(mergeHeroCopy(null, null)).toBeNull();
  });
});

const NOW = "2026-08-10T06:00:00.000Z";

type NoticeFixture = {
  slug: string;
  title: string;
  category: string;
  dateIso: string;
  status?: string;
  expiresAtIso?: string | null;
};

function notice(overrides: Partial<NoticeFixture> = {}): NoticeFixture {
  return {
    slug: "notice",
    title: "Notice",
    category: "General",
    dateIso: "2026-09-01T06:00:00Z",
    status: "published",
    expiresAtIso: null,
    ...overrides,
  };
}

describe("selectUpcomingDates", () => {
  it("keeps today and future dates, newest first", () => {
    const dates = selectUpcomingDates(
      [
        notice({ slug: "later", title: "Later", dateIso: "2026-09-01T06:00:00Z" }),
        notice({ slug: "today", title: "Today", dateIso: "2026-08-10T03:00:00Z" }),
        notice({ slug: "past", title: "Past", dateIso: "2026-08-01T06:00:00Z" }),
      ],
      NOW,
    );

    expect(dates.map((entry) => entry.what)).toEqual(["Later", "Today"]);
    expect(dates[0]?.when).toBe("01 Sep 2026");
    expect(dates[0]?.tag).toBe("General");
  });

  it("ignores draft notices, expired notices, and rows without a valid date", () => {
    const dates = selectUpcomingDates(
      [
        notice({ title: "Draft", status: "draft" }),
        notice({ title: "Expired", expiresAtIso: "2026-08-09T00:00:00.000Z" }),
        notice({ title: "Undated", dateIso: "" }),
      ],
      NOW,
    );

    expect(dates).toEqual([]);
  });

  it("caps the ledger at five entries", () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      notice({ slug: `n-${index}`, title: `Notice ${index}`, dateIso: `2026-09-0${index + 1}T06:00:00Z` }),
    );

    expect(selectUpcomingDates(many, NOW)).toHaveLength(5);
  });

  it("compares calendar days in Asia/Kolkata, not UTC", () => {
    /* 20:00 UTC on 1 Sep is 01:30 IST on 2 Sep, so it is still "today" for a
       now later on 2 Sep even though the UTC instant has already passed. */
    const dates = selectUpcomingDates(
      [notice({ title: "Just after midnight in India", dateIso: "2026-09-01T20:00:00Z" })],
      "2026-09-02T06:00:00.000Z",
    );

    expect(dates.map((entry) => entry.what)).toEqual(["Just after midnight in India"]);
    expect(formatUpcomingDate("2026-09-01T22:00:00Z")).toBe("02 Sep 2026");
  });
});

describe("UpcomingDates", () => {
  it("renders notice-derived dates", () => {
    render(
      <UpcomingDates
        notices={[notice({ title: "Founders day", dateIso: "2026-09-15T06:00:00Z" })]}
        nowIso={NOW}
      />,
    );

    expect(screen.getByText("15 Sep 2026")).toBeInTheDocument();
    expect(screen.getByText("Founders day")).toBeInTheDocument();
  });

  it("renders the honest empty state when no dated notice qualifies", () => {
    render(
      <UpcomingDates
        notices={[notice({ title: "Old news", dateIso: "2026-08-01T06:00:00Z" })]}
        nowIso={NOW}
      />,
    );

    expect(screen.getByText("No dates have been published yet.")).toBeInTheDocument();
    expect(screen.queryByText("Old news")).not.toBeInTheDocument();
  });
});
