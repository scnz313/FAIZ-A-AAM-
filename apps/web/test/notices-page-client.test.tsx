/**
 * Public notices page client: the server-provided published notices render,
 * the empty state is honest, and a failed read surfaces a retry that repeats
 * the same service call.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoticesPageClient } from "@/app/(public)/notices/NoticesPageClient";
import { contentService, type ContentNotice } from "@/modules/services/content";

const NOTICE: ContentNotice = {
  slug: "public-photography-day",
  contentKind: "notice",
  reviewStatus: "published",
  itemVersion: 1,
  authorAccountId: null,
  reviewedByAccountId: null,
  category: "General",
  title: "Public photography day",
  excerpt: "A fictional published notice.",
  body: ["A fictional published notice body."],
  dateIso: "2026-08-01T06:30:00Z",
  status: "published",
  audience: "public",
  version: 1,
  publishNote: "Published for the test.",
  reviewDue: "2026-09-01",
  pinned: false,
  scheduledForIso: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NoticesPageClient", () => {
  it("renders the published public notices it receives", async () => {
    vi.spyOn(contentService, "listForAudience").mockResolvedValue([NOTICE]);
    vi.spyOn(contentService, "listDownloads").mockResolvedValue([]);

    render(<NoticesPageClient initialNotices={[NOTICE]} />);

    expect(await screen.findByText("Public photography day")).toBeInTheDocument();
    expect(screen.getByText("A fictional published notice.")).toBeInTheDocument();
    expect(screen.queryByText("No notices in this category yet.")).toBeNull();
  });

  it("renders an honest empty state when no notices are published", async () => {
    vi.spyOn(contentService, "listForAudience").mockResolvedValue([]);
    vi.spyOn(contentService, "listDownloads").mockResolvedValue([]);

    render(<NoticesPageClient initialNotices={[]} />);

    expect(await screen.findByText("No notices have been published yet.")).toBeInTheDocument();
  });

  it("orders pinned notices first and then by publish date, not by arrival order", async () => {
    const older = { ...NOTICE, slug: "older", title: "Older notice", dateIso: "2026-07-01T06:30:00Z" };
    const newer = { ...NOTICE, slug: "newer", title: "Newer notice", dateIso: "2026-08-20T06:30:00Z" };
    const pinnedOlder = {
      ...NOTICE,
      slug: "pinned-older",
      title: "Pinned older notice",
      dateIso: "2026-06-01T06:30:00Z",
      pinned: true,
    };
    vi.spyOn(contentService, "listForAudience").mockResolvedValue([older, newer, pinnedOlder]);
    vi.spyOn(contentService, "listDownloads").mockResolvedValue([]);

    render(<NoticesPageClient initialNotices={[older, newer, pinnedOlder]} />);

    await screen.findByText("Pinned older notice");
    const noticeLinks = screen
      .getAllByRole("link")
      .filter((link) => (link.getAttribute("href") ?? "").startsWith("/notices/"));
    const titles = noticeLinks.map((link) => link.textContent ?? "");
    expect(titles[0]).toContain("Pinned older notice");
    expect(titles[1]).toContain("Newer notice");
    expect(titles[2]).toContain("Older notice");
  });

  it("surfaces a failed load and retries the same read", async () => {
    const list = vi.spyOn(contentService, "listForAudience").mockRejectedValueOnce(new Error("offline"));
    const downloads = vi.spyOn(contentService, "listDownloads").mockRejectedValueOnce(new Error("offline"));

    render(<NoticesPageClient initialNotices={null} />);

    expect(await screen.findByText("Notices could not be loaded.")).toBeInTheDocument();

    list.mockResolvedValueOnce([NOTICE]);
    downloads.mockResolvedValueOnce([]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Public photography day")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
