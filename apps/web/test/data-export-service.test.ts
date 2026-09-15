/**
 * Protected export service contract. The service is the only boundary the
 * workspace uses: catalog reads, requests, recovery actions, and signed
 * downloads. Demo mode must refuse to fabricate a successful file operation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({
  clientAdapterMode: vi.fn<() => "demo" | "supabase">(() => "supabase"),
  adapterCall: vi.fn(),
}));

vi.mock("@/modules/services/adapter-client", () => ({
  clientAdapterMode: adapterMocks.clientAdapterMode,
  adapterCall: adapterMocks.adapterCall,
}));

import { dataExportService } from "@/modules/services/data-export";

function ok<T>(value: T) {
  return { ok: true as const, value };
}

function fail(message: string) {
  return { ok: false as const, errors: [{ code: "unavailable", message, field: null }] };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  adapterMocks.clientAdapterMode.mockReturnValue("supabase");
});

describe("data export service (supabase mode)", () => {
  it("maps the approved catalog from the database projection", async () => {
    adapterMocks.adapterCall.mockResolvedValue(ok([{
      id: "catalog-1",
      reference: "XCAT-2026-0001",
      domain: "students",
      display_name: "Students",
      description: "Student identity records.",
      available_columns: [
        { column: "reference", label: "Reference", type: "text" },
        { column: "display_name", label: "Display name", type: "text" },
      ],
      optional_filters: [{ filter: "status", label: "Status", type: "text" }],
      max_rows: 50000,
    }]));

    const catalogs = await dataExportService.listCatalogs();
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]?.displayName).toBe("Students");
    expect(catalogs[0]?.availableColumns.map((column) => column.column)).toEqual(["reference", "display_name"]);
    expect(catalogs[0]?.optionalFilters).toEqual([{ filter: "status", label: "Status", type: "text" }]);
    expect(adapterMocks.adapterCall).toHaveBeenCalledWith("dataExports.listCatalog", {});
  });

  it("sends the selected catalog columns with a request", async () => {
    adapterMocks.adapterCall.mockResolvedValue(ok({ reference: "EXP-2026-0001", state: "requested", version: 1 }));

    const result = await dataExportService.request({
      domain: "students",
      filters: {},
      columns: ["reference", "grade_label"],
      format: "csv",
      purpose: "Annual reporting",
      reason: "Board submission",
    });

    expect(result.reference).toBe("EXP-2026-0001");
    expect(adapterMocks.adapterCall).toHaveBeenCalledWith("dataExports.request", {
      domain: "students",
      filters: {},
      columns: ["reference", "grade_label"],
      format: "csv",
      purpose: "Annual reporting",
      reason: "Board submission",
    });
  });

  it("retries a failed export and cancels in-flight requests with a reason", async () => {
    adapterMocks.adapterCall.mockResolvedValue(ok({ reference: "EXP-2026-0002", state: "requested" }));
    await dataExportService.retry("EXP-2026-0002", "Provider outage resolved");
    expect(adapterMocks.adapterCall).toHaveBeenCalledWith("dataExports.retry", {
      requestReference: "EXP-2026-0002",
      reason: "Provider outage resolved",
    });

    await dataExportService.cancel("EXP-2026-0002", "Requested by mistake");
    expect(adapterMocks.adapterCall).toHaveBeenCalledWith("dataExports.cancel", {
      requestReference: "EXP-2026-0002",
      reason: "Requested by mistake",
    });
  });

  it("recovers a stuck generating export by request id with a recorded reason", async () => {
    adapterMocks.adapterCall.mockResolvedValue(ok({
      requestId: "00000000-0000-4000-8000-000000000001",
      reference: "EXP-2026-0005",
      state: "requested",
      version: 4,
    }));

    await dataExportService.recover("00000000-0000-4000-8000-000000000001", "Worker died at the queue layer");

    expect(adapterMocks.adapterCall).toHaveBeenCalledWith("dataExports.recover", {
      requestId: "00000000-0000-4000-8000-000000000001",
      reason: "Worker died at the queue layer",
    });
  });

  it("surfaces the server refusal when a stuck export cannot be recovered", async () => {
    adapterMocks.adapterCall.mockResolvedValue(fail("the export generation lease has not expired"));
    await expect(dataExportService.recover("00000000-0000-4000-8000-000000000002", "Premature recovery"))
      .rejects.toThrow("the export generation lease has not expired");
  });

  it("surfaces adapter failures instead of returning an empty result", async () => {
    adapterMocks.adapterCall.mockResolvedValue(fail("Export requests are unavailable."));
    await expect(dataExportService.listRequests()).rejects.toThrow("Export requests are unavailable.");
  });

  it("returns a signed URL from the authorized download route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ signedUrl: "https://storage.example/signed/abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(dataExportService.signedDownloadUrl("EXP-2026-0003")).resolves.toBe("https://storage.example/signed/abc");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/data-exports/EXP-2026-0003/download",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("surfaces a first-page keyset failure instead of silently showing the unpaged projection", async () => {
    /* 000110 repaired app.data_export_list_paginated; the pre-fix fallback to
       dataExports.list is gone. A genuine failure must reach the error panel
       rather than quietly dropping pagination and masking the cause. */
    adapterMocks.adapterCall.mockResolvedValue(fail("Export requests are unavailable."));

    await expect(dataExportService.listRequestsPage(null, 2)).rejects.toThrow("Export requests are unavailable.");
    expect(adapterMocks.adapterCall).toHaveBeenCalledTimes(1);
    expect(adapterMocks.adapterCall).toHaveBeenCalledWith("dataExports.listPaginated", { cursor: null, limit: 2 });
    expect(adapterMocks.adapterCall).not.toHaveBeenCalledWith("dataExports.list", {});
  });

  it("maps the latest failure detail onto a failed request row", async () => {
    adapterMocks.adapterCall.mockResolvedValue(ok({
      rows: [{
        requestId: "request-1",
        reference: "EXP-2026-0009",
        domain: "students",
        state: "failed",
        format: "csv",
        rowCount: null,
        purpose: "Board reporting",
        expiresAt: null,
        createdAt: "2026-09-11T00:00:00.000Z",
        lastEventType: "failed",
        lastEventDetail: "Storage bucket unreachable while writing the artifact",
        failedAt: "2026-09-11T01:00:00.000Z",
      }],
      nextCursor: null,
    }));

    const page = await dataExportService.listRequestsPage(null, 20);

    expect(page.rows[0]).toMatchObject({
      reference: "EXP-2026-0009",
      lastEventType: "failed",
      lastEventDetail: "Storage bucket unreachable while writing the artifact",
      failedAt: "2026-09-11T01:00:00.000Z",
    });
  });

  it("surfaces an expired or unavailable artifact error from the route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This export has expired. Request a new export." }),
    }));

    await expect(dataExportService.signedDownloadUrl("EXP-2026-0004")).rejects.toThrow(/expired/i);
  });
});

describe("data export service (demo mode)", () => {
  it("never fabricates an export request result", async () => {
    adapterMocks.clientAdapterMode.mockReturnValue("demo");
    await expect(dataExportService.request({
      domain: "students",
      filters: {},
      columns: ["reference"],
      format: "csv",
      purpose: "Demo",
      reason: "Demo",
    })).rejects.toThrow(/live school database/i);
    await expect(dataExportService.recover("00000000-0000-4000-8000-000000000003", "Demo")).rejects.toThrow(/live school database/i);
    await expect(dataExportService.listCatalogs()).resolves.toEqual([]);
    await expect(dataExportService.listRequests()).resolves.toEqual([]);
    expect(adapterMocks.adapterCall).not.toHaveBeenCalled();
  });
});
