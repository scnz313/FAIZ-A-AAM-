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

import { demoNowIso } from "@/modules/demo/clock";
import { formatKolkata } from "@/modules/iot/domain";
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

export type NoticeStatus = "draft" | "published" | "expired";
export type NoticeAudience = "public" | "family";

/**
 * A notice with its publishing state. `dateIso` is the published date shown
 * on public/portal lists (reset to the publish instant); `scheduledForIso`
 * holds a future publish date while the notice is still a draft ("Scheduled"
 * in the staff workspaces).
 */
export type ContentNotice = Notice & {
  /** Server content-version id used only by the Supabase publisher boundary. */
  versionId?: string;
  status: NoticeStatus;
  audience: NoticeAudience;
  /** Number of publishes — seeded rows have 1, fresh drafts have 0. */
  version: number;
  /** The note recorded with the latest publish (required to publish). */
  publishNote?: string;
  reviewDue: string;
  scheduledForIso: string | null;
};

/** Every write returns a typed outcome so the UI can surface errors. */
export type ContentResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Review states for the staff content page's public-page table. */
export type PublicPageReviewStatus = "Published" | "Draft" | "Needs review" | "In review";

export type PublicPageRow = {
  key: string;
  label: string;
  href: string;
  status: PublicPageReviewStatus;
  lastReviewed: string;
  owner: string;
};

/** Public pages with review state — fictional demo data. */
const PUBLIC_PAGES: PublicPageRow[] = [
  { key: "about", label: "About", href: "/about", status: "Published", lastReviewed: "28 Jul 2026", owner: "N. Lone" },
  { key: "academics", label: "Academics", href: "/academics", status: "Published", lastReviewed: "28 Jul 2026", owner: "N. Lone" },
  { key: "admissions", label: "Admissions", href: "/admissions", status: "Published", lastReviewed: "20 Jul 2026", owner: "N. Lone" },
  { key: "school-life", label: "School life", href: "/school-life", status: "Needs review", lastReviewed: "15 Jul 2026", owner: "N. Lone" },
  { key: "notices", label: "Notices", href: "/notices", status: "Published", lastReviewed: "01 Aug 2026", owner: "A. Lone" },
  { key: "careers", label: "Careers", href: "/careers", status: "Draft", lastReviewed: "—", owner: "R. Wani" },
  { key: "contact", label: "Contact", href: "/contact", status: "Published", lastReviewed: "01 Jul 2026", owner: "N. Lone" },
];

/** Session key holding the mutable public-page list. */
export const PUBLIC_PAGES_SESSION_KEY = sessionKey("content-public-pages");

function loadPublicPages(): PublicPageRow[] {
  const stored = sessionGet<PublicPageRow[]>(PUBLIC_PAGES_SESSION_KEY);
  if (stored !== null) return stored.map((row) => ({ ...row }));
  const seeded = PUBLIC_PAGES.map((row) => ({ ...row }));
  sessionSet(PUBLIC_PAGES_SESSION_KEY, seeded);
  return seeded.map((row) => ({ ...row }));
}

