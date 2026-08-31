/**
 * Typed content-service boundary: notices with status, audience, version and
 * publish notes, plus the public download register and the staff content
 * page's public-page review rows. The demo adapter seeds from the existing
 * fictional notices (published, public) plus two staff-only rows that
 * exercise draft and expired states; the backend phase replaces it behind the
 * same signatures.
 *
 * Demo adapter contract:
 * - The session store (`modules/services/session.ts`) holds the notice list,
 *   so publish/unpublish persist within the browser session and every
 *   consumer (public list, portal list, staff workspaces) reads the same
 *   record. Fixtures are the fallback for a fresh session.
 * - Publish requires a non-empty note and bumps the version; timestamps come
 *   from the injected demo clock (`demoNowIso`). Nothing is random, and
 *   nothing reads the wall clock.
 * - All methods resolve immediately (no artificial latency).
 */

import type { ErrorCode, ServiceResult } from "@fass/contracts";

import { demoNowIso } from "@/modules/demo/clock";
import { formatKolkata } from "@/modules/iot/domain";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import { auditService } from "@/modules/services/audit";
import { enqueueOutboxEvent } from "@/modules/services/outbox";
import {
  notices as fixtureNotices,
  noticeCategories,
  noticeReviewDue,
  staffDraftNotices,
  staffExpiredNotices,
  vacancies,
  type Notice,
  type NoticeCategory,
  type Vacancy,
} from "@/modules/content/demo";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

export type { Notice, NoticeCategory, Vacancy };
export { noticeCategories } from "@/modules/content/demo";

/** Public download register row (mirrors the notices page's demo register). */
export type DownloadItem = {
  name: string;
  kind: string;
  size: string;
  updated: string;
};

/* ------------------------------------------------------------------ */
/* Notice lifecycle types                                              */
/* ------------------------------------------------------------------ */

export type NoticeStatus = "draft" | "scheduled" | "published" | "expired" | "archived";
export type NoticeAudience = "public" | "family";
export type ContentReviewStatus = "draft" | "in_review" | "approved" | "published";

/**
 * The browser supplies this only to make the deterministic demo enforce the
 * same maker/checker rules as the server. Supabase never authorizes from this
 * value: the adapter operation resolves the authenticated account and grant.
 */
export type ContentActor = {
  accountId: string;
  displayName: string;
  role: string;
};

/**
 * A notice with both the mutable item revision and immutable content-version
 * state. Approval currently appends a version without changing the item
 * revision, while unpublish increments the item revision without rewriting a
 * content version, so the two counters must not be conflated.
 */
export type ContentNotice = Notice & {
  contentItemId?: string;
  reference?: string;
  contentKind: "notice";
  versionId?: string;
  status: NoticeStatus;
  reviewStatus: ContentReviewStatus;
  audience: NoticeAudience;
  /** Latest immutable content-version number. */
  version: number;
  /** Optimistic revision of the mutable content item. */
  itemVersion: number;
  authorAccountId: string | null;
  reviewedByAccountId: string | null;
  /** Proposed by the editor and preserved inside immutable version metadata. */
  publishNote?: string;
  reviewDue: string;
  scheduledForIso: string | null;
};

/** Every write returns a typed, conflict-aware outcome for recoverable UI. */
export type ContentResult<T> =
  | { ok: true; value: T; replayed?: boolean }
  | {
      ok: false;
      message: string;
      code: ErrorCode;
      currentVersion?: number;
      currentState?: unknown;
      retryable?: boolean;
    };

/** Review states for the staff content page's public-page workflow table. */
export type PublicPageReviewStatus =
  | "Published"
  | "Scheduled"
  | "Approved"
  | "Draft"
  | "Needs review"
  | "In review"
  | "Archived";

export type PublicPageRow = {
  key: string;
  contentItemId?: string;
  reference?: string;
  versionId?: string;
  version: number;
  itemVersion: number;
  reviewStatus: ContentReviewStatus;
  currentStatus: NoticeStatus;
  authorAccountId: string | null;
  reviewedByAccountId: string | null;
  publishNote?: string;
  scheduledForIso: string | null;
  label: string;
  href: string;
  status: PublicPageReviewStatus;
  lastReviewed: string;
  owner: string;
};

const DEMO_CONTENT_EDITOR_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";
const SEEDED_CONTENT_AUTHOR_ID = "demo-content-seed-editor";

function publicPage(
  key: string,
  label: string,
  status: PublicPageReviewStatus,
  lastReviewed: string,
  owner: string,
): PublicPageRow {
  const published = status === "Published";
  return {
    key,
    versionId: `page:${key}:v1`,
    version: 1,
    itemVersion: 1,
    reviewStatus: published ? "published" : "draft",
    currentStatus: published ? "published" : "draft",
    authorAccountId: published ? SEEDED_CONTENT_AUTHOR_ID : DEMO_CONTENT_EDITOR_ACCOUNT_ID,
    reviewedByAccountId: published ? "demo-content-seed-publisher" : null,
    publishNote: published ? "Initial publication" : undefined,
    scheduledForIso: null,
    label,
    href: `/${key}`,
    status,
    lastReviewed,
    owner,
  };
}

/** Public pages with review state — fictional demo data. */
const PUBLIC_PAGES: PublicPageRow[] = [
  publicPage("about", "About", "Published", "28 Jul 2026", "N. Lone"),
  publicPage("academics", "Academics", "Published", "28 Jul 2026", "N. Lone"),
  publicPage("admissions", "Admissions", "Published", "20 Jul 2026", "N. Lone"),
  publicPage("school-life", "School life", "Needs review", "15 Jul 2026", "N. Lone"),
  publicPage("notices", "Notices", "Published", "01 Aug 2026", "A. Lone"),
  publicPage("careers", "Careers", "Draft", "—", "R. Wani"),
  publicPage("contact", "Contact", "Published", "01 Jul 2026", "N. Lone"),
];

/** Session key holding the mutable public-page list. */
export const PUBLIC_PAGES_SESSION_KEY = sessionKey("content-public-pages");

function normalizePublicPage(row: PublicPageRow): PublicPageRow {
  const published = row.status === "Published";
  return {
    ...row,
    versionId: row.versionId ?? `page:${row.key}:v${row.version ?? 1}`,
    version: row.version ?? 1,
    itemVersion: row.itemVersion ?? row.version ?? 1,
    reviewStatus:
      row.reviewStatus ??
      (row.status === "In review" ? "in_review" : row.status === "Approved" ? "approved" : published ? "published" : "draft"),
    currentStatus:
      row.currentStatus ??
      (row.status === "Scheduled" ? "scheduled" : row.status === "Archived" ? "archived" : published ? "published" : "draft"),
    authorAccountId: row.authorAccountId ?? (published ? SEEDED_CONTENT_AUTHOR_ID : DEMO_CONTENT_EDITOR_ACCOUNT_ID),
    reviewedByAccountId: row.reviewedByAccountId ?? null,
    scheduledForIso: row.scheduledForIso ?? null,
  };
}

function loadPublicPages(): PublicPageRow[] {
  const stored = sessionGet<PublicPageRow[]>(PUBLIC_PAGES_SESSION_KEY);
  if (stored !== null) return stored.map((row) => normalizePublicPage({ ...row }));
  const seeded = PUBLIC_PAGES.map((row) => ({ ...row }));
  sessionSet(PUBLIC_PAGES_SESSION_KEY, seeded);
  return seeded.map((row) => ({ ...row }));
}

function savePublicPages(rows: PublicPageRow[]): void {
  sessionSet(PUBLIC_PAGES_SESSION_KEY, rows.map((row) => ({ ...row })));
}

/** Session key holding the mutable public-page body store (demo adapter only). */
const PUBLIC_PAGE_BODIES_SESSION_KEY = sessionKey("content-public-page-bodies");

function loadPublicPageBodies(): Map<string, { title: string; body: string[]; updatedAtIso: string | null }> {
  const stored = sessionGet<Array<{ key: string; title: string; body: string[]; updatedAtIso: string | null }>>(PUBLIC_PAGE_BODIES_SESSION_KEY);
  const map = new Map<string, { title: string; body: string[]; updatedAtIso: string | null }>();
  for (const entry of stored ?? []) map.set(entry.key, { title: entry.title, body: [...entry.body], updatedAtIso: entry.updatedAtIso });
  return map;
}

function savePublicPageBodies(map: Map<string, { title: string; body: string[]; updatedAtIso: string | null }>): void {
  sessionSet(PUBLIC_PAGE_BODIES_SESSION_KEY, [...map.entries()].map(([key, entry]) => ({ key, ...entry })));
}

/* ------------------------------------------------------------------ */
/* Demo adapter                                                        */
/* ------------------------------------------------------------------ */

/** Session key holding the mutable notice list. */
export const CONTENT_SESSION_KEY = sessionKey("content");

/** Same rows the public notices page shows today; delivery arrives with the document backend. */
const DOWNLOADS: DownloadItem[] = [
  { name: "Fee schedule — session 2026-27", kind: "PDF", size: "212 KB", updated: "28 Jul 2026" },
  { name: "Admission application form", kind: "PDF", size: "148 KB", updated: "20 Jul 2026" },
  { name: "Uniform and book list", kind: "PDF", size: "96 KB", updated: "18 Jul 2026" },
  { name: "Academic calendar", kind: "PDF", size: "184 KB", updated: "15 Jul 2026" },
];

const DEFAULT_DEMO_EDITOR: ContentActor = {
  accountId: "demo-content-editor",
  displayName: "Demo content editor",
  role: "content_editor",
};
const DEFAULT_DEMO_PUBLISHER: ContentActor = {
  accountId: "demo-content-publisher",
  displayName: "Demo content publisher",
  role: "content_publisher",
};

type DemoIntent = {
  key: string;
  action:
    | "request-review"
    | "approve"
    | "publish"
    | "unpublish"
    | "page-request-review"
    | "page-approve"
    | "page-publish";
  notice?: ContentNotice;
  page?: PublicPageRow;
};
export const CONTENT_INTENTS_SESSION_KEY = sessionKey("content-workflow-intents");

