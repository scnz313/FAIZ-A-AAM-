/**
 * Content loader projection test: the staff/family notice loader must map
 * only notice rows into `ContentNotice`. Managed pages share the same
 * `content.list` projection, and returning them here made published pages
 * appear as notices in the guardian portal and the staff notice register.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({ operation: vi.fn() }));

vi.mock("@/lib/supabase/adapter-server", () => ({
  serverAdapterOperation: adapterMocks.operation,
}));

import { loadServerContent } from "@/lib/supabase/server-loaders";

function row(input: {
  kind: "notice" | "page";
  slug: string;
  title: string;
  status?: string;
  expiresAt?: string | null;
  audience?: "public" | "family";
}) {
  return {
    id: `00000000-0000-4000-8000-0000000000${input.kind === "page" ? "11" : "22"}`,
    reference: input.kind === "page" ? "CTN-2026-PAGE" : "CTN-2026-NOTE",
    kind: input.kind,
    slug: input.slug,
    current_status: input.status ?? "published",
    version: 1,
    current_version_id: "00000000-0000-4000-8000-00000000c111",
    updated_at: "2026-09-11T06:00:00.000Z",
    content_versions: [
      {
        id: "00000000-0000-4000-8000-00000000c111",
        version: 1,
        title: input.title,
        body: {
          blocks: [{ type: "paragraph", text: `${input.title} body.` }],
          metadata: input.audience === undefined ? {} : { audience: input.audience },
        },
        review_status: "published",
        published_at: "2026-09-11T06:00:00.000Z",
        created_at: "2026-09-11T05:00:00.000Z",
        author_account_id: null,
        reviewed_by_account_id: null,
      },
    ],
    notices:
      input.kind === "page"
        ? []
        : [
            {
              category: "General",
              urgent: false,
              pinned: false,
              status: input.status ?? "published",
              published_at: "2026-09-11T06:00:00.000Z",
              expires_at: input.expiresAt ?? null,
              review_due: null,
              scheduled_at: null,
              notice_audiences: [{ audience: input.audience ?? "public" }],
            },
          ],
  };
}

describe("loadServerContent", () => {
  beforeEach(() => adapterMocks.operation.mockReset());

  it("excludes managed pages from the staff notice projection", async () => {
    adapterMocks.operation.mockResolvedValue({
      ok: true,
      value: [row({ kind: "notice", slug: "depth-notice", title: "Depth notice" }), row({ kind: "page", slug: "home-hero", title: "Managed hero" })],
    });

    const notices = await loadServerContent("staff");

    expect(adapterMocks.operation).toHaveBeenCalledWith("content.list", { scope: "staff" });
    expect(notices.map((notice) => notice.slug)).toEqual(["depth-notice"]);
    expect(notices.map((notice) => notice.title)).toEqual(["Depth notice"]);
  });

  it("excludes managed pages from the family notice projection", async () => {
    adapterMocks.operation.mockResolvedValue({
      ok: true,
      value: [row({ kind: "page", slug: "policy-privacy", title: "Managed privacy" }), row({ kind: "notice", slug: "family-notice", title: "Family notice" })],
    });

    const notices = await loadServerContent("family");

    expect(notices.map((notice) => notice.slug)).toEqual(["family-notice"]);
  });

  it("keeps only published, unexpired family-visible notices in the portal projection", async () => {
    /* Live defect: the portal copy promises that expired notices disappear
       automatically, but the loader mapped every workflow state, so archived,
       expired, and draft staging rows rendered as if published. */
    const past = "2026-09-01T00:00:00.000Z";
    const future = "2026-12-31T00:00:00.000Z";
    adapterMocks.operation.mockResolvedValue({
      ok: true,
      value: [
        row({ kind: "notice", slug: "live-public", title: "Live public" }),
        row({ kind: "notice", slug: "live-family", title: "Live family", audience: "family" }),
        row({ kind: "notice", slug: "expired-status", title: "Expired status", status: "expired" }),
        row({ kind: "notice", slug: "archived-status", title: "Archived status", status: "archived" }),
        row({ kind: "notice", slug: "draft-status", title: "Draft status", status: "draft" }),
        row({ kind: "notice", slug: "past-expiry", title: "Past expiry", expiresAt: past }),
        row({ kind: "notice", slug: "future-expiry", title: "Future expiry", expiresAt: future }),
      ],
    });

    const notices = await loadServerContent("family");

    expect(notices.map((notice) => notice.slug)).toEqual(["live-public", "live-family", "future-expiry"]);
    expect(notices.map((notice) => notice.audience)).toEqual(["public", "family", "public"]);
  });

  it("never filters the staff register by notice status", async () => {
    adapterMocks.operation.mockResolvedValue({
      ok: true,
      value: [
        row({ kind: "notice", slug: "archived-status", title: "Archived status", status: "archived" }),
        row({ kind: "notice", slug: "live-public", title: "Live public" }),
      ],
    });

    const notices = await loadServerContent("staff");

    expect(notices.map((notice) => notice.slug)).toEqual(["archived-status", "live-public"]);
  });

  it("surfaces the adapter failure instead of an empty list", async () => {
    adapterMocks.operation.mockResolvedValue({
      ok: false,
      errors: [{ code: "unavailable", message: "Content could not be loaded.", field: null }],
    });

    await expect(loadServerContent("staff")).rejects.toThrow("Content could not be loaded.");
  });
});
