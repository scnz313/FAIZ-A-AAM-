/**
 * Public `/school-life` loader: reads the latest published page body through
 * `app.public_page_body` so a newer unpublished draft never takes the live
 * page offline. A missing payload, a legacy paragraphs body, a malformed
 * body, and a projection failure all resolve to null so the route renders
 * the shipped default copy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const domainMocks = vi.hoisted(() => ({
  contentPublicPageBody: vi.fn(),
}));

const serverMocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(async () => ({})),
}));

vi.mock("@/lib/supabase/domain", () => ({
  contentPublicPageBody: domainMocks.contentPublicPageBody,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: serverMocks.createSupabaseServerClient,
}));

import { DEFAULT_SCHOOL_LIFE_BODY } from "@fass/contracts";

async function loadBody() {
  /* React `cache` memoises per module instance, so each case re-imports the
     loader to see its own mocked result. */
  vi.resetModules();
  const mod = await import("@/lib/supabase/server-loaders");
  return mod.loadServerSchoolLifeBody();
}

beforeEach(() => {
  domainMocks.contentPublicPageBody.mockReset();
});

describe("loadServerSchoolLifeBody", () => {
  it("returns null when no published school-life version exists", async () => {
    domainMocks.contentPublicPageBody.mockReturnValue(Promise.resolve({ ok: true, value: null }));
    expect(await loadBody()).toBeNull();
  });

  it("returns the parsed structured body from the published payload", async () => {
    domainMocks.contentPublicPageBody.mockReturnValue(
      Promise.resolve({
        ok: true,
        value: { title: "School life", body: DEFAULT_SCHOOL_LIFE_BODY, version: 4, publishedAt: "2026-09-16T06:00:00.000Z" },
      }),
    );
    const body = await loadBody();
    expect(body?.intro.title).toBe(DEFAULT_SCHOOL_LIFE_BODY.intro.title);
    expect(body?.gallery).toHaveLength(DEFAULT_SCHOOL_LIFE_BODY.gallery.length);
  });

  it("asks for the school-life slug", async () => {
    domainMocks.contentPublicPageBody.mockReturnValue(Promise.resolve({ ok: true, value: null }));
    await loadBody();
    expect(domainMocks.contentPublicPageBody).toHaveBeenCalledWith(expect.anything(), "school-life");
  });

  it("returns null when the stored body is a legacy paragraphs body", async () => {
    domainMocks.contentPublicPageBody.mockReturnValue(
      Promise.resolve({
        ok: true,
        value: { title: "School life", body: { blocks: [{ type: "paragraph", text: "Legacy copy." }] } },
      }),
    );
    expect(await loadBody()).toBeNull();
  });

  it("returns null when the projection reports an error", async () => {
    domainMocks.contentPublicPageBody.mockReturnValue(
      Promise.resolve({ ok: false, errors: [{ code: "unavailable", message: "down" }] }),
    );
    expect(await loadBody()).toBeNull();
  });

  it("returns null when the projection throws", async () => {
    domainMocks.contentPublicPageBody.mockRejectedValue(new Error("connection refused"));
    expect(await loadBody()).toBeNull();
  });
});
