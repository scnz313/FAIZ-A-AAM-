// @vitest-environment jsdom

/**
 * Imports workspace states. The page must never present a failed load as an
 * honest empty list, must parse the demo file locally, must map detected
 * headers before validation, and must drive issue resolution through the
 * domain service.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBatchesPage: vi.fn(),
  getBatch: vi.fn(),
  listIssuesPage: vi.fn(),
  preview: vi.fn(),
  report: vi.fn(),
  listRowOutcomes: vi.fn(),
  reconcileScan: vi.fn(),
  createBatch: vi.fn(),
  ingestLocalFile: vi.fn(),
  runValidation: vi.fn(),
  finishValidation: vi.fn(),
  resolveIssue: vi.fn(),
  recordMapping: vi.fn(),
  listMappingTemplates: vi.fn(),
  commit: vi.fn(),
  cancel: vi.fn(),
  listResolutions: vi.fn(),
  recordScan: vi.fn(),
  getConfiguration: vi.fn(),
  uploadDocumentFile: vi.fn(),
  mode: vi.fn<() => "demo" | "supabase">(() => "demo"),
}));

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: () => ({ summary: { roles: ["system_administrator"] } }),
}));
vi.mock("@/modules/services/staff-profiles", () => ({ canAnyRole: () => true }));
vi.mock("@/modules/services/adapter-client", () => ({ clientAdapterMode: () => mocks.mode() }));
vi.mock("@/modules/services/school-config", () => ({
  schoolConfigService: { getConfiguration: mocks.getConfiguration },
}));
vi.mock("@/modules/services/document-upload", () => ({ uploadDocumentFile: mocks.uploadDocumentFile }));
vi.mock("@/modules/services/data-import", () => ({
  dataImportService: {
    listBatchesPage: mocks.listBatchesPage,
    getBatch: mocks.getBatch,
    listIssuesPage: mocks.listIssuesPage,
    preview: mocks.preview,
    report: mocks.report,
    listRowOutcomes: mocks.listRowOutcomes,
    reconcileScan: mocks.reconcileScan,
    createBatch: mocks.createBatch,
    ingestLocalFile: mocks.ingestLocalFile,
    runValidation: mocks.runValidation,
    finishValidation: mocks.finishValidation,
    resolveIssue: mocks.resolveIssue,
    recordMapping: mocks.recordMapping,
    listMappingTemplates: mocks.listMappingTemplates,
    commit: mocks.commit,
    cancel: mocks.cancel,
    listResolutions: mocks.listResolutions,
    recordScan: mocks.recordScan,
  },
}));

import DataImportsWorkspace from "@/app/staff/data/imports/page";
import type { ImportBatchDetail, ImportBatchRow, ImportIssueRow } from "@/modules/services/data-import";
import type { DataImportPreview } from "@fass/contracts";

const BATCH_ID = "00000000-0000-4000-8000-000000000901";
const ISSUE_ID = "00000000-0000-4000-8000-000000008001";
const ROW_ID = "00000000-0000-4000-8000-000000007001";

function detail(overrides: Partial<ImportBatchDetail> = {}): ImportBatchDetail {
  return {
    batchId: BATCH_ID,
    reference: "IMP-2026-0001",
    state: "mapping",
    version: 2,
    sourceSystem: "Manual",
    academicYearId: "00000000-0000-4000-8000-000000000602",
    rowCount: 1,
    errorCount: 0,
    warningCount: 0,
    createdAtIso: "2026-09-01T00:00:00.000Z",
    committedAtIso: null,
    hasSourceDocument: false,
    sourceDocumentRef: null,
    scanRowCount: 1,
    scanColumnCount: 3,
    scanHeaders: ["entity", "source_key", "given_name"],
    scanError: null,
    ...overrides,
  };
}

const ISSUE: ImportIssueRow = {
  issueId: ISSUE_ID,
  batchId: BATCH_ID,
  rowId: ROW_ID,
  rowNumber: 4,
  severity: "error",
  code: "missing_required_field",
  field: "givenName",
  message: "A student row needs a given name, a family name, or a display name.",
  resolutionHint: "Map the name columns, then re-run validation.",
  resolvedAtIso: null,
};

const PREVIEW: DataImportPreview = {
  batchId: BATCH_ID,
  createCount: 0,
  updateCount: 0,
  unchangedCount: 0,
  skippedCount: 0,
  errorCount: 1,
  warningCount: 0,
  familyGroupCount: 1,
};

function batchRow(overrides: Partial<ImportBatchRow> = {}): ImportBatchRow {
  return {
    batchId: BATCH_ID,
    reference: "IMP-2026-0001",
    state: "validating",
    version: 3,
    sourceSystem: "Manual",
    academicYearId: "00000000-0000-4000-8000-000000000602",
    rowCount: 1,
    errorCount: 1,
    warningCount: 0,
    createdAtIso: "2026-09-01T00:00:00.000Z",
    committedAtIso: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.mode.mockReturnValue("demo");
  mocks.listBatchesPage.mockResolvedValue({ rows: [], total: 0, nextOffset: null });
  mocks.getConfiguration.mockResolvedValue({
    academicYears: [{ id: "00000000-0000-4000-8000-000000000602", status: "current" }],
  });
  mocks.listMappingTemplates.mockResolvedValue([]);
  mocks.preview.mockResolvedValue(PREVIEW);
  mocks.listIssuesPage.mockResolvedValue({ rows: [], total: 0, nextOffset: null });
  mocks.listRowOutcomes.mockResolvedValue({ rows: [], total: 0, nextOffset: null });
  mocks.reconcileScan.mockResolvedValue({
    state: "uploaded",
    version: 1,
    advanced: false,
    scanStatus: "pending_scan",
    nextStep: "wait",
    stalled: false,
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("imports workspace", () => {
  it("shows a retryable error instead of an empty list when loading fails", async () => {
    mocks.listBatchesPage.mockRejectedValueOnce(new Error("The gateway is unreachable."));
    const user = userEvent.setup();

    render(<DataImportsWorkspace />);

    expect(await screen.findByText("Import batches could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No import batches")).not.toBeInTheDocument();

    mocks.listBatchesPage.mockResolvedValueOnce({ rows: [], total: 0, nextOffset: null });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No import batches")).toBeInTheDocument();
  });

  it("parses the selected demo CSV, maps detected headers, and resolves issues", async () => {
    const user = userEvent.setup();
    mocks.createBatch.mockResolvedValue({ batchId: BATCH_ID, reference: "IMP-2026-0001", state: "uploaded", version: 1 });
    mocks.ingestLocalFile.mockResolvedValue(detail({ state: "mapping" }));
    mocks.recordMapping.mockResolvedValue({ state: "validating", version: 3 });
    mocks.getBatch.mockResolvedValue(detail({ state: "validating", version: 3 }));
    mocks.runValidation.mockResolvedValue({
      state: "needs_resolution",
      version: 4,
      rowCount: 1,
      errorCount: 1,
      warningCount: 0,
      unresolvedErrorCount: 1,
    });
    mocks.listIssuesPage.mockResolvedValue({ rows: [ISSUE], total: 1, nextOffset: null });
    mocks.resolveIssue.mockResolvedValue({
      id: "resolution-1",
      batchId: BATCH_ID,
      rowId: ROW_ID,
      issueId: ISSUE_ID,
      resolution: "skip",
      resolvedValue: null,
      resolvedAtIso: "2026-09-01T00:00:00.000Z",
      note: null,
    });
    mocks.finishValidation.mockResolvedValue({
      state: "ready",
      version: 5,
      rowCount: 1,
      errorCount: 1,
      warningCount: 0,
      unresolvedErrorCount: 0,
    });

    render(<DataImportsWorkspace />);

    const fileInput = document.getElementById("import-file") as HTMLInputElement;
    await user.upload(fileInput, new File(["entity,source_key,given_name\nstudents,STU-1,Aarif\n"], "roster.csv", { type: "text/csv" }));
    await user.click(screen.getByLabelText(/I confirm the school has the authority/));
    await user.click(screen.getByLabelText(/I confirm the file contains no data beyond/));
    await user.click(screen.getByRole("button", { name: "Create batch" }));

    await waitFor(() => expect(mocks.ingestLocalFile).toHaveBeenCalledWith(BATCH_ID, expect.any(File)));
    expect(await screen.findByRole("heading", { name: /Column Mapping/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Target field for entity")).toBeInTheDocument();
    expect(screen.getByLabelText("Target field for given_name")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm mapping and validate" }));

    await waitFor(() => expect(mocks.recordMapping).toHaveBeenCalledWith(expect.objectContaining({
      batchId: BATCH_ID,
      columnMappings: { entity: "entity", source_key: "sourceKey", given_name: "givenName" },
    })));
    await waitFor(() => expect(mocks.runValidation).toHaveBeenCalledWith(BATCH_ID));
    expect(await screen.findByText("missing_required_field")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(mocks.resolveIssue).toHaveBeenCalledWith({
      batchId: BATCH_ID,
      rowId: ROW_ID,
      issueId: ISSUE_ID,
      resolution: "accept",
    }));

    mocks.listIssuesPage.mockResolvedValue({ rows: [{ ...ISSUE, resolvedAtIso: "2026-09-01T00:00:00.000Z" }], total: 1, nextOffset: null });
    await user.click(screen.getByRole("button", { name: "Continue to commit" }));
    await waitFor(() => expect(mocks.finishValidation).toHaveBeenCalledWith(BATCH_ID));
  });

  it("renders per-row outcomes and the retry path when a partially committed batch is reopened", async () => {
    const user = userEvent.setup();
    mocks.listBatchesPage.mockResolvedValue({ rows: [batchRow({ state: "partially_committed", errorCount: 2 })], total: 1, nextOffset: null });
    mocks.getBatch.mockResolvedValue(detail({ state: "partially_committed", rowCount: 4, errorCount: 2 }));
    mocks.report.mockResolvedValue({
      batchRef: "IMP-2026-0001",
      state: "partially_committed",
      rowCount: 4,
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      committedAtIso: "2026-09-01T00:00:00.000Z",
      auditRef: null,
    });
    mocks.listRowOutcomes.mockResolvedValue({
      rows: [
        { rowNumber: 2, entity: "students", sourceKey: "STU-1", status: "committed", outcome: "create" },
        { rowNumber: 3, entity: "enrollments", sourceKey: "STU-1", status: "failed", outcome: "error" },
        { rowNumber: 4, entity: "guardian_student_relationships", sourceKey: "REL-X", status: "failed", outcome: "error" },
        { rowNumber: 5, entity: "students", sourceKey: "STU-2", status: "skipped", outcome: null },
      ],
      total: 4,
      nextOffset: null,
    });

    render(<DataImportsWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Open" }));

    expect(await screen.findByRole("heading", { name: /Import report/i })).toBeInTheDocument();
    expect(await screen.findAllByText("STU-1")).toHaveLength(2);
    expect(screen.getByText("REL-X")).toBeInTheDocument();
    expect(screen.getAllByText("error")).toHaveLength(2);
    expect(screen.getByText("skipped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry commit" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry commit" }));
    expect(await screen.findByLabelText(/Commit reason/)).toBeInTheDocument();
  });

  it("applies a corrected value through the modify resolution", async () => {
    const user = userEvent.setup();
    mocks.listBatchesPage.mockResolvedValue({ rows: [batchRow()], total: 1, nextOffset: null });
    mocks.getBatch.mockResolvedValue(detail({ state: "validating", version: 3 }));
    mocks.listIssuesPage.mockResolvedValue({ rows: [ISSUE], total: 1, nextOffset: null });
    mocks.resolveIssue.mockResolvedValue({
      id: "resolution-2",
      batchId: BATCH_ID,
      rowId: ROW_ID,
      issueId: ISSUE_ID,
      resolution: "modify",
      resolvedValue: { givenName: "Aarif" },
      resolvedAtIso: "2026-09-01T00:00:00.000Z",
      note: "Corrected givenName during review.",
    });

    render(<DataImportsWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Fix" }));
    await user.type(screen.getByLabelText("Corrected value for givenName"), "Aarif");
    await user.click(screen.getByRole("button", { name: "Save fix" }));

    await waitFor(() => expect(mocks.resolveIssue).toHaveBeenCalledWith({
      batchId: BATCH_ID,
      rowId: ROW_ID,
      issueId: ISSUE_ID,
      resolution: "modify",
      resolvedValue: { givenName: "Aarif" },
      note: "Corrected givenName during review.",
    }));
  });

  it("pages large per-row outcome sets instead of rendering them all at once", async () => {
    const user = userEvent.setup();
    mocks.listBatchesPage.mockResolvedValue({ rows: [batchRow({ state: "completed" })], total: 1, nextOffset: null });
    mocks.getBatch.mockResolvedValue(detail({ state: "completed", rowCount: 4000 }));
    mocks.report.mockResolvedValue({
      batchRef: "IMP-2026-0001",
      state: "completed",
      rowCount: 4000,
      createdCount: 4000,
      updatedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      committedAtIso: "2026-09-01T00:00:00.000Z",
      auditRef: null,
    });
    mocks.listRowOutcomes
      .mockResolvedValueOnce({
        rows: [{ rowNumber: 2, entity: "students", sourceKey: "STU-1", status: "committed", outcome: "create" }],
        total: 4000,
        nextOffset: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ rowNumber: 3, entity: "students", sourceKey: "STU-2", status: "committed", outcome: "create" }],
        total: 4000,
        nextOffset: null,
      });

    render(<DataImportsWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Open" }));

    const showMore = await screen.findByRole("button", { name: "Show more outcomes (1 of 4000)" });
    await user.click(showMore);

    await waitFor(() => expect(mocks.listRowOutcomes).toHaveBeenLastCalledWith(BATCH_ID, 1));
    expect(await screen.findByText("STU-2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show more outcomes/ })).not.toBeInTheDocument();
  });

  it("loads further batch and issue pages from the server instead of shipping the full set", async () => {
    const user = userEvent.setup();
    const secondBatch = batchRow({ batchId: "00000000-0000-4000-8000-000000000902", reference: "IMP-2026-0002" });
    mocks.listBatchesPage
      .mockResolvedValueOnce({ rows: [batchRow()], total: 2, nextOffset: 1 })
      .mockResolvedValueOnce({ rows: [secondBatch], total: 2, nextOffset: null });
    mocks.getBatch.mockResolvedValue(detail({ state: "validating", version: 3 }));
    const secondIssue: ImportIssueRow = { ...ISSUE, issueId: "00000000-0000-4000-8000-000000008002", rowNumber: 5 };
    mocks.listIssuesPage
      .mockResolvedValueOnce({ rows: [ISSUE], total: 2, nextOffset: 1 })
      .mockResolvedValueOnce({ rows: [secondIssue], total: 2, nextOffset: null });

    render(<DataImportsWorkspace />);

    await user.click(await screen.findByRole("button", { name: "Show more batches (1 of 2)" }));
    await waitFor(() => expect(mocks.listBatchesPage).toHaveBeenLastCalledWith(1));
    expect(await screen.findByText("IMP-2026-0002")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show more batches/ })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Open" })[0]!);
    await user.click(await screen.findByRole("button", { name: "Show more issues (1 of 2)" }));
    await waitFor(() => expect(mocks.listIssuesPage).toHaveBeenLastCalledWith(BATCH_ID, undefined, 1));
    expect(screen.queryByRole("button", { name: /Show more issues/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("missing_required_field")).toHaveLength(2);
  });

  it("reconciles the scan step and offers a replace path when the scanner rejected the file", async () => {
    const user = userEvent.setup();
    mocks.mode.mockReturnValue("supabase");
    mocks.listBatchesPage.mockResolvedValue({ rows: [batchRow({ state: "uploaded", rowCount: 0 })], total: 1, nextOffset: null });
    mocks.getBatch.mockResolvedValue(detail({ state: "uploaded", rowCount: 0, hasSourceDocument: true, scanRowCount: null }));
    mocks.reconcileScan.mockResolvedValue({
      state: "uploaded",
      version: 2,
      advanced: false,
      scanStatus: "quarantined",
      nextStep: "replace",
      stalled: false,
      error: "The source file did not pass the security scan. Replace it with a corrected CSV or cancel the batch.",
    });

    render(<DataImportsWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Refresh scan status" }));

    await waitFor(() => expect(mocks.reconcileScan).toHaveBeenCalledWith(BATCH_ID));
    expect(await screen.findByRole("button", { name: "Replace source file" })).toBeInTheDocument();
    expect(screen.getByText(/did not pass the security scan/)).toBeInTheDocument();
  });
});