function savePublicPages(rows: PublicPageRow[]): void {
  sessionSet(PUBLIC_PAGES_SESSION_KEY, rows.map((row) => ({ ...row })));
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

function cloneNotice(notice: ContentNotice): ContentNotice {
  return { ...notice, body: [...notice.body] };
}

function withMeta(
  notice: Notice,
  status: NoticeStatus,
  audience: NoticeAudience,
  version: number,
  publishNote?: string,
): ContentNotice {
  return {
    ...notice,
    status,
    audience,
    version,
    publishNote,
    reviewDue: noticeReviewDue[notice.slug] ?? "2026-09-01",
    scheduledForIso: null,
  };
}

/** Fresh-session seed: the existing fictional notices plus staff-only states. */
function seedStore(): ContentNotice[] {
  return [
    ...fixtureNotices.map((notice) => withMeta(notice, "published", "public", 1, "Initial publication")),
    ...staffDraftNotices.map((notice) => withMeta(notice, "draft", "public", 0)),
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

export interface ContentService {
  /** Published notices for an audience scope: "public" site or "family" portal. */
  listForAudience(audience: "public" | "family", opts?: { status?: NoticeStatus }): Promise<ContentNotice[]>;
  /** One published notice in an audience scope, or null when not visible. */
  getNotice(slug: string, audience: "public" | "family"): Promise<ContentNotice | null>;
  /** Every notice for the staff workspaces, including draft and expired rows. */
  listForStaff(): Promise<ContentNotice[]>;
  /** Create a draft (or scheduled draft when a future date is given). */
  createNotice(input: {
    title: string;
    category: NoticeCategory;
    body: string[];
    urgent?: boolean;
    scheduledForIso?: string | null;
  }): Promise<ContentNotice>;
  /** Publish a draft/expired notice; the note is required and the version bumps. */
  publishNotice(
    slug: string,
    input: { note: string; audience?: NoticeAudience },
  ): Promise<ContentResult<ContentNotice>>;
  /** Unpublish a published notice (or clear a scheduled publish) back to draft. */
  unpublishNotice(slug: string): Promise<ContentResult<ContentNotice>>;
  /** Public download register for the notices page. */
  listDownloads(): Promise<DownloadItem[]>;
  /** Public-page review rows for the staff content page. */
  listPublicPages(): Promise<PublicPageRow[]>;
  /** Update a public page's review status (maker/checker flow). Persists to the session store. */
  setPublicPageStatus(
    key: string,
    next: PublicPageReviewStatus,
    actor: string,
  ): Promise<ContentResult<PublicPageRow>>;
  /** Edit an existing notice's title, category, and body (drafts only). */
  editNotice(
    slug: string,
    input: { title?: string; category?: NoticeCategory; body?: string[] },
  ): Promise<ContentResult<ContentNotice>>;
  /** The vacancy for a slug, or null when unknown. */
  getVacancy(slug: string): Promise<Vacancy | null>;
  listVacancies(): Promise<Vacancy[]>;
}

export function createDemoContentService(): ContentService {
  return {
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
      const store = loadStore();
      const created: ContentNotice = {
        slug: slugFor(store, input.title),
        category: input.category,
        title: input.title.trim(),
        excerpt: input.body[0]?.slice(0, 140) ?? "",
        body: [...input.body],
        dateIso: demoNowIso(),
        urgent: input.urgent ?? false,
        status: "draft",
        audience: "public",
        version: 0,
        reviewDue: "2026-09-01",
        scheduledForIso: input.scheduledForIso?.trim() ? input.scheduledForIso.trim() : null,
      };
      saveStore([...store, created]);
      return cloneNotice(created);
    },

    async publishNotice(slug, input) {
      const note = input.note.trim();
      if (note === "") {
        return { ok: false, message: "A publish note is required." };
      }
      const store = loadStore();
      const current = store.find((notice) => notice.slug === slug);
      if (current === undefined) {
        return { ok: false, message: "The notice was not found." };
      }
      if (current.status === "published" && current.publishNote === note) {
        return { ok: false, message: "This notice is already published with the same note. Use a different note to republish." };
      }
      const next: ContentNotice = {
        ...current,
        status: "published",
        audience: input.audience ?? current.audience,
        version: current.version + 1,
        publishNote: note,
        dateIso: demoNowIso(),
        scheduledForIso: null,
      };
      saveStore(store.map((notice) => (notice.slug === slug ? next : notice)));
      /* One delivery event per publish (plan.md Phase 4) — idempotent by
         event id, so a retried publish never sends twice. */
      enqueueOutboxEvent({
        eventId: `content.published:${next.slug}`,
        kind: "content.published",
        targetRef: next.slug,
        actor: "Content office",
      });
      void auditService.record({
        actor: "Content office",
        action: "Notice published",
        target: next.slug,
        outcome: "Success",
        reason: note,
      });
      return { ok: true, value: cloneNotice(next) };
    },

    async unpublishNotice(slug) {
      const store = loadStore();
      const current = store.find((notice) => notice.slug === slug);
      if (current === undefined) {
        return { ok: false, message: "The notice was not found." };
      }
      if (current.status !== "published" && current.scheduledForIso === null) {
        return { ok: false, message: "The notice is not published." };
      }
      const next: ContentNotice = { ...current, status: "draft", scheduledForIso: null };
      saveStore(store.map((notice) => (notice.slug === slug ? next : notice)));
      void auditService.record({
        actor: "Content office",
        action: "Notice unpublished",
        target: slug,
        outcome: "Success",
        reason: "Notice unpublished back to draft",
      });
      return { ok: true, value: cloneNotice(next) };
    },

    async listDownloads() {
      return DOWNLOADS.map((item) => ({ ...item }));
    },

    async listPublicPages() {
      return loadPublicPages();
    },

    async setPublicPageStatus(key, nextStatus, actor) {
      const rows = loadPublicPages();
      const current = rows.find((row) => row.key === key);
      if (current === undefined) {
        return { ok: false, message: "The page was not found." };
      }
      const today = formatKolkata(demoNowIso(), { format: "day" });
      const updated: PublicPageRow = {
        ...current,
        status: nextStatus,
        lastReviewed: nextStatus === "Published" ? today : current.lastReviewed,
      };
      savePublicPages(rows.map((row) => (row.key === key ? updated : row)));
      void auditService.record({
        actor,
        action: "Page status updated",
        target: `page:${key}`,
        outcome: "Success",
        reason: `Page status set to ${nextStatus}`,
      });
      return { ok: true, value: { ...updated } };
    },

    async editNotice(slug, input) {
      const store = loadStore();
      const current = store.find((notice) => notice.slug === slug);
      if (current === undefined) {
        return { ok: false, message: "The notice was not found." };
      }
      if (current.status === "published") {
        return { ok: false, message: "Published notices cannot be edited directly. Unpublish first." };
      }
      const updated: ContentNotice = {
        ...current,
        title: input.title?.trim() || current.title,
        category: input.category ?? current.category,
        body: input.body ? [...input.body] : current.body,
        excerpt: input.body ? (input.body[0]?.slice(0, 140) ?? "") : current.excerpt,
      };
      saveStore(store.map((notice) => (notice.slug === slug ? updated : notice)));
      void auditService.record({
        actor: "Content office",
        action: "Notice edited",
        target: slug,
        outcome: "Success",
        reason: `Notice edited: ${input.title ? "title changed" : "content updated"}`,
      });
      return { ok: true, value: cloneNotice(updated) };
    },

    getVacancy: (slug) => Promise.resolve(vacancies.find((item) => item.slug === slug) ?? null),
    listVacancies: () => Promise.resolve(vacancies.map((item) => ({ ...item }))),
  };
}

/** Default singleton consumed by pages. */
export const contentService: ContentService = createDemoContentService();

/* Supabase facade: protected/public reads use only the authorized adapter
 * projection. Demo session rows are never consulted in this branch. */
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

export type ServerContentRow = {
  id: string;
  reference: string;
  kind: string;
  slug: string;
  current_status: string;
  version?: number;
  current_version_id?: string | null;
  content_versions?: Array<{ id: string; version: number; title: string; body: unknown; review_status: string; published_at: string | null; created_at: string }>;
  notices?: Array<{ category: string; urgent: boolean; status: string; published_at: string | null; expires_at: string | null; scheduled_at?: string | null; notice_audiences?: Array<{ audience: string }> }>;
};

export function mapServerContentRow(row: ServerContentRow): ContentNotice {
  const version = [...(row.content_versions ?? [])].sort((a, b) => b.version - a.version)[0];
  const bodyValue = version?.body;
  const body = typeof bodyValue === "object" && bodyValue !== null && !Array.isArray(bodyValue) && Array.isArray((bodyValue as { blocks?: unknown }).blocks)
    ? ((bodyValue as { blocks: unknown[] }).blocks).map((block) => typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : "").filter(Boolean)
    : Array.isArray(bodyValue) ? bodyValue.filter((item): item is string => typeof item === "string") : [typeof bodyValue === "string" ? bodyValue : "Published school notice."];
  const notice = row.notices?.[0];
  const audience = notice?.notice_audiences?.some((candidate) => candidate.audience !== "public") ? "family" : "public";
  return { slug: row.slug, versionId: (version as { id?: string } | undefined)?.id, category: (notice?.category ?? "General") as NoticeCategory, title: version?.title ?? row.slug, excerpt: body[0]?.slice(0, 140) ?? "", body, dateIso: notice?.published_at ?? version?.published_at ?? version?.created_at ?? "", urgent: notice?.urgent ?? false, status: row.current_status === "expired" ? "expired" : row.current_status === "published" ? "published" : "draft", audience, version: row.version ?? version?.version ?? 0, reviewDue: "—", scheduledForIso: notice?.scheduled_at ?? null };
}

const originalContent = createDemoContentService();
contentService.listForAudience = async (audience, opts = {}) => {
  if (clientAdapterMode() !== "supabase") return originalContent.listForAudience(audience, opts);
  const response = await adapterCall<ServerContentRow[]>("content.list", { scope: audience === "family" ? "family" : "public" });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Content is unavailable.");
  return response.value.map(mapServerContentRow).filter((row) => row.status === (opts.status ?? "published"));
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
  return response.value.map(mapServerContentRow);
};
contentService.createNotice = async (input) => {
  if (clientAdapterMode() !== "supabase") return originalContent.createNotice(input);
  const response = await adapterCall<{ reference: string; version: number }>("content.saveDraft", { contentItemId: null, kind: "notice", slug: input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: input.title, body: { blocks: input.body.map((text) => ({ type: "paragraph", text })) } });
  if (!response.ok) throw new Error(response.errors[0]?.message ?? "Unable to create content draft.");
  return { slug: input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), category: input.category, title: input.title, excerpt: input.body[0] ?? "", body: [...input.body], dateIso: new Date().toISOString(), urgent: input.urgent ?? false, status: "draft", audience: "public", version: response.value.version, reviewDue: "—", scheduledForIso: input.scheduledForIso ?? null };
};
contentService.publishNotice = async (slug, input) => {
  if (clientAdapterMode() !== "supabase") return originalContent.publishNotice(slug, input);
  const rows = await contentService.listForStaff();
  const row = rows.find((candidate) => candidate.slug === slug);
  const versionId = row?.versionId;
  if (row === undefined || !versionId) return { ok: false, message: "The content version is not available for publication." };
  const response = await adapterCall<unknown>("content.publishVersion", { versionId });
  const current = row;
  return response.ok ? { ok: true, value: { ...current, status: "published", publishNote: input.note } } : { ok: false, message: response.errors[0]?.message ?? "Unable to publish content." };
};
contentService.unpublishNotice = async (slug) => {
  if (clientAdapterMode() !== "supabase") return originalContent.unpublishNotice(slug);
  const rows = await adapterCall<ServerContentRow[]>("content.list", { scope: "staff" });
  if (!rows.ok) throw new Error(rows.errors[0]?.message ?? "Content is unavailable.");
  const row = rows.value.find((candidate) => candidate.slug === slug);
  if (!row) return { ok: false, message: "The notice was not found." };
  const response = await adapterCall<unknown>("content.unpublish", { contentItemId: row.id, reason: "Unpublished through the content workspace." });
  return response.ok ? { ok: true, value: mapServerContentRow({ ...row, current_status: "draft" }) } : { ok: false, message: response.errors[0]?.message ?? "Unable to unpublish content." };
};
contentService.listDownloads = async () => {
  if (clientAdapterMode() !== "supabase") return originalContent.listDownloads();
  throw new Error("Public download metadata is not available in the current content projection.");
};
contentService.listPublicPages = async () => {
  if (clientAdapterMode() !== "supabase") return originalContent.listPublicPages();
  throw new Error("Public page review metadata is not available in the current content projection.");
};
contentService.setPublicPageStatus = async (key, next, actor) => {
  if (clientAdapterMode() !== "supabase") return originalContent.setPublicPageStatus(key, next, actor);
  throw new Error(`Public page review is unavailable for ${key}.`);
};
contentService.editNotice = async (slug, input) => {
  if (clientAdapterMode() !== "supabase") return originalContent.editNotice(slug, input);
  const rows = await adapterCall<ServerContentRow[]>("content.list", { scope: "staff" });
  const row = rows.ok ? rows.value.find((candidate) => candidate.slug === slug) : undefined;
  if (!row) return { ok: false, message: "The notice was not found." };
  const current = mapServerContentRow(row);
  const response = await adapterCall<unknown>("content.saveDraft", { contentItemId: row.id, kind: row.kind, slug, title: input.title ?? current.title, body: { blocks: (input.body ?? current.body).map((text) => ({ type: "paragraph", text })) }, expectedVersion: current.version });
  return response.ok ? { ok: true, value: { ...current, title: input.title ?? current.title, body: input.body ?? current.body, status: "draft", version: current.version + 1 } } : { ok: false, message: response.errors[0]?.message ?? "Unable to edit content." };
};
contentService.getVacancy = async (slug) => {
  if (clientAdapterMode() !== "supabase") return originalContent.getVacancy(slug);
  throw new Error(`Vacancy ${slug} must be loaded through the server vacancy loader.`);
};
contentService.listVacancies = async () => {
  if (clientAdapterMode() !== "supabase") return originalContent.listVacancies();
  throw new Error("Vacancies must be loaded through the server vacancy loader.");
};
