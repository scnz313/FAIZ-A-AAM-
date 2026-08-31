/**
 * Content service tests — public page review status persistence and notice
 * editing against the session-backed demo store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({
  call: vi.fn(),
  mode: vi.fn(() => "demo" as "demo" | "supabase"),
}));

vi.mock("@/modules/services/adapter-client", () => ({
  adapterCall: adapterMocks.call,
  clientAdapterMode: adapterMocks.mode,
}));

import { setDemoNow } from "@/modules/demo/clock";
import {
  contentService,
  CONTENT_SESSION_KEY,
  CONTENT_INTENTS_SESSION_KEY,
  PUBLIC_PAGES_SESSION_KEY,
  type ContentActor,
  type ServerContentRow,
} from "@/modules/services/content";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");

/** The demo editor account that authored the seeded draft/needs-review pages. */
const DEMO_EDITOR_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";
const DEMO_EDITOR_ACTOR: ContentActor = {
  accountId: DEMO_EDITOR_ACCOUNT_ID,
  displayName: "Demo editor",
  role: "content_editor",
};
const DEMO_PUBLISHER_ACTOR: ContentActor = {
  accountId: "demo-content-publisher",
  displayName: "Demo publisher",
  role: "content_publisher",
};

const SERVER_CONTENT_ID = "00000000-0000-4000-8000-00000000c101";
const SERVER_EDITOR_ID = "00000000-0000-4000-8000-00000000c102";
const SERVER_PUBLISHER_ID = "00000000-0000-4000-8000-00000000c103";
const SERVER_VERSION_IDS = [
  "00000000-0000-4000-8000-00000000c111",
  "00000000-0000-4000-8000-00000000c112",
  "00000000-0000-4000-8000-00000000c113",
  "00000000-0000-4000-8000-00000000c114",
] as const;

function ok<T>(value: T) {
  return { ok: true as const, value };
}

function versionBody(audience: "public" | "family", publishNote = "Reviewed publication") {
  return {
    blocks: [{ type: "paragraph", text: "Authoritative notice body." }],
    metadata: { category: "General", urgent: false, audience, publishNote },
  };
}

function serverVersion(
  version: number,
  reviewStatus: "draft" | "in_review" | "approved" | "published",
  audience: "public" | "family" = "public",
  publishNote = "Reviewed publication",
) {
  return {
    id: SERVER_VERSION_IDS[version - 1] ?? `00000000-0000-4000-8000-00000000c1${version}`,
    version,
    title: "Adapter notice",
    body: versionBody(audience, publishNote),
    review_status: reviewStatus,
    published_at: reviewStatus === "published" ? "2026-08-10T06:00:00.000Z" : null,
    created_at: `2026-08-10T05:0${version}:00.000Z`,
    author_account_id: SERVER_EDITOR_ID,
    reviewed_by_account_id: reviewStatus === "approved" ? SERVER_PUBLISHER_ID : null,
    approved_at: reviewStatus === "approved" ? "2026-08-10T05:30:00.000Z" : null,
  };
}

function serverNoticeRow(input: {
  versions: NonNullable<ServerContentRow["content_versions"]>;
  itemVersion: number;
  status: "draft" | "scheduled" | "published" | "expired" | "archived";
  audience?: "public" | "family";
  slug?: string;
  kind?: string;
}): ServerContentRow {
  const audience = input.audience ?? "public";
  const latest = [...input.versions].sort((left, right) => right.version - left.version)[0];
  return {
    id: SERVER_CONTENT_ID,
    reference: "CTN-2026-C101",
    kind: input.kind ?? "notice",
    slug: input.slug ?? "adapter-notice",
    current_status: input.status,
    version: input.itemVersion,
    current_version_id: latest?.id ?? null,
    updated_at: "2026-08-10T06:00:00.000Z",
    content_versions: input.versions,
    notices:
      input.kind === "page"
        ? []
        : [
            {
              category: "General",
              urgent: false,
              status: input.status === "archived" ? "expired" : input.status,
              published_at: input.status === "published" ? "2026-08-10T06:00:00.000Z" : null,
              expires_at: null,
              review_due: "2026-09-01",
              scheduled_at: input.status === "scheduled" ? "2099-09-01T18:30:00.000Z" : null,
              notice_audiences: [{ audience: audience === "public" ? "public" : "academic_year" }],
            },
          ],
  };
}

