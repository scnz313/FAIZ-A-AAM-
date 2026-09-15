// @vitest-environment jsdom

/**
 * Exports workspace states: catalog-driven field selection, XLSX visibly
 * disabled, retryable load/download failures, failed-generation recovery,
 * and an honest demo mode that never fabricates a file.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCatalogs: vi.fn(),
  listRequests: vi.fn(),
  listRequestsPage: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  recover: vi.fn(),
  signedDownloadUrl: vi.fn(),
  mode: vi.fn<() => "demo" | "supabase">(() => "supabase"),
}));

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: () => ({ summary: { roles: ["system_administrator"] } }),
}));
vi.mock("@/modules/services/staff-profiles", () => ({ canAnyRole: () => true }));
vi.mock("@/modules/services/adapter-client", () => ({ clientAdapterMode: () => mocks.mode() }));
vi.mock("@/modules/services/data-export", () => ({
  dataExportService: {
    listCatalogs: mocks.listCatalogs,
    listRequests: mocks.listRequests,
    listRequestsPage: mocks.listRequestsPage,
    request: mocks.request,
    cancel: mocks.cancel,
    retry: mocks.retry,
    recover: mocks.recover,
    signedDownloadUrl: mocks.signedDownloadUrl,
  },
}));

import DataExportsWorkspace from "@/app/staff/data/exports/page";
import type { ExportCatalog, ExportRequestRow } from "@/modules/services/data-export";

const CATALOG: ExportCatalog = {
  id: "catalog-1",
  reference: "XCAT-2026-0001",
  domain: "students",
  displayName: "Students",
  description: "Student identity records with current enrollment placement.",
  availableColumns: [
    { column: "reference", label: "Reference", type: "text" },
    { column: "status", label: "Status", type: "text" },
    { column: "grade_label", label: "Grade", type: "text" },
  ],
  optionalFilters: [],
  maxRows: 50000,
};

const READY_ROW: ExportRequestRow = {
  requestId: "request-1",
  reference: "EXP-2026-0001",
  domain: "students",
  state: "ready",
  format: "csv",
  rowCount: 12,
  purpose: "Board reporting",
  expiresAt: "2026-09-12T00:00:00.000Z",
  createdAt: "2026-09-11T00:00:00.000Z",
  lastEventType: "ready",
  lastEventDetail: "12 rows",
  failedAt: null,
};

const FAILED_ROW: ExportRequestRow = {
  ...READY_ROW,
  requestId: "request-2",
  reference: "EXP-2026-0002",
  state: "failed",
  rowCount: null,
  lastEventType: "failed",
  lastEventDetail: "Storage bucket unreachable while writing the artifact",
  failedAt: "2026-09-11T01:00:00.000Z",
};

const STUCK_GENERATING_ROW: ExportRequestRow = {
  ...READY_ROW,
  requestId: "request-4",
  reference: "EXP-2026-0004",
  state: "generating",
  rowCount: null,
  lastEventType: "failed",
  lastEventDetail: "export request is not generatable (state: generating)",
  failedAt: "2026-09-11T02:00:00.000Z",
};

const HEALTHY_GENERATING_ROW: ExportRequestRow = {
  ...READY_ROW,
  requestId: "request-5",
  reference: "EXP-2026-0005",
  state: "generating",
  rowCount: null,
  lastEventType: "generation_started",
  lastEventDetail: "attempt 2",
  failedAt: null,
};

beforeEach(() => {
  mocks.mode.mockReturnValue("supabase");
  mocks.listCatalogs.mockResolvedValue([CATALOG]);
  mocks.listRequests.mockResolvedValue([READY_ROW, FAILED_ROW]);
  mocks.listRequestsPage.mockResolvedValue({ rows: [READY_ROW, FAILED_ROW], nextCursor: null });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("exports workspace", () => {
  it("requests only the selected approved columns", async () => {
    const user = userEvent.setup();
    mocks.request.mockResolvedValue({ reference: "EXP-2026-0003", state: "requested" });

    render(<DataExportsWorkspace />);

    expect(await screen.findByRole("checkbox", { name: "Status" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Status" }));
    await user.type(screen.getByLabelText(/Purpose/), "Board reporting");
    await user.type(screen.getByLabelText(/Reason/), "Annual board submission");
    await user.click(screen.getByRole("button", { name: "Request export" }));

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      domain: "students",
      columns: ["reference", "grade_label"],
      format: "csv",
      purpose: "Board reporting",
      reason: "Annual board submission",
    })));

    const xlsx = screen.getByRole("option", { name: /XLSX/ }) as HTMLOptionElement;
    expect(xlsx.disabled).toBe(true);
  });

  it("retries a failed export only after a recorded reason is supplied", async () => {
    const user = userEvent.setup();
    mocks.retry.mockResolvedValue(undefined);

    render(<DataExportsWorkspace />);

    expect(await screen.findByText(/Storage bucket unreachable while writing the artifact/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Retry generation" }));
    expect(screen.getByRole("heading", { name: /Retry export generation/ })).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Confirm retry" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason \(required/), "Provider outage resolved");
    await user.click(confirm);

    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("EXP-2026-0002", "Provider outage resolved"));
  });

  it("recovers a stuck generating export only after a recorded reason is supplied", async () => {
    const user = userEvent.setup();
    mocks.listRequestsPage.mockResolvedValue({ rows: [STUCK_GENERATING_ROW], nextCursor: null });
    mocks.recover.mockResolvedValue(undefined);

    render(<DataExportsWorkspace />);

    expect(await screen.findByText(/export request is not generatable \(state: generating\)/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Recover generation" }));
    expect(screen.getByRole("heading", { name: /Recover export generation/ })).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Confirm recovery" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason \(required/), "Worker died at the queue layer");
    await user.click(confirm);

    await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith("request-4", "Worker died at the queue layer"));
    expect(await screen.findByText(/back to the queue/)).toBeInTheDocument();
  });

  it("does not offer recovery for a generating request with no failed queue signal", async () => {
    mocks.listRequestsPage.mockResolvedValue({ rows: [HEALTHY_GENERATING_ROW], nextCursor: null });

    render(<DataExportsWorkspace />);

    expect(await screen.findByText("EXP-2026-0005")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recover generation" })).not.toBeInTheDocument();
  });

  it("opens the signed download and offers retry when it fails", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    mocks.signedDownloadUrl.mockResolvedValueOnce("https://storage.example/signed/one");

    render(<DataExportsWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://storage.example/signed/one", "_blank", "noopener,noreferrer"));

    mocks.signedDownloadUrl.mockRejectedValueOnce(new Error("This export has expired. Request a new export."));
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByText(/This export has expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry download/ })).toBeInTheDocument();
  });

  it("shows a retryable error when the request list cannot load", async () => {
    const user = userEvent.setup();
    mocks.listRequestsPage.mockRejectedValueOnce(new Error("The gateway is unreachable."));

    render(<DataExportsWorkspace />);

    expect(await screen.findByText("Export requests could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No export requests")).not.toBeInTheDocument();

    mocks.listRequestsPage.mockResolvedValueOnce({ rows: [], nextCursor: null });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No export requests")).toBeInTheDocument();
  });

  it("states that demo mode cannot generate protected files", async () => {
    mocks.mode.mockReturnValue("demo");

    render(<DataExportsWorkspace />);

    expect(await screen.findByText("Protected exports require the live school database")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request export" })).not.toBeInTheDocument();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("pages the export registry with a keyset cursor instead of loading the whole history", async () => {
    const user = userEvent.setup();
    const olderRow: ExportRequestRow = { ...READY_ROW, requestId: "request-3", reference: "EXP-2026-0003" };
    mocks.listRequestsPage
      .mockResolvedValueOnce({ rows: [READY_ROW], nextCursor: "2026-09-10T00:00:00.000000+00|EXP-2026-0001" })
      .mockResolvedValueOnce({ rows: [olderRow], nextCursor: null });

    render(<DataExportsWorkspace />);

    const loadMore = await screen.findByRole("button", { name: "Load older requests" });
    await user.click(loadMore);

    await waitFor(() => expect(mocks.listRequestsPage).toHaveBeenLastCalledWith("2026-09-10T00:00:00.000000+00|EXP-2026-0001"));
    expect(await screen.findByText("EXP-2026-0003")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load older requests" })).not.toBeInTheDocument();
  });
});
