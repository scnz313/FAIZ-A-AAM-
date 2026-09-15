/**
 * Public downloads register component contract (slice C3): authoritative
 * rows render as links to the audited delivery route, the empty state is
 * honest, and the "Authoritative register" claim only appears when real rows
 * exist. Supabase mode is forced so the server-provided snapshot is used.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/services/adapter-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/services/adapter-client")>();
  return { ...actual, clientAdapterMode: () => "supabase" as const };
});

import { NoticesPageClient } from "@/app/(public)/notices/NoticesPageClient";
import type { ContentNotice, DownloadItem } from "@/modules/services/content";

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

const DOWNLOAD: DownloadItem = {
  reference: "DOC-2026-9Q1M4B",
  name: "fee-schedule-2026-27.pdf",
  kind: "PDF",
  size: "212 KB",
  updated: "28 Jul 2026",
};

describe("public downloads register", () => {
  it("lists authoritative public documents as audited delivery links", async () => {
    render(<NoticesPageClient initialNotices={[NOTICE]} initialDownloads={[DOWNLOAD]} />);

    const link = await screen.findByRole("link", { name: "Download" });
    expect(link).toHaveAttribute("href", "/api/documents/DOC-2026-9Q1M4B");
    expect(screen.getByText("fee-schedule-2026-27.pdf")).toBeInTheDocument();
    expect(screen.getByText("Authoritative register")).toBeInTheDocument();
    expect(screen.queryByText("Preview (demo)")).toBeNull();
    expect(screen.queryByText("No public documents have been published yet.")).toBeNull();
  });

  it("states that nothing is published yet and makes no authoritative claim when the register is empty", async () => {
    render(<NoticesPageClient initialNotices={[NOTICE]} initialDownloads={[]} />);

    expect(await screen.findByText("No public documents have been published yet.")).toBeInTheDocument();
    expect(screen.queryByText("Authoritative register")).toBeNull();
    expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
    expect(screen.queryByText(/fictional metadata/i)).toBeNull();
  });
});
