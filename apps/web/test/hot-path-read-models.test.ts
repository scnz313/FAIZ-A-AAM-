// @vitest-environment node
/**
 * Hot-path read-model regressions for the 4,000-student scale target:
 *   · the staff admissions queue never embeds immutable submission snapshots;
 *   · the invoice register pages with an exact total via `.range()`;
 *   · one page's attempts are filtered by that page's invoice ids.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { admissionListStaffQueue, contentListPublic, financeListAttemptsForInvoices, financeListInvoicesPage, jobsListStaffQueue } from "@/lib/supabase/domain";
import type { Database } from "@/lib/supabase/database.types";

type Stub = {
  client: SupabaseClient<Database>;
  calls: { select: unknown[][]; order: unknown[][]; range: unknown[][]; in: unknown[][]; limit: unknown[][] };
  fromMock: ReturnType<typeof vi.fn>;
};

function stubClient(result: { data: unknown; count?: number | null; error: unknown }): Stub {
  const calls: Stub["calls"] = { select: [], order: [], range: [], in: [], limit: [] };
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn((...args: unknown[]) => { calls.select.push(args); return builder; });
  builder.order = vi.fn((...args: unknown[]) => { calls.order.push(args); return builder; });
  builder.range = vi.fn((...args: unknown[]) => { calls.range.push(args); return builder; });
  builder.limit = vi.fn((...args: unknown[]) => { calls.limit.push(args); return builder; });
  builder.eq = vi.fn(() => builder);
  builder.not = vi.fn(() => builder);
  builder.in = vi.fn((...args: unknown[]) => { calls.in.push(args); return builder; });
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  const fromMock = vi.fn(() => builder);
  const client = { from: fromMock } as unknown as SupabaseClient<Database>;
  return { client, calls, fromMock };
}

describe("staff admissions queue projection", () => {
  it("never embeds immutable submission snapshots", async () => {
    const { client, calls } = stubClient({ data: [], error: null });
    const result = await admissionListStaffQueue(client);
    expect(result.ok).toBe(true);
    const columns = String(calls.select[0]?.[0] ?? "");
    expect(columns).toContain("admission_application_versions(id, version, schema_version, created_at)");
    expect(columns).not.toContain("snapshot");
    expect(calls.select[0]?.[1]).toBeUndefined();
  });
});

describe("staff careers queue projection", () => {
  it("embeds only the latest application version snapshot", async () => {
    const { client, calls } = stubClient({ data: [], error: null });
    const result = await jobsListStaffQueue(client);
    expect(result.ok).toBe(true);
    const columns = String(calls.select[0]?.[0] ?? "");
    /* The snapshot column stays (the mapper reads the candidate name from it),
       but the embed is ordered newest-first and capped at one row so the queue
       never ships every submitted version for every application. */
    expect(columns).toContain("job_application_versions(version, snapshot)");
    expect(calls.order).toContainEqual(["version", { referencedTable: "job_application_versions", ascending: false }]);
    expect(calls.limit).toEqual([[1, { referencedTable: "job_application_versions" }]]);
  });
});

describe("public content projection", () => {
  it("reads only the current immutable version per published item", async () => {
    const selects: Record<string, unknown[][]> = { content_items: [], content_versions: [] };
    const ins: Record<string, unknown[][]> = { content_items: [], content_versions: [] };
    function tableBuilder(table: string, data: unknown) {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn((...args: unknown[]) => { selects[table]?.push(args); return builder; });
      builder.in = vi.fn((...args: unknown[]) => { ins[table]?.push(args); return builder; });
      builder.order = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
      return builder;
    }
    const client = {
      from: vi.fn((table: string) => {
        if (table === "content_items") {
          return tableBuilder(table, [{
            id: "item-1",
            reference: "NTC-2026-0001",
            kind: "notice",
            slug: "school-reopens",
            current_status: "published",
            version: 3,
            current_version_id: "version-3",
            updated_at: "2026-09-01T00:00:00.000Z",
            notices: [{ id: "notice-1", reference: "NTC-2026-0001", category: "general", urgent: false, pinned: false, status: "published", published_at: "2026-09-01T00:00:00.000Z", expires_at: null, review_due: null, scheduled_at: null, starts_at: null, unpublished_at: null }],
          }]);
        }
        return tableBuilder(table, [{ id: "version-3", content_item_id: "item-1", version: 3, title: "School reopens", body: {}, review_status: "published", published_at: "2026-09-01T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z", author_account_id: null, reviewed_by_account_id: null, approved_at: null }]);
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await contentListPublic(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ins.content_items).toEqual([["current_status", ["published", "expired"]]]);
    expect(ins.content_versions).toEqual([["id", ["version-3"]]]);
    const row = result.value[0] as unknown as { content_versions?: Array<{ id: string; version: number }> };
    expect(row.content_versions).toEqual([expect.objectContaining({ id: "version-3", version: 3 })]);
  });
});

describe("invoice register paging", () => {
  it("requests one exact-count range", async () => {
    const { client, calls } = stubClient({ data: [{ reference: "INV-2026-0001" }], count: 1250, error: null });
    const result = await financeListInvoicesPage(client, { from: 100, to: 149 });
    expect(calls.range).toEqual([[100, 149]]);
    expect(calls.select[0]?.[1]).toEqual({ count: "exact" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.total).toBe(1250);
      expect(result.value.rows).toHaveLength(1);
    }
  });

  it("bounds page attempts to the page's invoice ids", async () => {
    const { client, calls, fromMock } = stubClient({ data: [], error: null });
    const empty = await financeListAttemptsForInvoices(client, []);
    expect(empty.ok).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();

    const ids = ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"];
    await financeListAttemptsForInvoices(client, ids);
    expect(calls.in).toEqual([["invoice_id", ids]]);
  });
});
