/**
 * Content service tests — public page review status persistence and notice
 * editing against the session-backed demo store.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  contentService,
  CONTENT_SESSION_KEY,
  PUBLIC_PAGES_SESSION_KEY,
} from "@/modules/services/content";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(CONTENT_SESSION_KEY);
  sessionRemove(PUBLIC_PAGES_SESSION_KEY);
  setDemoNow(PINNED);
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(CONTENT_SESSION_KEY);
  sessionRemove(PUBLIC_PAGES_SESSION_KEY);
  setDemoNow(new Date());
});

describe("contentService.setPublicPageStatus", () => {
  it("updates a page from Needs review to In review and persists", async () => {
    const before = await contentService.listPublicPages();
    const schoolLife = before.find((r) => r.key === "school-life");
    expect(schoolLife?.status).toBe("Needs review");

    const result = await contentService.setPublicPageStatus("school-life", "In review", "Test Editor");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("In review");
    }

    const after = await contentService.listPublicPages();
    const updated = after.find((r) => r.key === "school-life");
    expect(updated?.status).toBe("In review");
  });

  it("updates a page from In review to Published and stamps the review date", async () => {
    await contentService.setPublicPageStatus("school-life", "In review", "Test Editor");
    const result = await contentService.setPublicPageStatus("school-life", "Published", "Test Publisher");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("Published");
      expect(result.value.lastReviewed).not.toBe("—");
    }
  });

  it("rejects an unknown page key", async () => {
    const result = await contentService.setPublicPageStatus("nonexistent", "In review", "Test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not found");
    }
  });

  it("persists across multiple reads (session-backed)", async () => {
    await contentService.setPublicPageStatus("careers", "In review", "Test");
    const r1 = await contentService.listPublicPages();
    const r2 = await contentService.listPublicPages();
    expect(r1.find((p) => p.key === "careers")?.status).toBe("In review");
    expect(r2.find((p) => p.key === "careers")?.status).toBe("In review");
  });
});

describe("contentService.editNotice", () => {
  it("edits a draft notice's title, category, and body", async () => {
    const created = await contentService.createNotice({
      title: "Original draft",
      category: "General",
      body: ["Original body text."],
    });

    const result = await contentService.editNotice(created.slug, {
      title: "Updated title",
      category: "Examination",
      body: ["Updated body text."],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Updated title");
      expect(result.value.category).toBe("Examination");
      expect(result.value.body).toEqual(["Updated body text."]);
      expect(result.value.excerpt).toBe("Updated body text.");
    }
  });

  it("rejects editing a published notice", async () => {
    const created = await contentService.createNotice({
      title: "To publish",
      category: "General",
      body: ["Body."],
    });
    await contentService.publishNotice(created.slug, { note: "Initial publish" });

    const result = await contentService.editNotice(created.slug, {
      title: "Try to edit published",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Published notices cannot be edited");
    }
  });

  it("allows editing after unpublishing", async () => {
    const created = await contentService.createNotice({
      title: "Temp published",
      category: "General",
      body: ["Body."],
    });
    await contentService.publishNotice(created.slug, { note: "Initial publish" });
    await contentService.unpublishNotice(created.slug);

    const result = await contentService.editNotice(created.slug, {
      title: "Edited after unpublish",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Edited after unpublish");
    }
  });

  it("rejects an unknown notice slug", async () => {
    const result = await contentService.editNotice("nonexistent-slug", {
      title: "New title",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not found");
    }
  });

  it("preserves fields not included in the edit input", async () => {
    const created = await contentService.createNotice({
      title: "Keep category",
      category: "Examination",
      body: ["Keep this body."],
    });

    const result = await contentService.editNotice(created.slug, {
      title: "New title only",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("New title only");
      expect(result.value.category).toBe("Examination");
      expect(result.value.body).toEqual(["Keep this body."]);
    }
  });
});

describe("contentService.publishNotice", () => {
  it("publishes a draft notice and sets status to published", async () => {
    const created = await contentService.createNotice({
      title: "Draft to publish",
      category: "General",
      body: ["Body text."],
    });
    expect(created.status).toBe("draft");

    const result = await contentService.publishNotice(created.slug, { note: "First publish" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("published");
      expect(result.value.version).toBe(1);
      expect(result.value.publishNote).toBe("First publish");
    }
  });

  it("re-publishing an already-published notice bumps the version again", async () => {
    const created = await contentService.createNotice({
      title: "Already published",
      category: "General",
      body: ["Body."],
    });
    const first = await contentService.publishNotice(created.slug, { note: "First publish" });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.version).toBe(1);

    const result = await contentService.publishNotice(created.slug, { note: "Second publish" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("published");
      expect(result.value.version).toBe(2);
      expect(result.value.publishNote).toBe("Second publish");
    }
  });

  it("rejects an unknown slug", async () => {
    const result = await contentService.publishNotice("nonexistent-slug", { note: "Publish" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not found");
    }
  });
});

describe("contentService.unpublishNotice", () => {
  it("unpublishes a published notice and sets status to draft", async () => {
    const created = await contentService.createNotice({
      title: "To unpublish",
      category: "General",
      body: ["Body."],
    });
    await contentService.publishNotice(created.slug, { note: "Publish first" });

    const result = await contentService.unpublishNotice(created.slug);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("draft");
    }
  });

  it("rejects unpublishing a draft notice", async () => {
    const created = await contentService.createNotice({
      title: "Still draft",
      category: "General",
      body: ["Body."],
    });
    expect(created.status).toBe("draft");

    const result = await contentService.unpublishNotice(created.slug);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not published");
    }
  });
});

describe("contentService.listForAudience", () => {
  it("returns only public-audience notices for the public scope", async () => {
    const created = await contentService.createNotice({
      title: "Public notice",
      category: "General",
      body: ["Body."],
    });
    await contentService.publishNotice(created.slug, { note: "Publish", audience: "public" });

    const familyCreated = await contentService.createNotice({
      title: "Family notice",
      category: "General",
      body: ["Body."],
    });
    await contentService.publishNotice(familyCreated.slug, { note: "Publish", audience: "family" });

    const list = await contentService.listForAudience("public");
    expect(list.every((n) => n.audience === "public")).toBe(true);
    expect(list.some((n) => n.slug === created.slug)).toBe(true);
    expect(list.some((n) => n.slug === familyCreated.slug)).toBe(false);
  });

  it("returns both public and family notices for the family scope", async () => {
    const publicCreated = await contentService.createNotice({
      title: "Public notice",
      category: "General",
      body: ["Body."],
    });
    await contentService.publishNotice(publicCreated.slug, { note: "Publish", audience: "public" });

    const familyCreated = await contentService.createNotice({
      title: "Family notice",
      category: "General",
      body: ["Body."],
    });
    await contentService.publishNotice(familyCreated.slug, { note: "Publish", audience: "family" });

    const list = await contentService.listForAudience("family");
    expect(list.some((n) => n.slug === publicCreated.slug)).toBe(true);
    expect(list.some((n) => n.slug === familyCreated.slug)).toBe(true);
  });
});

describe("contentService.getNotice", () => {
  it("returns a published notice by slug", async () => {
    const created = await contentService.createNotice({
      title: "Find me",
      category: "General",
      body: ["Body."],
    });
    await contentService.publishNotice(created.slug, { note: "Publish", audience: "public" });

    const notice = await contentService.getNotice(created.slug, "public");
    expect(notice).not.toBeNull();
    expect(notice?.slug).toBe(created.slug);
    expect(notice?.status).toBe("published");
  });

  it("returns null for an unknown slug", async () => {
    const notice = await contentService.getNotice("nonexistent-slug", "public");
    expect(notice).toBeNull();
  });
});