/**
 * Drive a freshly-created draft notice through the maker/checker workflow
 * (request review, approve, publish) so it reaches the published state the
 * demo adapter now requires before a notice is visible to audiences.
 */
async function publishThroughWorkflow(slug: string, note: string) {
  await contentService.requestReview(slug);
  await contentService.approveVersion(slug, { actor: DEMO_PUBLISHER_ACTOR });
  return contentService.publishNotice(slug, { note });
}

beforeEach(() => {
  adapterMocks.call.mockReset();
  adapterMocks.mode.mockReset();
  adapterMocks.mode.mockReturnValue("demo");
  window.sessionStorage.clear();
  sessionRemove(CONTENT_SESSION_KEY);
  sessionRemove(CONTENT_INTENTS_SESSION_KEY);
  sessionRemove(PUBLIC_PAGES_SESSION_KEY);
  setDemoNow(PINNED);
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(CONTENT_SESSION_KEY);
  sessionRemove(CONTENT_INTENTS_SESSION_KEY);
  sessionRemove(PUBLIC_PAGES_SESSION_KEY);
  setDemoNow(new Date());
});

describe("contentService.setPublicPageStatus", () => {
  it("updates a page from Needs review to In review and persists", async () => {
    const before = await contentService.listPublicPages();
    const schoolLife = before.find((r) => r.key === "school-life");
    expect(schoolLife?.status).toBe("Needs review");

    const result = await contentService.setPublicPageStatus("school-life", "In review", DEMO_EDITOR_ACTOR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("In review");
    }

    const after = await contentService.listPublicPages();
    const updated = after.find((r) => r.key === "school-life");
    expect(updated?.status).toBe("In review");
  });

  it("advances a page from In review through Approved to Published and stamps the review date", async () => {
    await contentService.setPublicPageStatus("school-life", "In review", DEMO_EDITOR_ACTOR);
    await contentService.setPublicPageStatus("school-life", "Approved", DEMO_PUBLISHER_ACTOR);
    const result = await contentService.setPublicPageStatus("school-life", "Published", DEMO_PUBLISHER_ACTOR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("Published");
      expect(result.value.lastReviewed).not.toBe("—");
    }
  });

  it("rejects an unknown page key", async () => {
    const result = await contentService.setPublicPageStatus("nonexistent", "In review", DEMO_EDITOR_ACTOR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not found");
    }
  });

  it("persists across multiple reads (session-backed)", async () => {
    await contentService.setPublicPageStatus("careers", "In review", DEMO_EDITOR_ACTOR);
    const r1 = await contentService.listPublicPages();
    const r2 = await contentService.listPublicPages();
    expect(r1.find((p) => p.key === "careers")?.status).toBe("In review");
    expect(r2.find((p) => p.key === "careers")?.status).toBe("In review");
  });
});