function loadIntents(): DemoIntent[] {
  return sessionGet<DemoIntent[]>(CONTENT_INTENTS_SESSION_KEY) ?? [];
}

function saveIntent(intent: DemoIntent): void {
  const intents = loadIntents();
  const withoutKey = intents.filter((candidate) => candidate.key !== intent.key);
  sessionSet(CONTENT_INTENTS_SESSION_KEY, [...withoutKey, intent]);
}

function replayedNotice(key: string, action: DemoIntent["action"]): ContentNotice | null {
  const match = loadIntents().find((intent) => intent.key === key && intent.action === action && intent.notice !== undefined);
  return match?.notice ? cloneNotice(match.notice) : null;
}

function replayedPage(key: string, action: DemoIntent["action"]): PublicPageRow | null {
  const match = loadIntents().find((intent) => intent.key === key && intent.action === action && intent.page !== undefined);
  return match?.page ? { ...match.page } : null;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function workflowKey(action: string, slug: string, version: number, detail = ""): string {
  return `content:${action}:${slug}:v${version}:${stableHash(detail)}`;
}

function contentFailure<T>(
  code: ErrorCode,
  message: string,
  currentVersion?: number,
  currentState?: unknown,
  retryable = false,
): ContentResult<T> {
  return {
    ok: false,
    code,
    message,
    ...(currentVersion === undefined ? {} : { currentVersion }),
    ...(currentState === undefined ? {} : { currentState }),
    ...(retryable ? { retryable: true } : {}),
  };
}

function roleFailure<T>(actor: ContentActor, requiredRole: "content_editor" | "content_publisher"): ContentResult<T> | null {
  if (actor.role === requiredRole) return null;
  const action = requiredRole === "content_editor" ? "edit or request review of" : "approve or publish";
  return contentFailure("forbidden", `The ${requiredRole.replace("_", " ")} role is required to ${action} content.`);
}

function staleFailure<T>(expectedVersion: number, currentVersion: number, state: unknown): ContentResult<T> {
  return contentFailure(
    "stale-version",
    `This content changed after version ${expectedVersion}. Reload and review version ${currentVersion} before trying again.`,
    currentVersion,
    state,
  );
}

function normalizeNotice(notice: ContentNotice): ContentNotice {
  const version = notice.version > 0 ? notice.version : 1;
  const reviewStatus =
    notice.reviewStatus ?? (notice.status === "published" || notice.status === "expired" ? "published" : "draft");
  return {
    ...notice,
    contentKind: "notice",
    version,
    itemVersion: notice.itemVersion ?? version,
    versionId: notice.versionId ?? `notice:${notice.slug}:v${version}`,
    reviewStatus,
    authorAccountId: notice.authorAccountId ?? SEEDED_CONTENT_AUTHOR_ID,
    reviewedByAccountId: notice.reviewedByAccountId ?? (reviewStatus === "published" ? "demo-content-seed-publisher" : null),
    scheduledForIso: notice.scheduledForIso ?? null,
    body: [...notice.body],
  };
}

function cloneNotice(notice: ContentNotice): ContentNotice {
  return { ...normalizeNotice(notice), body: [...notice.body] };
}

function withMeta(
  notice: Notice,
  status: NoticeStatus,
  audience: NoticeAudience,
  version: number,
  publishNote?: string,
): ContentNotice {
  const publishedVersion = Math.max(version, 1);
  return {
    ...notice,
    contentKind: "notice",
    versionId: `notice:${notice.slug}:v${publishedVersion}`,
    status,
    reviewStatus: status === "published" || status === "expired" ? "published" : "draft",
    audience,
    version: publishedVersion,
    itemVersion: publishedVersion,
    authorAccountId: status === "draft" ? DEMO_CONTENT_EDITOR_ACCOUNT_ID : SEEDED_CONTENT_AUTHOR_ID,
    reviewedByAccountId: status === "draft" ? null : "demo-content-seed-publisher",
    publishNote,
    reviewDue: noticeReviewDue[notice.slug] ?? "2026-09-01",
    scheduledForIso: null,
  };
}

/** Fresh-session seed: the existing fictional notices plus staff-only states. */
function seedStore(): ContentNotice[] {
  return [
    ...fixtureNotices.map((notice) => withMeta(notice, "published", "public", 1, "Initial publication")),
    ...staffDraftNotices.map((notice) => withMeta(notice, "draft", "public", 1)),
    ...staffExpiredNotices.map((notice) => withMeta(notice, "expired", "public", 1, "Initial publication")),
  ];
}

function loadStore(): ContentNotice[] {
  const stored = sessionGet<ContentNotice[]>(CONTENT_SESSION_KEY);
  if (stored !== null) return stored.map(cloneNotice);
  const seeded = seedStore();
  sessionSet(CONTENT_SESSION_KEY, seeded);
  return seeded.map(cloneNotice);
}

function saveStore(store: ContentNotice[]): void {
  sessionSet(CONTENT_SESSION_KEY, store.map(cloneNotice));
}

/** Deterministic slug for a new notice; collisions get a numeric suffix. */
function slugFor(store: ContentNotice[], title: string): string {
  const base =
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "notice";
  let slug = base;
  let suffix = 2;
  while (store.some((notice) => notice.slug === slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

/** Whether the notice is visible to the given audience scope (status first). */
function visibleTo(notice: ContentNotice, audience: "public" | "family", status: NoticeStatus): boolean {
  if (notice.status !== status) return false;
  if (audience === "public") return notice.audience === "public";
  /* Families see public notices and family-targeted notices. */
  return notice.audience === "public" || notice.audience === "family";
}

export type ContentTransitionInput = {
  actor?: ContentActor;
  expectedVersion?: number;
  idempotencyKey?: string;
};

export type ContentPublishInput = ContentTransitionInput & {
  /** Must match the note already saved into the reviewed immutable version. */
  note?: string;
  audience?: NoticeAudience;
  scheduledForIso?: string | null;
  expiresAtIso?: string | null;
};

export interface ContentService {
  /** Published notices for an audience scope: "public" site or "family" portal. */
  listForAudience(audience: "public" | "family", opts?: { status?: NoticeStatus }): Promise<ContentNotice[]>;
  /** One published notice in an audience scope, or null when not visible. */
  getNotice(slug: string, audience: "public" | "family"): Promise<ContentNotice | null>;
  /** Every notice for the staff workspaces, including workflow and archive rows. */
  listForStaff(): Promise<ContentNotice[]>;
  /** Save the editor-owned first immutable draft version. */
  createNotice(input: {
    title: string;
    category: NoticeCategory;
    body: string[];
    urgent?: boolean;
    audience?: NoticeAudience;
    publishNote?: string;
    actor?: ContentActor;
    idempotencyKey?: string;
    /** Legacy input retained for callers; scheduling happens only after approval. */
    scheduledForIso?: string | null;
  }): Promise<ContentNotice>;
  /** Editor maker step: append an in-review version. */
  requestReview(slug: string, input?: ContentTransitionInput): Promise<ContentResult<ContentNotice>>;
  /** Separate publisher checker step: append an approved version. */
  approveVersion(slug: string, input?: ContentTransitionInput): Promise<ContentResult<ContentNotice>>;
  /** Publish or schedule an approved version through the V2 backend command. */
  publishVersionV2(slug: string, input?: ContentPublishInput): Promise<ContentResult<ContentNotice>>;
  /** Compatibility name; it has the same approved-version precondition. */
  publishNotice(slug: string, input: ContentPublishInput & { note: string }): Promise<ContentResult<ContentNotice>>;
  /** Archive a published notice or cancel a schedule. */
  unpublishNotice(
    slug: string,
    input?: ContentTransitionInput & { reason?: string },
  ): Promise<ContentResult<ContentNotice>>;
  /** Public download register for the notices page. */
  listDownloads(): Promise<DownloadItem[]>;
  /** Public-page workflow rows from the same content source as notices. */
  listPublicPages(): Promise<PublicPageRow[]>;
  /** Advance exactly one canonical public-page workflow transition. */
  setPublicPageStatus(
    key: string,
    next: PublicPageReviewStatus,
    actor: ContentActor,
    input?: { expectedVersion?: number; idempotencyKey?: string; publishNote?: string; scheduledForIso?: string | null },
  ): Promise<ContentResult<PublicPageRow>>;
  /** Append a replacement draft version; reviewed versions are immutable. */
  editNotice(
    slug: string,
    input: {
      title?: string;
      category?: NoticeCategory;
      body?: string[];
      urgent?: boolean;
      audience?: NoticeAudience;
      publishNote?: string;
      actor?: ContentActor;
      expectedVersion?: number;
      idempotencyKey?: string;
    },
  ): Promise<ContentResult<ContentNotice>>;
  /** Create a new public-page draft (editor owned). */
  createPublicPage(input: {
    slug: string;
    title: string;
    body: string[];
    publishNote?: string;
    actor?: ContentActor;
    idempotencyKey?: string;
  }): Promise<ContentResult<PublicPageRow>>;
  /** Append a replacement public-page draft version; reviewed versions are immutable. */
  editPublicPage(
    key: string,
    input: {
      title?: string;
      body?: string[];
      publishNote?: string;
      actor?: ContentActor;
      expectedVersion?: number;
      idempotencyKey?: string;
    },
  ): Promise<ContentResult<PublicPageRow>>;
  /** Read the published body of a public page for rendering, or null. */
  getPublicPageBody(key: string): Promise<{ title: string; body: string[]; updatedAtIso: string | null } | null>;
  /** The vacancy for a slug, or null when unknown. */
  getVacancy(slug: string): Promise<Vacancy | null>;
  listVacancies(): Promise<Vacancy[]>;
}

export function createDemoContentService(): ContentService {
  const service: ContentService = {
    async listForAudience(audience, opts = {}) {
      const status = opts.status ?? "published";
      return loadStore().filter((notice) => visibleTo(notice, audience, status));
    },

    async getNotice(slug, audience) {
      const notice = loadStore().find(
        (candidate) => candidate.slug === slug && visibleTo(candidate, audience, "published"),
      );
      return notice ? cloneNotice(notice) : null;
    },

    async listForStaff() {
      return loadStore();
    },

    async createNotice(input) {
      const actor = input.actor ?? DEFAULT_DEMO_EDITOR;
      const denied = roleFailure<ContentNotice>(actor, "content_editor");
      if (denied !== null && !denied.ok) throw new Error(denied.message);
      if (input.title.trim() === "" || input.body.every((line) => line.trim() === "")) {
        throw new Error("A title and body are required to save a content draft.");
      }
      const store = loadStore();
      const slug = slugFor(store, input.title);
      const created: ContentNotice = {
        slug,
        contentKind: "notice",
        versionId: `notice:${slug}:v1`,
        category: input.category,
        title: input.title.trim(),
        excerpt: input.body[0]?.trim().slice(0, 140) ?? "",
        body: input.body.map((line) => line.trim()).filter(Boolean),
        dateIso: demoNowIso(),
        urgent: input.urgent ?? false,
        status: "draft",
        reviewStatus: "draft",
        audience: input.audience ?? "public",
        version: 1,
        itemVersion: 1,
        authorAccountId: actor.accountId,
        reviewedByAccountId: null,
        publishNote: input.publishNote?.trim() || undefined,
        reviewDue: "2026-09-01",
        /* Scheduling is a publisher transition, never a property of a new draft. */
        scheduledForIso: null,
      };
      saveStore([...store, created]);
      return cloneNotice(created);
    },

    async requestReview(slug, input = {}) {
      const actor = input.actor ?? DEFAULT_DEMO_EDITOR;
      const denied = roleFailure<ContentNotice>(actor, "content_editor");
      if (denied !== null) return denied;
      const store = loadStore();
      const current = store.find((notice) => notice.slug === slug);
      if (current === undefined) return contentFailure("not-found", "The notice was not found.");
      const expectedVersion = input.expectedVersion ?? current.version;
      const idempotencyKey =
        input.idempotencyKey ?? workflowKey("request-review", slug, expectedVersion, current.publishNote ?? "");
      const replay = replayedNotice(idempotencyKey, "request-review");
      if (replay !== null) return { ok: true, value: replay, replayed: true };
      if (expectedVersion !== current.version) {
        return staleFailure(expectedVersion, current.version, current.reviewStatus);
      }
      if (current.reviewStatus !== "draft" || current.status !== "draft") {
        return contentFailure(
          "conflict",
          "Only the current draft version can be sent for review.",
          current.version,
          current.reviewStatus,
        );
      }
      if (current.authorAccountId !== null && current.authorAccountId !== actor.accountId) {
        return contentFailure("forbidden", "Only the editor who saved this version may request its review.");
      }
      if (!current.publishNote?.trim()) {
        return contentFailure(
          "validation",
          "Add a review and publish note to the draft before requesting review.",
          current.version,
          current.reviewStatus,
        );
      }
      const nextVersion = current.version + 1;
      const next: ContentNotice = {
        ...current,
        versionId: `notice:${slug}:v${nextVersion}`,
        version: nextVersion,
        itemVersion: nextVersion,
        reviewStatus: "in_review",
      };
      saveStore(store.map((notice) => (notice.slug === slug ? next : notice)));
      saveIntent({ key: idempotencyKey, action: "request-review", notice: cloneNotice(next) });
      void auditService.record({
        actor: actor.displayName,
        action: "Notice edited",
        target: slug,
        outcome: "Success",
        reason: "Notice version sent for publisher review",
      });
      return { ok: true, value: cloneNotice(next) };
    },

    async approveVersion(slug, input = {}) {
      const actor = input.actor ?? DEFAULT_DEMO_PUBLISHER;
      const denied = roleFailure<ContentNotice>(actor, "content_publisher");
      if (denied !== null) return denied;
      const store = loadStore();
      const current = store.find((notice) => notice.slug === slug);
      if (current === undefined) return contentFailure("not-found", "The notice was not found.");
      const expectedVersion = input.expectedVersion ?? current.version;
      const idempotencyKey = input.idempotencyKey ?? workflowKey("approve", slug, expectedVersion);
      const replay = replayedNotice(idempotencyKey, "approve");
      if (replay !== null) return { ok: true, value: replay, replayed: true };
      if (expectedVersion !== current.version) {
        return staleFailure(expectedVersion, current.version, current.reviewStatus);
      }
      if (current.reviewStatus !== "in_review") {
        return contentFailure(
          "conflict",
          "The content version must be in review before it can be approved.",
          current.version,
          current.reviewStatus,
        );
      }
      if (current.authorAccountId === actor.accountId) {
        return contentFailure("forbidden", "A publisher cannot approve their own edited version.");
      }
      const nextVersion = current.version + 1;
      const next: ContentNotice = {
        ...current,
        versionId: `notice:${slug}:v${nextVersion}`,
        version: nextVersion,
        /* Mirrors the existing RPC: approval appends a version but does not
           advance content_items.version until publication. */
        itemVersion: current.itemVersion,
        reviewStatus: "approved",
        reviewedByAccountId: actor.accountId,
      };
      saveStore(store.map((notice) => (notice.slug === slug ? next : notice)));
      saveIntent({ key: idempotencyKey, action: "approve", notice: cloneNotice(next) });
      void auditService.record({
        actor: actor.displayName,
        action: "Notice edited",
        target: slug,
        outcome: "Success",
        reason: "Notice version approved for publication",
      });
      return { ok: true, value: cloneNotice(next) };
    },

    async publishVersionV2(slug, input = {}) {
      const actor = input.actor ?? DEFAULT_DEMO_PUBLISHER;
      const denied = roleFailure<ContentNotice>(actor, "content_publisher");
      if (denied !== null) return denied;
      const store = loadStore();
      const current = store.find((notice) => notice.slug === slug);
      if (current === undefined) return contentFailure("not-found", "The notice was not found.");
      const expectedVersion = input.expectedVersion ?? current.version;
      const scheduledForIso = input.scheduledForIso?.trim() || null;
      const idempotencyKey =
        input.idempotencyKey ??
        workflowKey("publish", slug, expectedVersion, `${scheduledForIso ?? "now"}|${current.publishNote ?? ""}`);
      const replay = replayedNotice(idempotencyKey, "publish");
      if (replay !== null) return { ok: true, value: replay, replayed: true };
      if (expectedVersion !== current.version) {
        return staleFailure(expectedVersion, current.version, current.reviewStatus);
      }
      if (current.reviewStatus !== "approved") {
        return contentFailure(
          "conflict",
          "The content version must be approved before it can be published or scheduled.",
          current.version,
          current.reviewStatus,
        );
      }
      if (current.authorAccountId === actor.accountId) {
        return contentFailure("forbidden", "A publisher cannot publish their own edited version.");
      }
      const persistedNote = current.publishNote?.trim() ?? "";
      if (persistedNote === "") {
        return contentFailure(
          "validation",
          "The approved version has no publish note. Return to a draft, add the note, and request review again.",
          current.version,
          current.reviewStatus,
        );
      }
      if (input.note !== undefined && input.note.trim() !== persistedNote) {
        return contentFailure(
          "conflict",
          "The publish note is part of the approved version and cannot be changed during publication.",
          current.version,
          current.reviewStatus,
        );
      }
      if (input.audience !== undefined && input.audience !== current.audience) {
        return contentFailure(
          "conflict",
          "The audience is part of the reviewed draft and cannot be changed during publication.",
          current.version,
          current.reviewStatus,
        );
      }
      const scheduleTime = scheduledForIso === null ? null : Date.parse(scheduledForIso);
      if (scheduledForIso !== null && scheduleTime !== null && (!Number.isFinite(scheduleTime) || scheduleTime <= Date.parse(demoNowIso()))) {
        return contentFailure("validation", "Choose a valid future date to schedule publication.");
      }
      const scheduled = scheduledForIso !== null;
      const nextVersion = current.version + 1;
      const next: ContentNotice = {
        ...current,
        versionId: `notice:${slug}:v${nextVersion}`,
        version: nextVersion,
        itemVersion: nextVersion,
        status: scheduled ? "scheduled" : "published",
        reviewStatus: scheduled ? "approved" : "published",
        dateIso: scheduled ? current.dateIso : demoNowIso(),
        scheduledForIso,
      };
      saveStore(store.map((notice) => (notice.slug === slug ? next : notice)));
      saveIntent({ key: idempotencyKey, action: "publish", notice: cloneNotice(next) });
      if (!scheduled) {
        enqueueOutboxEvent({
          eventId: `content.published:${next.slug}:v${next.version}`,
          kind: "content.published",
          targetRef: next.slug,
          actor: actor.displayName,
        });
      }
      void auditService.record({
        actor: actor.displayName,
        action: "Notice published",
        target: next.slug,
        outcome: "Success",
        reason: scheduled ? `${persistedNote} (scheduled ${scheduledForIso})` : persistedNote,
      });
      return { ok: true, value: cloneNotice(next) };
    },

    async publishNotice(slug, input) {
      return service.publishVersionV2(slug, input);
    },

    async unpublishNotice(slug, input = {}) {
      const actor = input.actor ?? DEFAULT_DEMO_PUBLISHER;
      const denied = roleFailure<ContentNotice>(actor, "content_publisher");
      if (denied !== null) return denied;
      const store = loadStore();
      const current = store.find((notice) => notice.slug === slug);
      if (current === undefined) return contentFailure("not-found", "The notice was not found.");
      const reason = input.reason?.trim() || "Notice archived from the content workspace";
      if (reason.length < 3) return contentFailure("validation", "An unpublish reason is required.");
      const expectedVersion = input.expectedVersion ?? current.itemVersion;
      const idempotencyKey = input.idempotencyKey ?? workflowKey("unpublish", slug, expectedVersion, reason);
      const replay = replayedNotice(idempotencyKey, "unpublish");
      if (replay !== null) return { ok: true, value: replay, replayed: true };
      if (expectedVersion !== current.itemVersion) {
        return staleFailure(expectedVersion, current.itemVersion, current.status);
      }
      if (current.status !== "published" && current.status !== "scheduled") {
        return contentFailure(
          "conflict",
          "Only a published or scheduled notice can be unpublished.",
          current.itemVersion,
          current.status,
        );
      }
      const next: ContentNotice = {
        ...current,
        status: "archived",
        itemVersion: current.itemVersion + 1,
        scheduledForIso: null,
      };
      saveStore(store.map((notice) => (notice.slug === slug ? next : notice)));
      saveIntent({ key: idempotencyKey, action: "unpublish", notice: cloneNotice(next) });
      void auditService.record({
        actor: actor.displayName,
        action: "Notice unpublished",
        target: slug,
        outcome: "Success",
        reason,
      });
      return { ok: true, value: cloneNotice(next) };
    },

    async listDownloads() {
      return DOWNLOADS.map((item) => ({ ...item }));
    },

    async listPublicPages() {
      return loadPublicPages();
    },

    async setPublicPageStatus(key, nextStatus, actor, input = {}) {
      const rows = loadPublicPages();
      const current = rows.find((row) => row.key === key);
      if (current === undefined) return contentFailure("not-found", "The page was not found.");
      const expectedVersion = input.expectedVersion ?? current.version;
      const action =
        nextStatus === "In review"
          ? "page-request-review"
          : nextStatus === "Approved"
            ? "page-approve"
            : "page-publish";
      const idempotencyKey =
        input.idempotencyKey ?? workflowKey(action, key, expectedVersion, input.scheduledForIso ?? input.publishNote ?? "");
      const replay = replayedPage(idempotencyKey, action);
      if (replay !== null) return { ok: true, value: replay, replayed: true };
      if (expectedVersion !== current.version) {
        return staleFailure(expectedVersion, current.version, current.reviewStatus);
      }

      let updated: PublicPageRow;
      if (nextStatus === "In review") {
        const denied = roleFailure<PublicPageRow>(actor, "content_editor");
        if (denied !== null) return denied;
        if (current.reviewStatus !== "draft") {
          return contentFailure("conflict", "Only a draft page version can be sent for review.");
        }
        if (current.authorAccountId !== null && current.authorAccountId !== actor.accountId) {
          return contentFailure("forbidden", "Only the editor who saved this page version may request its review.");
        }
        const version = current.version + 1;
        updated = {
          ...current,
          versionId: `page:${key}:v${version}`,
          version,
          itemVersion: version,
          reviewStatus: "in_review",
          currentStatus: "draft",
          status: "In review",
          publishNote: input.publishNote?.trim() || current.publishNote,
        };
      } else if (nextStatus === "Approved") {
        const denied = roleFailure<PublicPageRow>(actor, "content_publisher");
        if (denied !== null) return denied;
        if (current.reviewStatus !== "in_review") {
          return contentFailure("conflict", "The page version must be in review before approval.");
        }
        if (current.authorAccountId === actor.accountId) {
          return contentFailure("forbidden", "A publisher cannot approve their own edited page version.");
        }
        const version = current.version + 1;
        updated = {
          ...current,
          versionId: `page:${key}:v${version}`,
          version,
          reviewStatus: "approved",
          reviewedByAccountId: actor.accountId,
          status: "Approved",
        };
      } else if (nextStatus === "Published" || nextStatus === "Scheduled") {
        const denied = roleFailure<PublicPageRow>(actor, "content_publisher");
        if (denied !== null) return denied;
        if (current.reviewStatus !== "approved") {
          return contentFailure("conflict", "The page version must be approved before publication.");
        }
        if (current.authorAccountId === actor.accountId) {
          return contentFailure("forbidden", "A publisher cannot publish their own edited page version.");
        }
        const scheduledForIso = input.scheduledForIso?.trim() || null;
        const scheduleTime = scheduledForIso === null ? null : Date.parse(scheduledForIso);
        if (nextStatus === "Scheduled" && (scheduleTime === null || !Number.isFinite(scheduleTime) || scheduleTime <= Date.parse(demoNowIso()))) {
          return contentFailure("validation", "Choose a valid future date to schedule publication.");
        }
        const version = current.version + 1;
        const scheduled = nextStatus === "Scheduled";
        updated = {
          ...current,
          versionId: `page:${key}:v${version}`,
          version,
          itemVersion: version,
          reviewStatus: scheduled ? "approved" : "published",
          currentStatus: scheduled ? "scheduled" : "published",
          status: nextStatus,
          scheduledForIso: scheduledForIso,
          lastReviewed: scheduled ? current.lastReviewed : formatKolkata(demoNowIso(), { format: "day" }),
        };
      } else {
        return contentFailure(
          "conflict",
          "Public-page status is advanced through request review, approve, then publish or schedule.",
          current.version,
          current.reviewStatus,
        );
      }

      savePublicPages(rows.map((row) => (row.key === key ? updated : row)));
      saveIntent({ key: idempotencyKey, action, page: { ...updated } });
      void auditService.record({
        actor: actor.displayName,
        action: "Page status updated",
        target: `page:${key}`,
        outcome: "Success",
        reason: `Page workflow advanced to ${nextStatus}`,
      });
      return { ok: true, value: { ...updated } };
    },

    async editNotice(slug, input) {
      const actor = input.actor ?? DEFAULT_DEMO_EDITOR;
      const denied = roleFailure<ContentNotice>(actor, "content_editor");
      if (denied !== null) return denied;
      const store = loadStore();
      const current = store.find((notice) => notice.slug === slug);
      if (current === undefined) return contentFailure("not-found", "The notice was not found.");
      const expectedVersion = input.expectedVersion ?? current.itemVersion;
      if (expectedVersion !== current.itemVersion) {
        return staleFailure(expectedVersion, current.itemVersion, current.reviewStatus);
      }
      if (current.status === "published" || current.status === "scheduled") {
        return contentFailure(
          "conflict",
          "Published or scheduled notices cannot be edited directly. Unpublish first.",
          current.itemVersion,
          current.status,
        );
      }
      if (current.reviewStatus !== "draft" && current.status !== "archived" && current.status !== "expired") {
        return contentFailure(
          "conflict",
          "A version in review or already approved is immutable. Start a new draft before editing.",
          current.version,
          current.reviewStatus,
        );
      }
      const body = input.body ? input.body.map((line) => line.trim()).filter(Boolean) : [...current.body];
      if ((input.title !== undefined && input.title.trim() === "") || body.length === 0) {
        return contentFailure("validation", "A title and body are required to save a content draft.");
      }
      const version = current.itemVersion + 1;
      const updated: ContentNotice = {
        ...current,
        versionId: `notice:${slug}:v${version}`,
        version,
        itemVersion: version,
        status: "draft",
        reviewStatus: "draft",
        title: input.title?.trim() || current.title,
        category: input.category ?? current.category,
        body,
        excerpt: body[0]?.slice(0, 140) ?? "",
        urgent: input.urgent ?? current.urgent,
        audience: input.audience ?? current.audience,
        publishNote: input.publishNote === undefined ? current.publishNote : input.publishNote.trim() || undefined,
        authorAccountId: actor.accountId,
        reviewedByAccountId: null,
        scheduledForIso: null,
      };
      saveStore(store.map((notice) => (notice.slug === slug ? updated : notice)));
      void auditService.record({
        actor: actor.displayName,
        action: "Notice edited",
        target: slug,
        outcome: "Success",
        reason: `Draft version ${version} saved`,
      });
      return { ok: true, value: cloneNotice(updated) };
    },

    async createPublicPage(input) {
      const actor = input.actor ?? DEFAULT_DEMO_EDITOR;
      const denied = roleFailure<PublicPageRow>(actor, "content_editor");
      if (denied !== null) return denied;
      const body = input.body.map((line) => line.trim()).filter(Boolean);
      if (input.title.trim() === "" || body.length === 0) {
        return contentFailure("validation", "A title and body are required to save a public page draft.");
      }
      const rows = loadPublicPages();
      if (rows.some((row) => row.key === input.slug)) {
        return contentFailure("conflict", `A page already exists at /${input.slug}.`);
      }
      const row: PublicPageRow = {
        key: input.slug,
        contentItemId: `page:${input.slug}`,
        reference: `PAGE-${input.slug.toUpperCase()}`,
        versionId: `page:${input.slug}:v1`,
        version: 1,
        itemVersion: 1,
        reviewStatus: "draft",
        currentStatus: "draft",
        authorAccountId: actor.accountId,
        reviewedByAccountId: null,
        publishNote: input.publishNote?.trim() || undefined,
        scheduledForIso: null,
        label: input.title.trim(),
        href: `/${input.slug}`,
        status: "Draft",
        lastReviewed: "—",
        owner: actor.displayName,
      };
      const extended = loadPublicPageBodies();
      extended.set(input.slug, { title: input.title.trim(), body, updatedAtIso: demoNowIso() });
      savePublicPageBodies(extended);
      savePublicPages([...rows, row]);
      return { ok: true, value: row };
    },

    async editPublicPage(key, input) {
      const actor = input.actor ?? DEFAULT_DEMO_EDITOR;
      const denied = roleFailure<PublicPageRow>(actor, "content_editor");
      if (denied !== null) return denied;
      const rows = loadPublicPages();
      const current = rows.find((row) => row.key === key);
      if (current === undefined) return contentFailure("not-found", "The page was not found.");
      const expectedVersion = input.expectedVersion ?? current.itemVersion;
      if (expectedVersion !== current.itemVersion) {
        return staleFailure(expectedVersion, current.itemVersion, current.reviewStatus);
      }
      if (current.reviewStatus !== "draft" && current.currentStatus !== "archived") {
        return contentFailure(
          "conflict",
          "A version in review or already approved is immutable. Start a new draft before editing.",
          current.version,
          current.reviewStatus,
        );
      }
      const bodies = loadPublicPageBodies();
      const existingBody = bodies.get(key)?.body ?? [];
      const body = input.body ? input.body.map((line) => line.trim()).filter(Boolean) : [...existingBody];
      const title = input.title?.trim() || current.label;
      if (title === "" || body.length === 0) {
        return contentFailure("validation", "A title and body are required to save a public page draft.");
      }
      const version = current.itemVersion + 1;
      const updated: PublicPageRow = {
        ...current,
        versionId: `page:${key}:v${version}`,
        version,
        itemVersion: version,
        reviewStatus: "draft",
        currentStatus: "draft",
        label: title,
        publishNote: input.publishNote === undefined ? current.publishNote : input.publishNote.trim() || undefined,
        reviewedByAccountId: null,
        authorAccountId: actor.accountId,
        status: "Draft",
        lastReviewed: "—",
        owner: actor.displayName,
      };
      bodies.set(key, { title, body, updatedAtIso: demoNowIso() });
      savePublicPageBodies(bodies);
      savePublicPages(rows.map((row) => (row.key === key ? updated : row)));
      return { ok: true, value: updated };
    },

    async getPublicPageBody(key) {
      const bodies = loadPublicPageBodies();
      const entry = bodies.get(key);
      return entry ? { ...entry } : null;
    },

    getVacancy: (slug) => Promise.resolve(vacancies.find((item) => item.slug === slug) ?? null),
    listVacancies: () => Promise.resolve(vacancies.map((item) => ({ ...item }))),
  };
  return service;
}

/** Default singleton consumed by pages. */
export const contentService: ContentService = createDemoContentService();

/* Supabase facade: protected/public reads use only the authorized adapter
 * projection. Demo session rows are never consulted in this branch. */
type ServerContentVersionRow = {
  id: string;
  version: number;
  title: string;
  body: unknown;
  review_status: string;
  published_at: string | null;
  created_at: string;
  author_account_id?: string | null;
  reviewed_by_account_id?: string | null;
  approved_at?: string | null;
};

export type ServerContentRow = {
  id: string;
  reference: string;
  kind: string;
  slug: string;
  current_status: string;
  version?: number;
  current_version_id?: string | null;
  updated_at?: string;
  content_versions?: ServerContentVersionRow[];
  notices?: Array<{
    category: string;
    urgent: boolean;
    status: string;
    published_at: string | null;
    expires_at: string | null;
    review_due?: string | null;
    scheduled_at?: string | null;
    notice_audiences?: Array<{ audience: string }>;
  }>;
};

type VersionMetadata = {
  category?: unknown;
  urgent?: unknown;
  audience?: unknown;
  publishNote?: unknown;
  href?: unknown;
};

type ParsedVersionBody = {
  body: string[];
  metadata: VersionMetadata;
};

type ServerContentTransition = {
  id?: string;
  reference?: string;
  versionId?: string;
  version?: number;
  status?: string;
  replayed?: boolean;
};

function parseVersionBody(value: unknown): ParsedVersionBody {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const object = value as { blocks?: unknown; metadata?: unknown };
    const body = Array.isArray(object.blocks)
      ? object.blocks
          .map((block) =>
            typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string"
              ? (block as { text: string }).text
              : "",
          )
          .filter(Boolean)
      : [];
    const metadata =
      typeof object.metadata === "object" && object.metadata !== null && !Array.isArray(object.metadata)
        ? (object.metadata as VersionMetadata)
        : {};
    return { body, metadata };
  }
  if (Array.isArray(value)) {
    return { body: value.filter((item): item is string => typeof item === "string"), metadata: {} };
  }
  return { body: typeof value === "string" ? [value] : [], metadata: {} };
}

function noticeStatus(value: string): NoticeStatus {
  return value === "scheduled" || value === "published" || value === "expired" || value === "archived"
    ? value
    : "draft";
}

function reviewStatus(value: string | undefined, status: NoticeStatus): ContentReviewStatus {
  if (value === "in_review" || value === "approved" || value === "published") return value;
  return status === "published" || status === "expired" ? "published" : "draft";
}

function metadataCategory(metadata: VersionMetadata, fallback: string | undefined): NoticeCategory {
  const candidate = typeof metadata.category === "string" ? metadata.category : fallback;
  return noticeCategories.includes(candidate as NoticeCategory) ? (candidate as NoticeCategory) : "General";
}

function metadataAudience(
  metadata: VersionMetadata,
  notice: NonNullable<ServerContentRow["notices"]>[number] | undefined,
): NoticeAudience {
  if (metadata.audience === "family" || metadata.audience === "public") return metadata.audience;
  return notice?.notice_audiences?.some((candidate) => candidate.audience !== "public") ? "family" : "public";
}

function serverVersionBody(input: {
  body: string[];
  category: NoticeCategory;
  urgent: boolean;
  audience: NoticeAudience;
  publishNote?: string;
}): Record<string, unknown> {
  return {
    blocks: input.body.map((text) => ({ type: "paragraph", text })),
    metadata: {
      category: input.category,
      urgent: input.urgent,
      audience: input.audience,
      ...(input.publishNote?.trim() ? { publishNote: input.publishNote.trim() } : {}),
    },
  };
}

function latestServerVersion(row: ServerContentRow): ServerContentVersionRow | undefined {
  return [...(row.content_versions ?? [])].sort((left, right) => right.version - left.version)[0];
}

function serverVersionAt(row: ServerContentRow, version: number): ServerContentVersionRow | undefined {
  return row.content_versions?.find((candidate) => candidate.version === version);
}

function sameImmutableContent(left: ServerContentVersionRow, right: ServerContentVersionRow): boolean {
  return (
    left.title === right.title &&
    left.author_account_id === right.author_account_id &&
    JSON.stringify(left.body) === JSON.stringify(right.body)
  );
}

type ServerTransitionTarget = {
  reviewStatus: ContentReviewStatus;
  itemStatus?: NoticeStatus;
};

type ResolvedServerTransition = {
  source: ServerContentVersionRow;
  replayCandidate: boolean;
};

/**
 * Resolve the immutable source version for a write. Ordinarily it must be the
 * latest version. The one safe exception is an immediate retry whose exact
 * next immutable version is already visible with the requested outcome. That
 * lets the same deterministic idempotency key reach the server again without
 * allowing an older draft to overwrite unrelated newer work.
 */
function resolveServerTransition(
  row: ServerContentRow,
  current: ContentNotice | PublicPageRow,
  expectedVersion: number,
  target: ServerTransitionTarget,
): ContentResult<ResolvedServerTransition> {
  const source = serverVersionAt(row, expectedVersion);
  if (source === undefined) {
    return staleFailure(expectedVersion, current.version, current.reviewStatus);
  }
  if (expectedVersion === current.version) {
    return { ok: true, value: { source, replayCandidate: false } };
  }

  const latest = latestServerVersion(row);
  const isImmediateMatchingResult =
    latest !== undefined &&
    current.version === expectedVersion + 1 &&
    latest.version === current.version &&
    reviewStatus(latest.review_status, noticeStatus(row.current_status)) === target.reviewStatus &&
    (target.itemStatus === undefined || noticeStatus(row.current_status) === target.itemStatus) &&
    sameImmutableContent(source, latest);
  if (isImmediateMatchingResult) {
    return { ok: true, value: { source, replayCandidate: true } };
  }
  return staleFailure(expectedVersion, current.version, current.reviewStatus);
}

function normalizeOptionalIso(value: string | null | undefined, label: string): ContentResult<string | null> {
  const trimmed = value?.trim() || null;
  if (trimmed === null) return { ok: true, value: null };
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return contentFailure("validation", `Choose a valid ${label}.`);
  return { ok: true, value: new Date(timestamp).toISOString() };
}

export function mapServerContentRow(row: ServerContentRow): ContentNotice {
  const versionRow = latestServerVersion(row);
  const parsed = parseVersionBody(versionRow?.body);
  const body = parsed.body.length > 0 ? parsed.body : ["Published school notice."];
  const notice = row.notices?.[0];
  const status = noticeStatus(row.current_status);
  const immutableVersion = versionRow?.version ?? row.version ?? 1;
  return {
    slug: row.slug,
    contentItemId: row.id,
    reference: row.reference,
    contentKind: "notice",
    versionId: versionRow?.id,
    category: metadataCategory(parsed.metadata, notice?.category),
    title: versionRow?.title ?? row.slug,
    excerpt: body[0]?.slice(0, 140) ?? "",
    body,
    dateIso: notice?.published_at ?? versionRow?.published_at ?? versionRow?.created_at ?? row.updated_at ?? "",
    urgent: typeof parsed.metadata.urgent === "boolean" ? parsed.metadata.urgent : (notice?.urgent ?? false),
    status,
    reviewStatus: reviewStatus(versionRow?.review_status, status),
    audience: metadataAudience(parsed.metadata, notice),
    version: immutableVersion,
    itemVersion: row.version ?? immutableVersion,
    authorAccountId: versionRow?.author_account_id ?? null,
    reviewedByAccountId: versionRow?.reviewed_by_account_id ?? null,
    publishNote: typeof parsed.metadata.publishNote === "string" ? parsed.metadata.publishNote : undefined,
    reviewDue: notice?.review_due ?? "—",
    scheduledForIso: notice?.scheduled_at ?? null,
  };
}

function publicPageStatus(row: ServerContentRow, status: NoticeStatus, review: ContentReviewStatus): PublicPageReviewStatus {
  if (status === "published") return "Published";
  if (status === "scheduled") return "Scheduled";
  if (status === "archived" || status === "expired") return "Archived";
  if (review === "approved") return "Approved";
  if (review === "in_review") return "In review";
  return "Draft";
}

function safeKolkataDay(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return formatKolkata(value, { format: "day" });
  } catch {
    return "—";
  }
}

export function mapServerPublicPageRow(row: ServerContentRow): PublicPageRow {
  const versionRow = latestServerVersion(row);
  const parsed = parseVersionBody(versionRow?.body);
  const status = noticeStatus(row.current_status);
  const review = reviewStatus(versionRow?.review_status, status);
  const immutableVersion = versionRow?.version ?? row.version ?? 1;
  const reviewedAt = versionRow?.published_at ?? versionRow?.approved_at ?? null;
  return {
    key: row.slug,
    contentItemId: row.id,
    reference: row.reference,
    versionId: versionRow?.id,
    version: immutableVersion,
    itemVersion: row.version ?? immutableVersion,
    reviewStatus: review,
    currentStatus: status,
    authorAccountId: versionRow?.author_account_id ?? null,
    reviewedByAccountId: versionRow?.reviewed_by_account_id ?? null,
    publishNote: typeof parsed.metadata.publishNote === "string" ? parsed.metadata.publishNote : undefined,
    scheduledForIso: null,
    label: versionRow?.title ?? row.slug,
    href: typeof parsed.metadata.href === "string" ? parsed.metadata.href : `/${row.slug}`,
    status: publicPageStatus(row, status, review),
    lastReviewed: safeKolkataDay(reviewedAt),
    owner: versionRow?.author_account_id ? "Content editor" : "Content team",
  };
}

function normalizeAdapterFailureCode(code: ErrorCode, message: string): ErrorCode {
  if (/version mismatch|changed after version/i.test(message)) return "stale-version";
  if (/cannot approve their own|cannot publish their own|role and aal2 required/i.test(message)) return "forbidden";
  if (/not approved|not in review|editable state/i.test(message)) return "conflict";
  return code;
}

function adapterFailure<T>(
  response: Extract<ServiceResult<unknown>, { ok: false }>,
  fallbackMessage: string,
): ContentResult<T> {
  const error = response.errors[0];
  const message = error?.message ?? fallbackMessage;
  return contentFailure(
    normalizeAdapterFailureCode(error?.code ?? "unavailable", message),
    message,
    response.currentVersion,
    response.currentState,
    response.retryable ?? error?.retryable ?? false,
  );
}

async function loadServerItemForWrite(
  slug: string,
  kind: "notice" | "page",
): Promise<ContentResult<{ row: ServerContentRow; notice?: ContentNotice; page?: PublicPageRow }>> {
  const response = await adapterCall<ServerContentRow[]>("content.list", { scope: "staff" });
  if (!response.ok) return adapterFailure(response, "Content is unavailable.");
  const row = response.value.find((candidate) => candidate.kind === kind && candidate.slug === slug);
  if (!row) return contentFailure("not-found", `The ${kind} was not found.`);
  return {
    ok: true,
    value: {
      row,
      ...(kind === "notice" ? { notice: mapServerContentRow(row) } : { page: mapServerPublicPageRow(row) }),
    },
  };
}

async function refreshServerNotice(slug: string, fallback: ContentNotice, minimumVersion: number): Promise<ContentNotice> {
  const response = await adapterCall<ServerContentRow[]>("content.list", { scope: "staff" });
  if (!response.ok) return fallback;
  const row = response.value.find((candidate) => candidate.kind === "notice" && candidate.slug === slug);
  if (!row) return fallback;
  const refreshed = mapServerContentRow(row);
  return refreshed.version >= minimumVersion ? refreshed : fallback;
}

async function refreshServerPage(key: string, fallback: PublicPageRow, minimumVersion: number): Promise<PublicPageRow> {
  const response = await adapterCall<ServerContentRow[]>("content.list", { scope: "staff" });
  if (!response.ok) return fallback;
  const row = response.value.find((candidate) => candidate.kind === "page" && candidate.slug === key);
  if (!row) return fallback;
  const refreshed = mapServerPublicPageRow(row);
  return refreshed.version >= minimumVersion ? refreshed : fallback;
}

function transitionVersion(value: ServerContentTransition, fallback: number): number {
  return typeof value.version === "number" ? value.version : fallback;
}

function transitionVersionId(value: ServerContentTransition, fallback: string | undefined): string | undefined {
  return value.versionId ?? (typeof value.id === "string" ? value.id : fallback);
}

/** The registered adapter name is `content.publishVersion`; it dispatches the
 * existing `contentPublishVersionV2` domain operation. No registry alias is
 * invented in this facade. */
const PUBLISH_VERSION_V2_OPERATION = "content.publishVersion";

const originalContent = createDemoContentService();
const originalCreatePublicPage = originalContent.createPublicPage.bind(originalContent);
const originalEditPublicPage = originalContent.editPublicPage.bind(originalContent);
const originalGetPublicPageBody = originalContent.getPublicPageBody.bind(originalContent);
contentService.listForAudience = async (audience, opts = {}) => {
  if (clientAdapterMode() !== "supabase") return originalContent.listForAudience(audience, opts);
  const response = await adapterCall<ServerContentRow[]>("content.list", {
    scope: audience === "family" ? "family" : "public",
  });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Content is unavailable.");
  const status = opts.status ?? "published";
  return response.value
    .filter((row) => row.kind === "notice")
    .map(mapServerContentRow)
    .filter((notice) => visibleTo(notice, audience, status));
};
contentService.getNotice = async (slug, audience) => {
  if (clientAdapterMode() !== "supabase") return originalContent.getNotice(slug, audience);
  const rows = await contentService.listForAudience(audience);
  return rows.find((row) => row.slug === slug) ?? null;
};
contentService.listForStaff = async () => {
  if (clientAdapterMode() !== "supabase") return originalContent.listForStaff();
  const response = await adapterCall<ServerContentRow[]>("content.list", { scope: "staff" });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Content is unavailable.");
  return response.value.filter((row) => row.kind === "notice").map(mapServerContentRow);
};
contentService.createNotice = async (input) => {
  if (clientAdapterMode() !== "supabase") return originalContent.createNotice(input);
  const title = input.title.trim();
  const body = input.body.map((line) => line.trim()).filter(Boolean);
  if (!title || body.length === 0) throw new Error("A title and body are required to save a content draft.");
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "notice";
  const audience = input.audience ?? "public";
  const publishNote = input.publishNote?.trim() || undefined;
  const idempotencyKey =
    input.idempotencyKey ??
    workflowKey("save-draft", slug, 0, `${title}|${body.join("\n")}|${publishNote ?? ""}`);
  const response = await adapterCall<ServerContentTransition>("content.saveDraft", {
    kind: "notice",
    slug,
    title,
    body: serverVersionBody({
      body,
      category: input.category,
      urgent: input.urgent ?? false,
      audience,
      publishNote,
    }),
    idempotencyKey,
  });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Unable to create content draft.");
  const version = transitionVersion(response.value, 1);
  const fallback: ContentNotice = {
    slug,
    contentItemId: response.value.id,
    reference: response.value.reference,
    contentKind: "notice",
    versionId: response.value.versionId,
    category: input.category,
    title,
    excerpt: body[0]?.slice(0, 140) ?? "",
    body,
    dateIso: "",
    urgent: input.urgent ?? false,
    status: "draft",
    reviewStatus: "draft",
    audience,
    version,
    itemVersion: version,
    authorAccountId: null,
    reviewedByAccountId: null,
    publishNote,
    reviewDue: "—",
    scheduledForIso: null,
  };
  return refreshServerNotice(slug, fallback, version);
};
contentService.requestReview = async (slug, input = {}) => {
  if (clientAdapterMode() !== "supabase") return originalContent.requestReview(slug, input);
  const loaded = await loadServerItemForWrite(slug, "notice");
  if (!loaded.ok) return loaded;
  const current = loaded.value.notice;
  if (!current?.versionId) {
    return contentFailure("conflict", "The current notice version is not available for review.");
  }
  const expectedVersion = input.expectedVersion ?? current.version;
  const resolved = resolveServerTransition(loaded.value.row, current, expectedVersion, {
    reviewStatus: "in_review",
    itemStatus: "draft",
  });
  if (!resolved.ok) return resolved;
  const source = resolved.value.source;
  if (source.review_status !== "draft" || (!resolved.value.replayCandidate && current.status !== "draft")) {
    return contentFailure(
      "conflict",
      "Only the current draft version can be sent for review.",
      current.version,
      current.reviewStatus,
    );
  }
  const sourceBody = parseVersionBody(source.body);
  const publishNote =
    typeof sourceBody.metadata.publishNote === "string" ? sourceBody.metadata.publishNote.trim() : "";
  if (!publishNote) {
    return contentFailure(
      "validation",
      "Add a review and publish note to the draft before requesting review.",
      current.version,
      current.reviewStatus,
    );
  }
  const idempotencyKey = input.idempotencyKey ?? workflowKey("request-review", slug, expectedVersion, publishNote);
  const response = await adapterCall<ServerContentTransition>("content.requestReview", {
    versionId: source.id,
    expectedVersion,
    idempotencyKey,
  });
  if (!response.ok) return adapterFailure(response, "Unable to request content review.");
  const version = transitionVersion(response.value, expectedVersion + 1);
  const transitioned: ContentNotice = {
    ...current,
    versionId: transitionVersionId(response.value, source.id),
    version,
    itemVersion: version,
    reviewStatus: "in_review",
  };
  const fallback = current.version >= version ? current : transitioned;
  return {
    ok: true,
    value: await refreshServerNotice(slug, fallback, Math.max(current.version, version)),
    ...(response.value.replayed || resolved.value.replayCandidate ? { replayed: true } : {}),
  };
};
contentService.approveVersion = async (slug, input = {}) => {
  if (clientAdapterMode() !== "supabase") return originalContent.approveVersion(slug, input);
  const loaded = await loadServerItemForWrite(slug, "notice");
  if (!loaded.ok) return loaded;
  const current = loaded.value.notice;
  if (!current?.versionId) return contentFailure("conflict", "The current notice version is not available for approval.");
  const expectedVersion = input.expectedVersion ?? current.version;
  const resolved = resolveServerTransition(loaded.value.row, current, expectedVersion, {
    reviewStatus: "approved",
    itemStatus: "draft",
  });
  if (!resolved.ok) return resolved;
  const source = resolved.value.source;
  if (source.review_status !== "in_review") {
    return contentFailure(
      "conflict",
      "The content version must be in review before it can be approved.",
      current.version,
      current.reviewStatus,
    );
  }
  const idempotencyKey = input.idempotencyKey ?? workflowKey("approve", slug, expectedVersion);
  const response = await adapterCall<ServerContentTransition>("content.approveVersion", {
    versionId: source.id,
    expectedVersion,
    idempotencyKey,
  });
  if (!response.ok) return adapterFailure(response, "Unable to approve the content version.");
  const version = transitionVersion(response.value, expectedVersion + 1);
  const transitioned: ContentNotice = {
    ...current,
    versionId: transitionVersionId(response.value, source.id),
    version,
    reviewStatus: "approved",
  };
  const fallback = current.version >= version ? current : transitioned;
  return {
    ok: true,
    value: await refreshServerNotice(slug, fallback, Math.max(current.version, version)),
    ...(response.value.replayed || resolved.value.replayCandidate ? { replayed: true } : {}),
  };
};
contentService.publishVersionV2 = async (slug, input = {}) => {
  if (clientAdapterMode() !== "supabase") return originalContent.publishVersionV2(slug, input);
  const loaded = await loadServerItemForWrite(slug, "notice");
  if (!loaded.ok) return loaded;
  const current = loaded.value.notice;
  if (!current?.versionId) {
    return contentFailure("conflict", "The current notice version is not available for publication.");
  }
  const scheduleResult = normalizeOptionalIso(input.scheduledForIso, "future publication date");
  if (!scheduleResult.ok) return scheduleResult;
  const expiryResult = normalizeOptionalIso(input.expiresAtIso, "expiry date");
  if (!expiryResult.ok) return expiryResult;
  const scheduledAt = scheduleResult.value;
  if (scheduledAt !== null && Date.parse(scheduledAt) <= Date.now()) {
    return contentFailure("validation", "Choose a valid future date to schedule publication.");
  }
  const scheduled = scheduledAt !== null;
  const expectedVersion = input.expectedVersion ?? current.version;
  const resolved = resolveServerTransition(loaded.value.row, current, expectedVersion, {
    reviewStatus: scheduled ? "approved" : "published",
    itemStatus: scheduled ? "scheduled" : "published",
  });
  if (!resolved.ok) return resolved;
  const source = resolved.value.source;
  if (source.review_status !== "approved") {
    return contentFailure(
      "conflict",
      "The content version must be approved before it can be published or scheduled.",
      current.version,
      current.reviewStatus,
    );
  }
  const sourceBody = parseVersionBody(source.body);
  const persistedNote =
    typeof sourceBody.metadata.publishNote === "string" ? sourceBody.metadata.publishNote.trim() : "";
  const approvedAudience = metadataAudience(sourceBody.metadata, loaded.value.row.notices?.[0]);
  if (!persistedNote) {
    return contentFailure(
      "validation",
      "The approved version has no publish note. Return to a draft, add the note, and request review again.",
      current.version,
      current.reviewStatus,
    );
  }
  if (input.note !== undefined && input.note.trim() !== persistedNote) {
    return contentFailure(
      "conflict",
      "The publish note is part of the approved version and cannot be changed during publication.",
      current.version,
      current.reviewStatus,
    );
  }
  if (input.audience !== undefined && input.audience !== approvedAudience) {
    return contentFailure(
      "conflict",
      "The audience is part of the reviewed draft and cannot be changed during publication.",
      current.version,
      current.reviewStatus,
    );
  }
  const idempotencyKey =
    input.idempotencyKey ?? workflowKey("publish", slug, expectedVersion, `${scheduledAt ?? "now"}|${persistedNote}`);
  const response = await adapterCall<ServerContentTransition>(PUBLISH_VERSION_V2_OPERATION, {
    versionId: source.id,
    expectedVersion,
    scheduledAt,
    expiresAt: expiryResult.value,
    idempotencyKey,
  });
  if (!response.ok) return adapterFailure(response, "Unable to publish content.");
  const version = transitionVersion(response.value, expectedVersion + 1);
  const isScheduled = response.value.status === "scheduled" || scheduled;
  const transitioned: ContentNotice = {
    ...current,
    contentItemId: response.value.id ?? current.contentItemId,
    reference: response.value.reference ?? current.reference,
    versionId: transitionVersionId(response.value, source.id),
    version,
    itemVersion: version,
    status: isScheduled ? "scheduled" : "published",
    reviewStatus: isScheduled ? "approved" : "published",
    audience: approvedAudience,
    publishNote: persistedNote,
    scheduledForIso: isScheduled ? scheduledAt : null,
  };
  const fallback = current.version >= version ? current : transitioned;
  return {
    ok: true,
    value: await refreshServerNotice(slug, fallback, Math.max(current.version, version)),
    ...(response.value.replayed || resolved.value.replayCandidate ? { replayed: true } : {}),
  };
};
contentService.publishNotice = async (slug, input) => contentService.publishVersionV2(slug, input);
contentService.unpublishNotice = async (slug, input = {}) => {
  if (clientAdapterMode() !== "supabase") return originalContent.unpublishNotice(slug, input);
  const loaded = await loadServerItemForWrite(slug, "notice");
  if (!loaded.ok) return loaded;
  const current = loaded.value.notice;
  if (!current?.contentItemId) return contentFailure("not-found", "The notice was not found.");
  const reason = input.reason?.trim() || "Archived through the content workspace.";
  if (reason.length < 3) return contentFailure("validation", "An unpublish reason is required.");
  const expectedVersion = input.expectedVersion ?? current.itemVersion;
  /* The unpublish command has no server idempotency-key input. Treat only the
     exact immediately-archived revision as a safe semantic retry. */
  if (current.status === "archived" && expectedVersion + 1 === current.itemVersion) {
    return { ok: true, value: current, replayed: true };
  }
  if (expectedVersion !== current.itemVersion) {
    return staleFailure(expectedVersion, current.itemVersion, current.status);
  }
  if (current.status !== "published" && current.status !== "scheduled") {
    return contentFailure(
      "conflict",
      "Only a published or scheduled notice can be unpublished.",
      current.itemVersion,
      current.status,
    );
  }
  const response = await adapterCall<ServerContentTransition>("content.unpublish", {
    contentItemId: current.contentItemId,
    reason,
    expectedVersion,
  });
  if (!response.ok) return adapterFailure(response, "Unable to unpublish content.");
  const itemVersion = transitionVersion(response.value, current.itemVersion + 1);
  const fallback: ContentNotice = {
    ...current,
    status: "archived",
    itemVersion,
    scheduledForIso: null,
  };
  return { ok: true, value: await refreshServerNotice(slug, fallback, current.version) };
};
contentService.listDownloads = async () => {
  if (clientAdapterMode() !== "supabase") return originalContent.listDownloads();
  /* Public download metadata requires a published content-document projection
   * that is not yet wired. Return an honest empty list so the public notices
   * page does not fail when downloads are absent. */
  return [];
};
contentService.listPublicPages = async () => {
  if (clientAdapterMode() !== "supabase") return originalContent.listPublicPages();
  const response = await adapterCall<ServerContentRow[]>("content.list", { scope: "staff" });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Public page content is unavailable.");
  return response.value.filter((row) => row.kind === "page").map(mapServerPublicPageRow);
};
contentService.setPublicPageStatus = async (key, next, actor, input = {}) => {
  if (clientAdapterMode() !== "supabase") return originalContent.setPublicPageStatus(key, next, actor, input);
  const loaded = await loadServerItemForWrite(key, "page");
  if (!loaded.ok) return loaded;
  const current = loaded.value.page;
  if (!current?.versionId) return contentFailure("conflict", "The current page version is not available.");
  const expectedVersion = input.expectedVersion ?? current.version;
  let operation: string;
  let payload: Record<string, unknown>;
  let fallbackReview: ContentReviewStatus;
  let fallbackStatus: NoticeStatus;
  let source: ServerContentVersionRow;
  let replayCandidate = false;
  let scheduledAt: string | null = null;

  if (next === "In review") {
    const resolved = resolveServerTransition(loaded.value.row, current, expectedVersion, {
      reviewStatus: "in_review",
      itemStatus: "draft",
    });
    if (!resolved.ok) return resolved;
    source = resolved.value.source;
    replayCandidate = resolved.value.replayCandidate;
    if (source.review_status !== "draft") {
      return contentFailure("conflict", "Only a draft page version can be sent for review.");
    }
    operation = "content.requestReview";
    payload = {
      versionId: source.id,
      expectedVersion,
      idempotencyKey: input.idempotencyKey ?? workflowKey("page-request-review", key, expectedVersion),
    };
    fallbackReview = "in_review";
    fallbackStatus = "draft";
  } else if (next === "Approved") {
    const resolved = resolveServerTransition(loaded.value.row, current, expectedVersion, {
      reviewStatus: "approved",
      itemStatus: "draft",
    });
    if (!resolved.ok) return resolved;
    source = resolved.value.source;
    replayCandidate = resolved.value.replayCandidate;
    if (source.review_status !== "in_review") {
      return contentFailure("conflict", "The page version must be in review before approval.");
    }
    operation = "content.approveVersion";
    payload = {
      versionId: source.id,
      expectedVersion,
      idempotencyKey: input.idempotencyKey ?? workflowKey("page-approve", key, expectedVersion),
    };
    fallbackReview = "approved";
    fallbackStatus = "draft";
  } else if (next === "Published" || next === "Scheduled") {
    if (next === "Scheduled") {
      const scheduleResult = normalizeOptionalIso(input.scheduledForIso, "future publication date");
      if (!scheduleResult.ok) return scheduleResult;
      scheduledAt = scheduleResult.value;
      if (scheduledAt === null || Date.parse(scheduledAt) <= Date.now()) {
        return contentFailure("validation", "Choose a valid future date to schedule publication.");
      }
    }
    const resolved = resolveServerTransition(loaded.value.row, current, expectedVersion, {
      reviewStatus: next === "Scheduled" ? "approved" : "published",
      itemStatus: next === "Scheduled" ? "scheduled" : "published",
    });
    if (!resolved.ok) return resolved;
    source = resolved.value.source;
    replayCandidate = resolved.value.replayCandidate;
    if (source.review_status !== "approved") {
      return contentFailure("conflict", "The page version must be approved before publication.");
    }
    operation = PUBLISH_VERSION_V2_OPERATION;
    payload = {
      versionId: source.id,
      expectedVersion,
      scheduledAt,
      expiresAt: null,
      idempotencyKey:
        input.idempotencyKey ?? workflowKey("page-publish", key, expectedVersion, scheduledAt ?? input.publishNote ?? "now"),
    };
    fallbackReview = next === "Scheduled" ? "approved" : "published";
    fallbackStatus = next === "Scheduled" ? "scheduled" : "published";
  } else {
    return contentFailure(
      "conflict",
      "Public-page status is advanced through request review, approve, then publish or schedule.",
      current.version,
      current.reviewStatus,
    );
  }

  const response = await adapterCall<ServerContentTransition>(operation, payload);
  if (!response.ok) return adapterFailure(response, `Unable to mark the page ${next.toLowerCase()}.`);
  const version = transitionVersion(response.value, expectedVersion + 1);
  const publishesItem = operation === PUBLISH_VERSION_V2_OPERATION;
  const transitioned: PublicPageRow = {
    ...current,
    contentItemId: publishesItem ? (response.value.id ?? current.contentItemId) : current.contentItemId,
    reference: publishesItem ? (response.value.reference ?? current.reference) : current.reference,
    versionId: transitionVersionId(response.value, source.id),
    version,
    itemVersion: fallbackReview === "approved" && fallbackStatus === "draft" ? current.itemVersion : version,
    reviewStatus: fallbackReview,
    currentStatus: fallbackStatus,
    status: next,
    scheduledForIso: fallbackStatus === "scheduled" ? scheduledAt : null,
  };
  const fallback = current.version >= version ? current : transitioned;
  return {
    ok: true,
    value: await refreshServerPage(key, fallback, Math.max(current.version, version)),
    ...(response.value.replayed || replayCandidate ? { replayed: true } : {}),
  };
};
contentService.editNotice = async (slug, input) => {
  if (clientAdapterMode() !== "supabase") return originalContent.editNotice(slug, input);
  const loaded = await loadServerItemForWrite(slug, "notice");
  if (!loaded.ok) return loaded;
  const current = loaded.value.notice;
  if (!current?.contentItemId) return contentFailure("not-found", "The notice was not found.");
  if (current.status === "published" || current.status === "scheduled") {
    return contentFailure(
      "conflict",
      "Published or scheduled notices cannot be edited directly. Unpublish first.",
      current.itemVersion,
      current.status,
    );
  }
  if (current.reviewStatus !== "draft" && current.status !== "archived" && current.status !== "expired") {
    return contentFailure(
      "conflict",
      "A version in review or already approved is immutable. Start a new draft before editing.",
      current.version,
      current.reviewStatus,
    );
  }
  const title = input.title?.trim() || current.title;
  const body = input.body ? input.body.map((line) => line.trim()).filter(Boolean) : [...current.body];
  if (!title || body.length === 0) return contentFailure("validation", "A title and body are required.");
  const category = input.category ?? current.category;
  const urgent = input.urgent ?? current.urgent ?? false;
  const audience = input.audience ?? current.audience;
  const publishNote = input.publishNote === undefined ? current.publishNote : input.publishNote.trim() || undefined;
  const expectedVersion = input.expectedVersion ?? current.itemVersion;
  const idempotencyKey =
    input.idempotencyKey ??
    workflowKey("save-draft", slug, expectedVersion, `${title}|${body.join("\n")}|${publishNote ?? ""}`);
  const response = await adapterCall<ServerContentTransition>("content.saveDraft", {
    contentItemId: current.contentItemId,
    kind: "notice",
    slug,
    title,
    body: serverVersionBody({ body, category, urgent, audience, publishNote }),
    expectedVersion,
    idempotencyKey,
  });
  if (!response.ok) return adapterFailure(response, "Unable to save the content draft.");
  const version = transitionVersion(response.value, current.itemVersion + 1);
  const fallback: ContentNotice = {
    ...current,
    versionId: transitionVersionId(response.value, current.versionId),
    version,
    itemVersion: version,
    status: "draft",
    reviewStatus: "draft",
    title,
    body,
    excerpt: body[0]?.slice(0, 140) ?? "",
    category,
    urgent,
    audience,
    publishNote,
    reviewedByAccountId: null,
    scheduledForIso: null,
  };
  return { ok: true, value: await refreshServerNotice(slug, fallback, version) };
};
contentService.createPublicPage = async (input) => {
  if (clientAdapterMode() !== "supabase") return originalContent.createPublicPage(input);
  const body = input.body.map((line) => line.trim()).filter(Boolean);
  const title = input.title.trim();
  const slug = input.slug.trim().replace(/^\/+/, "").replace(/[^a-z0-9-]+/g, "-").replace(/-+$/g, "");
  if (title === "" || body.length === 0 || slug === "") {
    return contentFailure("validation", "A title, slug, and body are required to save a public page draft.");
  }
  const idempotencyKey = input.idempotencyKey ?? workflowKey("save-page-draft", slug, 0, `${title}|${body.join("\n")}`);
  const response = await adapterCall<ServerContentTransition>("content.saveDraft", {
    kind: "page",
    slug,
    title,
    body: serverVersionBody({ body, category: "General", urgent: false, audience: "public", publishNote: input.publishNote?.trim() || undefined }),
    idempotencyKey,
  });
  if (!response.ok) return adapterFailure(response, "Unable to create the public page draft.");
  const version = transitionVersion(response.value, 1);
  const fallback: PublicPageRow = {
    key: slug,
    contentItemId: response.value.id,
    reference: response.value.reference,
    versionId: response.value.versionId,
    version,
    itemVersion: version,
    reviewStatus: "draft",
    currentStatus: "draft",
    authorAccountId: input.actor?.accountId ?? null,
    reviewedByAccountId: null,
    publishNote: input.publishNote?.trim() || undefined,
    scheduledForIso: null,
    label: title,
    href: `/${slug}`,
    status: "Draft",
    lastReviewed: "—",
    owner: input.actor?.displayName ?? "Content editor",
  };
  return { ok: true, value: await refreshServerPage(slug, fallback, version) };
};
contentService.editPublicPage = async (key, input) => {
  if (clientAdapterMode() !== "supabase") return originalContent.editPublicPage(key, input);
  const loaded = await loadServerItemForWrite(key, "page");
  if (!loaded.ok) return loaded;
  const current = loaded.value.page;
  if (!current?.contentItemId) return contentFailure("not-found", "The page was not found.");
  if (current.currentStatus === "published" || current.currentStatus === "scheduled") {
    return contentFailure(
      "conflict",
      "Published or scheduled pages cannot be edited directly. Unpublish first.",
      current.itemVersion,
      current.status,
    );
  }
  if (current.reviewStatus !== "draft" && current.currentStatus !== "archived") {
    return contentFailure(
      "conflict",
      "A version in review or already approved is immutable. Start a new draft before editing.",
      current.version,
      current.reviewStatus,
    );
  }
  const body = input.body ? input.body.map((line) => line.trim()).filter(Boolean) : [current.label];
  const title = input.title?.trim() || current.label;
  if (title === "" || body.length === 0) {
    return contentFailure("validation", "A title and body are required to save a public page draft.");
  }
  const publishNote = input.publishNote === undefined ? current.publishNote : input.publishNote.trim() || undefined;
  const expectedVersion = input.expectedVersion ?? current.itemVersion;
  const idempotencyKey =
    input.idempotencyKey ??
    workflowKey("save-page-draft", key, expectedVersion, `${title}|${body.join("\n")}|${publishNote ?? ""}`);
  const response = await adapterCall<ServerContentTransition>("content.saveDraft", {
    contentItemId: current.contentItemId,
    kind: "page",
    slug: key,
    title,
    body: serverVersionBody({ body, category: "General", urgent: false, audience: "public", publishNote }),
    expectedVersion,
    idempotencyKey,
  });
  if (!response.ok) return adapterFailure(response, "Unable to save the public page draft.");
  const version = transitionVersion(response.value, current.itemVersion + 1);
  const fallback: PublicPageRow = {
    ...current,
    versionId: transitionVersionId(response.value, current.versionId),
    version,
    itemVersion: version,
    reviewStatus: "draft",
    currentStatus: "draft",
    label: title,
    publishNote,
    authorAccountId: input.actor?.accountId ?? current.authorAccountId,
    reviewedByAccountId: null,
    status: "Draft",
    lastReviewed: "—",
    owner: input.actor?.displayName ?? current.owner,
  };
  return { ok: true, value: await refreshServerPage(key, fallback, version) };
};
contentService.getPublicPageBody = async (key) => {
  if (clientAdapterMode() !== "supabase") return originalContent.getPublicPageBody(key);
  const loaded = await loadServerItemForWrite(key, "page");
  if (!loaded.ok) return null;
  const row = loaded.value.row;
  const versionRow = latestServerVersion(row);
  if (!versionRow || row.current_status !== "published") return null;
  const parsed = parseVersionBody(versionRow.body);
  return {
    title: versionRow.title,
    body: parsed.body.length > 0 ? parsed.body : ["Published school page."],
    updatedAtIso: versionRow.published_at ?? versionRow.created_at,
  };
};
contentService.getVacancy = async (slug) => {
  if (clientAdapterMode() !== "supabase") return originalContent.getVacancy(slug);
  throw new Error(`Vacancy ${slug} must be loaded through the server vacancy loader.`);
};
contentService.listVacancies = async () => {
  if (clientAdapterMode() !== "supabase") return originalContent.listVacancies();
  throw new Error("Vacancies must be loaded through the server vacancy loader.");
};
