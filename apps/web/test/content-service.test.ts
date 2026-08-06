// @vitest-environment node
/**
 * Deterministic contract tests for the content demo adapter
 * (modules/services/content.ts). Node environment exercises the SSR-safe
 * in-memory fallback of the session store (no window). The clock is pinned
 * and the content session key is cleared between tests, so publish dates,
 * versions and notes are fully deterministic.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { CONTENT_SESSION_KEY, contentService } from "@/modules/services/content";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-05T09:30:00Z");

const DRAFT_SLUG = "annual-prize-distribution-nominations";
const EXPIRED_SLUG = "summer-workshop-registration";

beforeEach(() => {
  setDemoNow(PINNED);
  sessionRemove(CONTENT_SESSION_KEY);
});

afterEach(() => {
  setDemoNow(null);
  sessionRemove(CONTENT_SESSION_KEY);
});

describe("contentService notices", () => {
  it("seeds the eight fictional notices as published and public", async () => {
    const list = await contentService.listForAudience("public");

    expect(list).toHaveLength(8);
    expect(list.every((notice) => notice.status === "published" && notice.audience === "public")).toBe(true);
    expect(list.map((notice) => notice.slug)).toContain("winter-air-quality-advisory");
    expect(list.map((notice) => notice.slug)).toContain("annual-day-invitation");
  });

  it("filters by audience: family rows stay off the public site but reach the portal", async () => {
    const result = await contentService.publishNotice(DRAFT_SLUG, {
      note: "Family newsletter",
      audience: "family",
    });
    expect(result.ok).toBe(true);

    const family = await contentService.listForAudience("family");
    expect(family.map((notice) => notice.slug)).toContain(DRAFT_SLUG);
    /* Families also see the seeded public rows. */
    expect(family.map((notice) => notice.slug)).toContain("winter-air-quality-advisory");

    const publicList = await contentService.listForAudience("public");
    expect(publicList.map((notice) => notice.slug)).not.toContain(DRAFT_SLUG);
  });

  it("hides draft and expired rows from public and portal lists", async () => {
    const staff = await contentService.listForStaff();
    expect(staff).toHaveLength(10);
    expect(staff.find((notice) => notice.slug === DRAFT_SLUG)?.status).toBe("draft");
    expect(staff.find((notice) => notice.slug === EXPIRED_SLUG)?.status).toBe("expired");

    for (const audience of ["public", "family"] as const) {
      const list = await contentService.listForAudience(audience);
      expect(list.some((notice) => notice.slug === DRAFT_SLUG)).toBe(false);
      expect(list.some((notice) => notice.slug === EXPIRED_SLUG)).toBe(false);
    }
  });

  it("requires a publish note and leaves the notice unchanged", async () => {
    const before = await contentService.listForStaff();

    const result = await contentService.publishNotice(DRAFT_SLUG, { note: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("note");
    }

    const after = await contentService.listForStaff();
    expect(after).toHaveLength(before.length);
    expect(after.find((notice) => notice.slug === DRAFT_SLUG)?.status).toBe("draft");
  });

  it("bumps the version and records the note on publish with the demo timestamp", async () => {
    const first = await contentService.publishNotice(DRAFT_SLUG, { note: "Approved by the publisher" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.version).toBe(1);
    expect(first.value.publishNote).toBe("Approved by the publisher");
    expect(first.value.status).toBe("published");
    expect(first.value.dateIso).toBe(PINNED.toISOString());

    const second = await contentService.publishNotice(DRAFT_SLUG, { note: "Reissued after review" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.version).toBe(2);
    expect(second.value.publishNote).toBe("Reissued after review");
    expect(second.value.dateIso).toBe(PINNED.toISOString());
  });

  it("reaches public and portal views after publish and leaves both on unpublish", async () => {
    await contentService.publishNotice(DRAFT_SLUG, { note: "Approved by the publisher" });

    const inPublic = await contentService.listForAudience("public");
    const inFamily = await contentService.listForAudience("family");
    expect(inPublic.map((notice) => notice.slug)).toContain(DRAFT_SLUG);
    expect(inFamily.map((notice) => notice.slug)).toContain(DRAFT_SLUG);

    await contentService.unpublishNotice(DRAFT_SLUG);

    const outPublic = await contentService.listForAudience("public");
    const outFamily = await contentService.listForAudience("family");
    expect(outPublic.map((notice) => notice.slug)).not.toContain(DRAFT_SLUG);
    expect(outFamily.map((notice) => notice.slug)).not.toContain(DRAFT_SLUG);
  });

  it("unpublishes a seeded published notice; republishing restores it with version 2", async () => {
    const unpublish = await contentService.unpublishNotice("library-week");
    expect(unpublish.ok).toBe(true);

    const afterUnpublish = await contentService.listForAudience("public");
    expect(afterUnpublish.map((notice) => notice.slug)).not.toContain("library-week");

    const republish = await contentService.publishNotice("library-week", { note: "Republished with the corrected date" });
    expect(republish.ok).toBe(true);
    if (republish.ok) {
      expect(republish.value.version).toBe(2);
      expect(republish.value.publishNote).toBe("Republished with the corrected date");
      expect(republish.value.dateIso).toBe(PINNED.toISOString());
    }

    const afterRepublish = await contentService.listForAudience("public");
    expect(afterRepublish.map((notice) => notice.slug)).toContain("library-week");
  });

  it("returns null for an unknown public notice and rejects unknown publishes", async () => {
    expect(await contentService.getNotice("not-a-real-notice", "public")).toBeNull();
    const result = await contentService.publishNotice("not-a-real-notice", { note: "nope" });
    expect(result.ok).toBe(false);
  });

  it("creates drafts with deterministic slugs; scheduled drafts stay out of lists", async () => {
    const draft = await contentService.createNotice({
      title: "School photograph day",
      category: "General",
      body: ["Body text."],
    });
    expect(draft.status).toBe("draft");
    expect(draft.slug).toBe("school-photograph-day");

    const scheduled = await contentService.createNotice({
      title: "School photograph day",
      category: "General",
      body: ["Body text."],
      scheduledForIso: "2026-09-01T00:00:00.000Z",
    });
    expect(scheduled.slug).toBe("school-photograph-day-2");
    expect(scheduled.status).toBe("draft");
    expect(scheduled.scheduledForIso).toBe("2026-09-01T00:00:00.000Z");

    const publicList = await contentService.listForAudience("public");
    expect(publicList.map((notice) => notice.slug)).not.toContain("school-photograph-day");
    expect(publicList.map((notice) => notice.slug)).not.toContain("school-photograph-day-2");
  });

  it("lists downloads and public-page rows for the staff content page", async () => {
    const downloads = await contentService.listDownloads();
    expect(downloads).toHaveLength(4);

    const pages = await contentService.listPublicPages();
    expect(pages).toHaveLength(7);
    expect(pages.some((row) => row.status === "Draft")).toBe(true);
  });
});