describe("contentService maker/checker lifecycle", () => {
  it("requires a different publisher and keeps the approved note and audience immutable", async () => {
    const created = await contentService.createNotice({
      title: "Family review",
      category: "General",
      body: ["Family-only body."],
      audience: "family",
      publishNote: "Approved family wording",
      actor: DEMO_EDITOR_ACTOR,
    });

    const requested = await contentService.requestReview(created.slug, {
      actor: DEMO_EDITOR_ACTOR,
      expectedVersion: created.version,
    });
    expect(requested).toMatchObject({ ok: true, value: { reviewStatus: "in_review", version: 2 } });

    const sameAccountPublisher: ContentActor = { ...DEMO_EDITOR_ACTOR, role: "content_publisher" };
    const selfApproval = await contentService.approveVersion(created.slug, {
      actor: sameAccountPublisher,
      expectedVersion: 2,
    });
    expect(selfApproval).toMatchObject({ ok: false, code: "forbidden" });

    const approved = await contentService.approveVersion(created.slug, {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 2,
    });
    expect(approved).toMatchObject({
      ok: true,
      value: {
        reviewStatus: "approved",
        version: 3,
        audience: "family",
        publishNote: "Approved family wording",
      },
    });

    await expect(
      contentService.editNotice(created.slug, {
        actor: DEMO_EDITOR_ACTOR,
        expectedVersion: 2,
        publishNote: "Changed after approval",
      }),
    ).resolves.toMatchObject({ ok: false, code: "conflict", currentVersion: 3 });
    await expect(
      contentService.publishVersionV2(created.slug, {
        actor: DEMO_PUBLISHER_ACTOR,
        expectedVersion: 3,
        note: "Changed after approval",
      }),
    ).resolves.toMatchObject({ ok: false, code: "conflict" });
    await expect(
      contentService.publishVersionV2(created.slug, {
        actor: DEMO_PUBLISHER_ACTOR,
        expectedVersion: 3,
        note: "Approved family wording",
        audience: "public",
      }),
    ).resolves.toMatchObject({ ok: false, code: "conflict" });

    const published = await contentService.publishVersionV2(created.slug, {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 3,
      note: "Approved family wording",
      audience: "family",
    });
    expect(published).toMatchObject({
      ok: true,
      value: {
        status: "published",
        reviewStatus: "published",
        version: 4,
        audience: "family",
        publishNote: "Approved family wording",
      },
    });
  });

  it("schedules only an approved future version and archives a cancelled schedule", async () => {
    const created = await contentService.createNotice({
      title: "Scheduled family notice",
      category: "General",
      body: ["Scheduled body."],
      audience: "family",
      publishNote: "Publish on the selected date",
      actor: DEMO_EDITOR_ACTOR,
    });
    await contentService.requestReview(created.slug, { actor: DEMO_EDITOR_ACTOR, expectedVersion: 1 });
    await contentService.approveVersion(created.slug, { actor: DEMO_PUBLISHER_ACTOR, expectedVersion: 2 });

    await expect(
      contentService.publishVersionV2(created.slug, {
        actor: DEMO_PUBLISHER_ACTOR,
        expectedVersion: 3,
        scheduledForIso: PINNED.toISOString(),
      }),
    ).resolves.toMatchObject({ ok: false, code: "validation" });

    const scheduledForIso = "2026-08-12T00:00:00+05:30";
    const scheduled = await contentService.publishVersionV2(created.slug, {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 3,
      note: "Publish on the selected date",
      audience: "family",
      scheduledForIso,
    });
    expect(scheduled).toMatchObject({
      ok: true,
      value: { status: "scheduled", reviewStatus: "approved", scheduledForIso },
    });
    expect((await contentService.listForAudience("family")).some((notice) => notice.slug === created.slug)).toBe(false);

    const archived = await contentService.unpublishNotice(created.slug, {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 4,
      reason: "Schedule cancelled",
      idempotencyKey: "cancel-scheduled-family",
    });
    expect(archived).toMatchObject({ ok: true, value: { status: "archived", itemVersion: 5 } });
    const replay = await contentService.unpublishNotice(created.slug, {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 4,
      reason: "Schedule cancelled",
      idempotencyKey: "cancel-scheduled-family",
    });
    expect(replay).toMatchObject({ ok: true, replayed: true, value: { status: "archived", itemVersion: 5 } });
  });

  it("returns a recoverable stale-version result and replays each transition exactly once", async () => {
    const created = await contentService.createNotice({
      title: "Retry-safe notice",
      category: "General",
      body: ["Retry body."],
      publishNote: "Retry-safe note",
      actor: DEMO_EDITOR_ACTOR,
    });
    const edited = await contentService.editNotice(created.slug, {
      actor: DEMO_EDITOR_ACTOR,
      expectedVersion: 1,
      title: "Retry-safe notice v2",
    });
    expect(edited).toMatchObject({ ok: true, value: { version: 2 } });
    await expect(
      contentService.requestReview(created.slug, { actor: DEMO_EDITOR_ACTOR, expectedVersion: 1 }),
    ).resolves.toMatchObject({ ok: false, code: "stale-version", currentVersion: 2 });

    const reviewInput = {
      actor: DEMO_EDITOR_ACTOR,
      expectedVersion: 2,
      idempotencyKey: "review-retry-key",
    };
    const firstReview = await contentService.requestReview(created.slug, reviewInput);
    const reviewReplay = await contentService.requestReview(created.slug, reviewInput);
    expect(firstReview).toMatchObject({ ok: true, value: { version: 3 } });
    expect(reviewReplay).toMatchObject({ ok: true, replayed: true, value: { version: 3 } });

    const approveInput = {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 3,
      idempotencyKey: "approve-retry-key",
    };
    const firstApproval = await contentService.approveVersion(created.slug, approveInput);
    const approvalReplay = await contentService.approveVersion(created.slug, approveInput);
    expect(firstApproval).toMatchObject({ ok: true, value: { version: 4 } });
    expect(approvalReplay).toMatchObject({ ok: true, replayed: true, value: { version: 4 } });

    const publishInput = {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 4,
      idempotencyKey: "publish-retry-key",
      note: "Retry-safe note",
    };
    const firstPublish = await contentService.publishVersionV2(created.slug, publishInput);
    const publishReplay = await contentService.publishVersionV2(created.slug, publishInput);
    expect(firstPublish).toMatchObject({ ok: true, value: { version: 5 } });
    expect(publishReplay).toMatchObject({ ok: true, replayed: true, value: { version: 5 } });
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
      publishNote: "Initial publish",
    });
    await publishThroughWorkflow(created.slug, "Initial publish");

    const result = await contentService.editNotice(created.slug, {
      title: "Try to edit published",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Published or scheduled notices cannot be edited directly");
    }
  });

  it("allows editing after unpublishing", async () => {
    const created = await contentService.createNotice({
      title: "Temp published",
      category: "General",
      body: ["Body."],
      publishNote: "Initial publish",
    });
    await publishThroughWorkflow(created.slug, "Initial publish");
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
      publishNote: "First publish",
    });
    expect(created.status).toBe("draft");

    const result = await publishThroughWorkflow(created.slug, "First publish");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("published");
      expect(result.value.version).toBe(4);
      expect(result.value.publishNote).toBe("First publish");
    }
  });

  it("publishing a second version after re-editing bumps the version again", async () => {
    const created = await contentService.createNotice({
      title: "Already published",
      category: "General",
      body: ["Body."],
      publishNote: "First publish",
    });
    const first = await publishThroughWorkflow(created.slug, "First publish");
    expect(first.ok).toBe(true);
    const firstVersion = first.ok ? first.value.version : 0;

    await contentService.unpublishNotice(created.slug, { reason: "Needs an update" });
    await contentService.editNotice(created.slug, { title: "Updated title", publishNote: "Second publish" });
    const result = await publishThroughWorkflow(created.slug, "Second publish");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("published");
      expect(result.value.version).toBeGreaterThan(firstVersion);
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
  it("unpublishes a published notice and sets status to archived", async () => {
    const created = await contentService.createNotice({
      title: "To unpublish",
      category: "General",
      body: ["Body."],
      publishNote: "Publish first",
    });
    await publishThroughWorkflow(created.slug, "Publish first");

    const result = await contentService.unpublishNotice(created.slug);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
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
      expect(result.message).toContain("Only a published or scheduled");
    }
  });
});

describe("contentService.listForAudience", () => {
  it("returns only public-audience notices for the public scope", async () => {
    const created = await contentService.createNotice({
      title: "Public notice",
      category: "General",
      body: ["Body."],
      audience: "public",
      publishNote: "Publish",
    });
    await publishThroughWorkflow(created.slug, "Publish");

    const familyCreated = await contentService.createNotice({
      title: "Family notice",
      category: "General",
      body: ["Body."],
      audience: "family",
      publishNote: "Publish",
    });
    await publishThroughWorkflow(familyCreated.slug, "Publish");

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
      audience: "public",
      publishNote: "Publish",
    });
    await publishThroughWorkflow(publicCreated.slug, "Publish");

    const familyCreated = await contentService.createNotice({
      title: "Family notice",
      category: "General",
      body: ["Body."],
      audience: "family",
      publishNote: "Publish",
    });
    await publishThroughWorkflow(familyCreated.slug, "Publish");

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
      audience: "public",
      publishNote: "Publish",
    });
    await publishThroughWorkflow(created.slug, "Publish");

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

describe("contentService Supabase adapter contract", () => {
  beforeEach(() => {
    adapterMocks.mode.mockReturnValue("supabase");
  });

  it("calls the registered adapter operations for the complete maker/checker and archive flow", async () => {
    let row: ServerContentRow | null = null;
    adapterMocks.call.mockImplementation(async (operation: string, payload: Record<string, unknown>) => {
      if (operation === "content.list") return ok(row === null ? [] : [row]);
      if (operation === "content.saveDraft") {
        const draft = {
          ...serverVersion(1, "draft", "family", "Immutable family approval"),
          title: String(payload.title),
          body: payload.body,
        };
        row = serverNoticeRow({ versions: [draft], itemVersion: 1, status: "draft", audience: "family" });
        return ok({
          id: SERVER_CONTENT_ID,
          reference: "CTN-2026-C101",
          versionId: draft.id,
          version: 1,
          status: "draft",
          replayed: false,
        });
      }
      if (operation === "content.requestReview") {
        const source = (row as ServerContentRow).content_versions?.[0];
        const reviewed = { ...source!, id: SERVER_VERSION_IDS[1], version: 2, review_status: "in_review" };
        row = serverNoticeRow({ versions: [source!, reviewed], itemVersion: 2, status: "draft", audience: "family" });
        return ok({ id: reviewed.id, version: 2, status: "in_review", replayed: false });
      }
      if (operation === "content.approveVersion") {
        const versions = (row as ServerContentRow).content_versions ?? [];
        const source = versions.find((candidate) => candidate.version === 2)!;
        const approved = {
          ...source,
          id: SERVER_VERSION_IDS[2],
          version: 3,
          review_status: "approved",
          reviewed_by_account_id: SERVER_PUBLISHER_ID,
          approved_at: "2026-08-10T05:30:00.000Z",
        };
        row = serverNoticeRow({ versions: [...versions, approved], itemVersion: 2, status: "draft", audience: "family" });
        return ok({ id: approved.id, version: 3, status: "approved", replayed: false });
      }
      if (operation === "content.publishVersion") {
        const versions = (row as ServerContentRow).content_versions ?? [];
        const source = versions.find((candidate) => candidate.version === 3)!;
        const published = {
          ...source,
          id: SERVER_VERSION_IDS[3],
          version: 4,
          review_status: "published",
          published_at: "2026-08-10T06:00:00.000Z",
        };
        row = serverNoticeRow({ versions: [...versions, published], itemVersion: 4, status: "published", audience: "family" });
        return ok({
          id: SERVER_CONTENT_ID,
          reference: "CTN-2026-C101",
          versionId: published.id,
          version: 4,
          status: "published",
          replayed: false,
        });
      }
      if (operation === "content.unpublish") {
        row = serverNoticeRow({
          versions: (row as ServerContentRow).content_versions ?? [],
          itemVersion: 5,
          status: "archived",
          audience: "family",
        });
        return ok({ id: SERVER_CONTENT_ID, version: 5, status: "archived", replayed: false });
      }
      throw new Error(`Unexpected adapter operation ${operation}`);
    });

    const created = await contentService.createNotice({
      title: "Adapter notice",
      category: "General",
      body: ["Authoritative notice body."],
      audience: "family",
      publishNote: "Immutable family approval",
      actor: DEMO_EDITOR_ACTOR,
      idempotencyKey: "adapter-create-key",
    });
    expect(created).toMatchObject({ status: "draft", reviewStatus: "draft", audience: "family", version: 1 });

    const requested = await contentService.requestReview(created.slug, {
      actor: DEMO_EDITOR_ACTOR,
      expectedVersion: 1,
      idempotencyKey: "adapter-review-key",
    });
    expect(requested).toMatchObject({ ok: true, value: { reviewStatus: "in_review", version: 2 } });

    const approved = await contentService.approveVersion(created.slug, {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 2,
      idempotencyKey: "adapter-approve-key",
    });
    expect(approved).toMatchObject({
      ok: true,
      value: { reviewStatus: "approved", version: 3, audience: "family", publishNote: "Immutable family approval" },
    });

    const published = await contentService.publishVersionV2(created.slug, {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 3,
      idempotencyKey: "adapter-publish-key",
      note: "Immutable family approval",
      audience: "family",
    });
    expect(published).toMatchObject({
      ok: true,
      value: { status: "published", reviewStatus: "published", version: 4, audience: "family" },
    });
    expect((await contentService.listForAudience("public")).some((notice) => notice.slug === created.slug)).toBe(false);
    expect((await contentService.listForAudience("family")).some((notice) => notice.slug === created.slug)).toBe(true);

    const archived = await contentService.unpublishNotice(created.slug, {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 4,
      reason: "Superseded notice",
    });
    expect(archived).toMatchObject({ ok: true, value: { status: "archived", itemVersion: 5 } });
    const archiveReplay = await contentService.unpublishNotice(created.slug, {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: 4,
      reason: "Superseded notice",
    });
    expect(archiveReplay).toMatchObject({ ok: true, replayed: true, value: { status: "archived" } });
    expect(await contentService.listForAudience("family")).toEqual([]);

    const calls = adapterMocks.call.mock.calls as Array<[string, Record<string, unknown>]>;
    const savePayload = calls.find(([operation]) => operation === "content.saveDraft")?.[1];
    expect(savePayload).toEqual({
      kind: "notice",
      slug: "adapter-notice",
      title: "Adapter notice",
      body: versionBody("family", "Immutable family approval"),
      idempotencyKey: "adapter-create-key",
    });
    expect(savePayload).not.toHaveProperty("contentItemId");
    expect(calls.find(([operation]) => operation === "content.requestReview")?.[1]).toEqual({
      versionId: SERVER_VERSION_IDS[0],
      expectedVersion: 1,
      idempotencyKey: "adapter-review-key",
    });
    expect(calls.find(([operation]) => operation === "content.approveVersion")?.[1]).toEqual({
      versionId: SERVER_VERSION_IDS[1],
      expectedVersion: 2,
      idempotencyKey: "adapter-approve-key",
    });
    expect(calls.find(([operation]) => operation === "content.publishVersion")?.[1]).toEqual({
      versionId: SERVER_VERSION_IDS[2],
      expectedVersion: 3,
      scheduledAt: null,
      expiresAt: null,
      idempotencyKey: "adapter-publish-key",
    });
    expect(calls.filter(([operation]) => operation === "content.unpublish")).toHaveLength(1);
    expect(calls.find(([operation]) => operation === "content.unpublish")?.[1]).toEqual({
      contentItemId: SERVER_CONTENT_ID,
      reason: "Superseded notice",
      expectedVersion: 4,
    });
  });

  it("normalizes Kolkata schedule and expiry inputs before calling the adapter", async () => {
    let row = serverNoticeRow({
      versions: [serverVersion(1, "draft"), serverVersion(2, "in_review"), serverVersion(3, "approved")],
      itemVersion: 2,
      status: "draft",
    });
    adapterMocks.call.mockImplementation(async (operation: string, payload: Record<string, unknown>) => {
      if (operation === "content.list") return ok([row]);
      if (operation === "content.publishVersion") {
        const source = row.content_versions?.find((candidate) => candidate.version === 3)!;
        const scheduled = { ...source, id: SERVER_VERSION_IDS[3], version: 4 };
        row = serverNoticeRow({ versions: [...(row.content_versions ?? []), scheduled], itemVersion: 4, status: "scheduled" });
        return ok({
          id: SERVER_CONTENT_ID,
          reference: row.reference,
          versionId: scheduled.id,
          version: 4,
          status: "scheduled",
          replayed: false,
        });
      }
      throw new Error(`Unexpected adapter operation ${operation}`);
    });

    await expect(
      contentService.publishVersionV2(row.slug, {
        expectedVersion: 3,
        note: "Changed after approval",
      }),
    ).resolves.toMatchObject({ ok: false, code: "conflict" });
    await expect(
      contentService.publishVersionV2(row.slug, {
        expectedVersion: 3,
        note: "Reviewed publication",
        audience: "family",
      }),
    ).resolves.toMatchObject({ ok: false, code: "conflict" });
    expect(adapterMocks.call.mock.calls.filter(([operation]) => operation === "content.publishVersion")).toHaveLength(0);

    const result = await contentService.publishVersionV2(row.slug, {
      expectedVersion: 3,
      note: "Reviewed publication",
      audience: "public",
      scheduledForIso: "2099-09-02T00:00:00+05:30",
      expiresAtIso: "2099-09-03T00:00:00+05:30",
      idempotencyKey: "adapter-schedule-key",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "scheduled",
        reviewStatus: "approved",
        scheduledForIso: "2099-09-01T18:30:00.000Z",
      },
    });
    expect(adapterMocks.call.mock.calls.find(([operation]) => operation === "content.publishVersion")?.[1]).toEqual({
      versionId: SERVER_VERSION_IDS[2],
      expectedVersion: 3,
      scheduledAt: "2099-09-01T18:30:00.000Z",
      expiresAt: "2099-09-02T18:30:00.000Z",
      idempotencyKey: "adapter-schedule-key",
    });
  });

  it("reaches the adapter with the original immutable version on an immediate idempotent retry", async () => {
    let row = serverNoticeRow({
      versions: [serverVersion(1, "draft"), serverVersion(2, "in_review"), serverVersion(3, "approved")],
      itemVersion: 2,
      status: "draft",
    });
    let publishCalls = 0;
    adapterMocks.call.mockImplementation(async (operation: string) => {
      if (operation === "content.list") return ok([row]);
      if (operation === "content.publishVersion") {
        publishCalls += 1;
        if (publishCalls === 1) {
          const source = row.content_versions?.find((candidate) => candidate.version === 3)!;
          const published = {
            ...source,
            id: SERVER_VERSION_IDS[3],
            version: 4,
            review_status: "published",
            published_at: "2026-08-10T06:00:00.000Z",
          };
          row = serverNoticeRow({ versions: [...(row.content_versions ?? []), published], itemVersion: 4, status: "published" });
        }
        return ok({
          id: SERVER_CONTENT_ID,
          reference: row.reference,
          versionId: SERVER_VERSION_IDS[3],
          version: 4,
          status: "published",
          replayed: publishCalls > 1,
        });
      }
      throw new Error(`Unexpected adapter operation ${operation}`);
    });

    const input = {
      expectedVersion: 3,
      note: "Reviewed publication",
      audience: "public" as const,
      idempotencyKey: "same-publish-intent",
    };
    const first = await contentService.publishVersionV2(row.slug, input);
    const replay = await contentService.publishVersionV2(row.slug, input);
    expect(first).toMatchObject({ ok: true, value: { version: 4 } });
    expect(replay).toMatchObject({ ok: true, replayed: true, value: { version: 4 } });

    const publishPayloads = adapterMocks.call.mock.calls
      .filter(([operation]) => operation === "content.publishVersion")
      .map(([, payload]) => payload);
    expect(publishPayloads).toHaveLength(2);
    expect(publishPayloads[1]).toEqual(publishPayloads[0]);
    expect(publishPayloads[1]).toMatchObject({ versionId: SERVER_VERSION_IDS[2], expectedVersion: 3 });
  });

  it("rejects an unrelated stale draft before sending a review transition", async () => {
    const first = serverVersion(1, "draft");
    const unrelated = { ...serverVersion(2, "draft"), title: "Someone else's newer draft" };
    const row = serverNoticeRow({ versions: [first, unrelated], itemVersion: 2, status: "draft" });
    adapterMocks.call.mockImplementation(async (operation: string) => {
      if (operation === "content.list") return ok([row]);
      throw new Error(`Unexpected adapter operation ${operation}`);
    });

    const result = await contentService.requestReview(row.slug, {
      expectedVersion: 1,
      idempotencyKey: "stale-review-intent",
    });
    expect(result).toMatchObject({ ok: false, code: "stale-version", currentVersion: 2, currentState: "draft" });
    expect(adapterMocks.call.mock.calls.some(([operation]) => operation === "content.requestReview")).toBe(false);
  });

  it("uses the same request, approve, and publish adapter operations for public pages", async () => {
    let row = serverNoticeRow({
      versions: [serverVersion(1, "draft")],
      itemVersion: 1,
      status: "draft",
      kind: "page",
      slug: "school-life",
    });
    adapterMocks.call.mockImplementation(async (operation: string) => {
      if (operation === "content.list") return ok([row]);
      const versions = row.content_versions ?? [];
      if (operation === "content.requestReview") {
        const source = versions[0]!;
        const reviewed = { ...source, id: SERVER_VERSION_IDS[1], version: 2, review_status: "in_review" };
        row = serverNoticeRow({ versions: [...versions, reviewed], itemVersion: 2, status: "draft", kind: "page", slug: row.slug });
        return ok({ id: reviewed.id, version: 2, status: "in_review", replayed: false });
      }
      if (operation === "content.approveVersion") {
        const source = versions.find((candidate) => candidate.version === 2)!;
        const approved = { ...source, id: SERVER_VERSION_IDS[2], version: 3, review_status: "approved" };
        row = serverNoticeRow({ versions: [...versions, approved], itemVersion: 2, status: "draft", kind: "page", slug: row.slug });
        return ok({ id: approved.id, version: 3, status: "approved", replayed: false });
      }
      if (operation === "content.publishVersion") {
        const source = versions.find((candidate) => candidate.version === 3)!;
        const published = {
          ...source,
          id: SERVER_VERSION_IDS[3],
          version: 4,
          review_status: "published",
          published_at: "2026-08-10T06:00:00.000Z",
        };
        row = serverNoticeRow({ versions: [...versions, published], itemVersion: 4, status: "published", kind: "page", slug: row.slug });
        return ok({
          id: SERVER_CONTENT_ID,
          reference: row.reference,
          versionId: published.id,
          version: 4,
          status: "published",
          replayed: false,
        });
      }
      throw new Error(`Unexpected adapter operation ${operation}`);
    });

    const requested = await contentService.setPublicPageStatus("school-life", "In review", DEMO_EDITOR_ACTOR, {
      expectedVersion: 1,
      idempotencyKey: "page-review-key",
    });
    expect(requested).toMatchObject({ ok: true, value: { status: "In review", version: 2 } });
    const approved = await contentService.setPublicPageStatus("school-life", "Approved", DEMO_PUBLISHER_ACTOR, {
      expectedVersion: 2,
      idempotencyKey: "page-approve-key",
    });
    expect(approved).toMatchObject({ ok: true, value: { status: "Approved", version: 3 } });
    const published = await contentService.setPublicPageStatus("school-life", "Published", DEMO_PUBLISHER_ACTOR, {
      expectedVersion: 3,
      idempotencyKey: "page-publish-key",
    });
    expect(published).toMatchObject({ ok: true, value: { status: "Published", version: 4 } });

    const transitionCalls = adapterMocks.call.mock.calls.filter(([operation]) => operation !== "content.list");
    expect(transitionCalls).toEqual([
      [
        "content.requestReview",
        { versionId: SERVER_VERSION_IDS[0], expectedVersion: 1, idempotencyKey: "page-review-key" },
      ],
      [
        "content.approveVersion",
        { versionId: SERVER_VERSION_IDS[1], expectedVersion: 2, idempotencyKey: "page-approve-key" },
      ],
      [
        "content.publishVersion",
        {
          versionId: SERVER_VERSION_IDS[2],
          expectedVersion: 3,
          scheduledAt: null,
          expiresAt: null,
          idempotencyKey: "page-publish-key",
        },
      ],
    ]);
  });

  it("defensively filters public, family, non-notice, and archived adapter rows", async () => {
    const publicRow = serverNoticeRow({
      versions: [serverVersion(1, "published", "public")],
      itemVersion: 1,
      status: "published",
      audience: "public",
      slug: "public-adapter-notice",
    });
    publicRow.id = "00000000-0000-4000-8000-00000000c201";
    const familyRow = serverNoticeRow({
      versions: [serverVersion(1, "published", "family")],
      itemVersion: 1,
      status: "published",
      audience: "family",
      slug: "family-adapter-notice",
    });
    familyRow.id = "00000000-0000-4000-8000-00000000c202";
    const pageRow = serverNoticeRow({
      versions: [serverVersion(1, "published", "public")],
      itemVersion: 1,
      status: "published",
      kind: "page",
      slug: "about",
    });
    const archivedRow = serverNoticeRow({
      versions: [serverVersion(1, "published", "public")],
      itemVersion: 2,
      status: "archived",
      audience: "public",
      slug: "archived-adapter-notice",
    });
    adapterMocks.call.mockResolvedValue(ok([publicRow, familyRow, pageRow, archivedRow]));

    const publicNotices = await contentService.listForAudience("public");
    const familyNotices = await contentService.listForAudience("family");
    expect(publicNotices.map((notice) => notice.slug)).toEqual(["public-adapter-notice"]);
    expect(familyNotices.map((notice) => notice.slug)).toEqual([
      "public-adapter-notice",
      "family-adapter-notice",
    ]);
    expect(adapterMocks.call.mock.calls).toEqual([
      ["content.list", { scope: "public" }],
      ["content.list", { scope: "family" }],
    ]);
  });
});
