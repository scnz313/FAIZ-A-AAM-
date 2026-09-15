/**
 * Data import service (Phase 4 / 11.3 completion) — Administrator-only
 * school-data import.
 *
 * Demo adapter: deterministic in-session batches. The operator's own CSV is
 * parsed locally with the same bounded parser and limits; nothing is
 * uploaded and no remote file operation is simulated. Supabase adapter: the
 * app.data_import_* commands plus the private upload/finalize boundary.
 * Raw files and full rosters never reach the browser in Supabase mode; the
 * service exchanges normalized rows, issues, previews, and reports only.
 */

import {
  dataImportCommitInputSchema,
  type DataImportEntity,
  type DataImportPreview,
  type DataImportReport,
  type DataImportRowStatus,
  type DataImportState,
} from "@fass/contracts";

import { parseCsv } from "@/lib/imports/csv-core";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import { demoGradeSections } from "@/modules/relationships/demo";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";
import { shapeSourceRows, type ImportSourceRow } from "@/modules/imports/source-rows";
import { validateSourceRows } from "@/modules/imports/validation";

export type ImportBatchRow = {
  batchId: string;
  reference: string;
  state: DataImportState;
  version: number;
  sourceSystem: string;
  academicYearId: string;
  rowCount: number;
  errorCount: number;
  warningCount: number;
  createdAtIso: string;
  committedAtIso: string | null;
};

/** Wizard projection for one batch (scan headers/counts, never row payloads). */
export type ImportBatchDetail = ImportBatchRow & {
  hasSourceDocument: boolean;
  sourceDocumentRef: string | null;
  scanRowCount: number | null;
  scanColumnCount: number | null;
  scanHeaders: string[];
  scanError: string | null;
};

export type ImportIssueRow = {
  issueId: string;
  batchId: string;
  /** The uploaded row this issue belongs to; null when the issue is batch-level. */
  rowId: string | null;
  rowNumber: number | null;
  severity: "error" | "warning";
  code: string;
  field: string | null;
  message: string;
  resolutionHint: string | null;
  resolvedAtIso: string | null;
};

export type MappingTemplateRow = {
  id: string;
  reference: string;
  name: string;
  entity: "students" | "guardians" | "guardian_student_relationships" | "enrollments" | "teaching_assignments";
  columnMappings: Record<string, unknown>;
  version: number;
  isActive: boolean;
};

export type ImportResolutionRow = {
  id: string;
  batchId: string;
  rowId: string;
  issueId: string;
  resolution: "accept" | "reject" | "modify" | "skip";
  resolvedValue: Record<string, unknown> | null;
  resolvedAtIso: string;
  note: string | null;
};

/** Server reconciliation of the scan step (Supabase mode only). The server
 *  advances a linked-and-ready batch and reports the document scan state so
 *  the workspace can offer a truthful next step. */
export type ImportScanStatus = {
  state: DataImportState;
  version: number;
  advanced: boolean;
  scanStatus: "pending_scan" | "ready" | "clean" | "failed" | "quarantined" | null;
  nextStep: "none" | "upload" | "wait" | "mapping" | "replace";
  stalled: boolean;
  error: string | null;
};

export type ImportValidationSummary = {
  state: DataImportState;
  version: number;
  rowCount: number;
  errorCount: number;
  warningCount: number;
  unresolvedErrorCount: number;
};

/** One stored row outcome for the Report step (never the roster payload). */
export type ImportRowOutcome = {
  rowNumber: number;
  entity: DataImportEntity;
  sourceKey: string;
  status: DataImportRowStatus;
  outcome: "create" | "update" | "unchanged" | "skipped" | "error" | null;
};

/** One bounded page of stored row outcomes plus the offset of the next page. */
export type ImportRowOutcomePage = {
  rows: ImportRowOutcome[];
  total: number;
  nextOffset: number | null;
};

/** One bounded page of import batches plus the total batch count. */
export type ImportBatchPage = {
  rows: ImportBatchRow[];
  total: number;
  nextOffset: number | null;
};

/** One bounded page of batch issues plus the total issue count. */
export type ImportIssuePage = {
  rows: ImportIssueRow[];
  total: number;
  nextOffset: number | null;
};

export type ParsedSourceRow = ImportSourceRow;

const IMPORTS_SESSION_KEY = sessionKey("data-imports");

type StoredDemoRow = ParsedSourceRow & { rowId: string };

type DemoImportBatch = ImportBatchRow & {
  rows: StoredDemoRow[];
  issues: ImportIssueRow[];
  resolutions: ImportResolutionRow[];
  mapping: Record<string, unknown> | null;
  idempotencyKey: string | null;
  commitResult: DataImportReport | null;
  scanHeaders: string[];
  scanColumnCount: number | null;
  scanError: string | null;
};

type DemoImportStore = {
  batches: DemoImportBatch[];
  counter: number;
  rowCounter: number;
};

function loadStore(): DemoImportStore {
  return sessionGet<DemoImportStore>(IMPORTS_SESSION_KEY) ?? { batches: [], counter: 1, rowCounter: 1 };
}

function saveStore(store: DemoImportStore): void {
  sessionSet(IMPORTS_SESSION_KEY, store);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function demoId(prefix: number, counter: number): string {
  return `00000000-0000-4000-8000-${String(prefix + counter).padStart(12, "0")}`;
}

/** Read a selected file as UTF-8 text. `File.text()` is the browser path; the
 * FileReader fallback keeps jsdom-hosted component tests working. */
async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

function toBatchRow(batch: DemoImportBatch): ImportBatchRow {
  const { rows: _rows, issues: _issues, resolutions: _resolutions, mapping: _mapping, idempotencyKey: _key, commitResult: _result, scanHeaders: _headers, scanColumnCount: _columns, scanError: _error, ...row } = batch;
  return clone(row);
}

function toDetail(batch: DemoImportBatch): ImportBatchDetail {
  return {
    ...toBatchRow(batch),
    hasSourceDocument: true,
    sourceDocumentRef: null,
    scanRowCount: batch.rows.length > 0 ? batch.rows.length : null,
    scanColumnCount: batch.scanColumnCount,
    scanHeaders: [...batch.scanHeaders],
    scanError: batch.scanError,
  };
}

function unresolvedErrorCount(batch: DemoImportBatch): number {
  return batch.issues.filter((issue) => issue.severity === "error" && issue.resolvedAtIso === null).length;
}

function mapServerBatch(row: Record<string, unknown>): ImportBatchDetail {
  const scanHeaders = Array.isArray(row.scanHeaders)
    ? (row.scanHeaders as unknown[]).filter((header): header is string => typeof header === "string")
    : [];
  return {
    batchId: String(row.batchId ?? ""),
    reference: String(row.reference ?? ""),
    state: (row.state ?? "uploaded") as DataImportState,
    version: Number(row.version ?? 1),
    sourceSystem: String(row.sourceSystem ?? ""),
    academicYearId: String(row.academicYearId ?? ""),
    rowCount: Number(row.rowCount ?? 0),
    errorCount: Number(row.errorCount ?? 0),
    warningCount: Number(row.warningCount ?? 0),
    createdAtIso: String(row.createdAtIso ?? new Date().toISOString()),
    committedAtIso: row.committedAtIso === null || row.committedAtIso === undefined ? null : String(row.committedAtIso),
    hasSourceDocument: row.hasSourceDocument === true,
    sourceDocumentRef: typeof row.sourceDocumentRef === "string" ? row.sourceDocumentRef : null,
    scanRowCount: row.scanRowCount === null || row.scanRowCount === undefined ? null : Number(row.scanRowCount),
    scanColumnCount: row.scanColumnCount === null || row.scanColumnCount === undefined ? null : Number(row.scanColumnCount),
    scanHeaders,
    scanError: typeof row.scanError === "string" ? row.scanError : null,
  };
}

function mapServerBatchRow(row: Record<string, unknown>): ImportBatchRow {
  const detail = mapServerBatch(row);
  const {
    hasSourceDocument: _hasSourceDocument,
    sourceDocumentRef: _sourceDocumentRef,
    scanRowCount: _scanRowCount,
    scanColumnCount: _scanColumnCount,
    scanHeaders: _scanHeaders,
    scanError: _scanError,
    ...batch
  } = detail;
  return batch;
}

function mapServerIssueRow(row: Record<string, unknown>): ImportIssueRow {
  return {
    issueId: String(row.issueId ?? ""),
    batchId: String(row.batchId ?? ""),
    rowId: row.rowId === null || row.rowId === undefined ? null : String(row.rowId),
    rowNumber: row.rowNumber === null || row.rowNumber === undefined ? null : Number(row.rowNumber),
    severity: row.severity === "warning" ? "warning" : "error",
    code: String(row.code ?? ""),
    message: String(row.message ?? ""),
    field: row.field === null || row.field === undefined ? null : String(row.field),
    resolutionHint: row.resolutionHint === null || row.resolutionHint === undefined ? null : String(row.resolutionHint),
    resolvedAtIso: row.resolvedAtIso === null || row.resolvedAtIso === undefined ? null : String(row.resolvedAtIso),
  };
}

/** Slices a demo collection into the paged shape the server projection returns. */
function sliceDemoPage<T>(all: T[], offset: number, limit: number): { rows: T[]; total: number; nextOffset: number | null } {
  const start = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
  const size = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 50;
  const rows = all.slice(start, start + size);
  return {
    rows,
    total: all.length,
    nextOffset: start + rows.length < all.length ? start + rows.length : null,
  };
}

/** Reads the `{rows, total, nextOffset}` server projection with typed rows. */
function readServerPage<T>(
  value: Record<string, unknown>,
  mapRow: (row: Record<string, unknown>) => T,
): { rows: T[]; total: number; nextOffset: number | null } {
  const rawRows = Array.isArray(value.rows) ? (value.rows as Array<Record<string, unknown>>) : [];
  const total = Number(value.total);
  return {
    rows: rawRows.map(mapRow),
    total: Number.isFinite(total) ? total : rawRows.length,
    nextOffset: value.nextOffset === null || value.nextOffset === undefined ? null : Number(value.nextOffset),
  };
}

export interface DataImportService {
  /** Bounded page of import batches, newest first (server-paged totals). */
  listBatchesPage(offset?: number, limit?: number): Promise<ImportBatchPage>;
  getBatch(batchId: string): Promise<ImportBatchDetail>;
  /** Bounded page of batch issues; the full set is never shipped at once. */
  listIssuesPage(
    batchId: string,
    severity?: "error" | "warning",
    offset?: number,
    limit?: number,
  ): Promise<ImportIssuePage>;
  /** Create a batch (Administrator + aal2; authority/privacy confirmed). */
  createBatch(input: {
    academicYearId: string;
    sourceSystem: string;
    sourceDocumentId?: string | null;
    authorityConfirmation: true;
    privacyConfirmation: true;
  }): Promise<{ batchId: string; reference: string; state: string; version: number }>;
  /**
   * Demo only: parse the operator's selected CSV locally with the bounded
   * parser and store its normalized rows. In Supabase mode the source is
   * uploaded to the private store and parsed by the provider worker.
   */
  ingestLocalFile(batchId: string, file: File): Promise<ImportBatchDetail>;
  preview(batchId: string): Promise<DataImportPreview>;
  /** Reconcile the scan step (Supabase mode): advance a linked-and-ready
   *  batch and report the document scan state with the next operator step. */
  reconcileScan(batchId: string): Promise<ImportScanStatus>;
  /** Run server-side validation and record row statuses + issues. */
  runValidation(batchId: string): Promise<ImportValidationSummary>;
  /** Move validating/needs_resolution to ready (or back to needs_resolution). */
  finishValidation(batchId: string): Promise<ImportValidationSummary>;
  /** Immutable post-commit summary for a completed batch. */
  report(batchId: string): Promise<DataImportReport>;
  /** Bounded page of stored per-row statuses/outcomes for the report (no
   *  roster payload); `nextOffset` pages the rest for large batches. */
  listRowOutcomes(batchId: string, offset?: number, limit?: number): Promise<ImportRowOutcomePage>;
  commit(input: {
    batchId: string;
    expectedState: DataImportState;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    confirmedCreateCount: number;
    confirmedUpdateCount: number;
  }): Promise<DataImportReport>;
  cancel(input: { batchId: string; expectedVersion: number; reason: string }): Promise<ImportBatchRow>;
  /** Record scan results (provider parity; the worker calls the RPC directly). */
  recordScan(input: {
    batchId: string;
    rowCount: number;
    columnCount: number;
    headers: string[];
    encoding: string;
    error?: string | null;
  }): Promise<{ state: string; version: number }>;
  /** Record column mapping (from template or explicit). */
  recordMapping(input: {
    batchId: string;
    mappingTemplateId?: string | null;
    columnMappings?: Record<string, unknown> | null;
  }): Promise<{ state: string; version: number }>;
  /** List active mapping templates. */
  listMappingTemplates(entity?: string): Promise<MappingTemplateRow[]>;
  /** List resolutions for a batch. */
  listResolutions(batchId: string): Promise<ImportResolutionRow[]>;
  /** Resolve an issue (accept/reject/modify/skip). */
  resolveIssue(input: {
    batchId: string;
    rowId: string;
    issueId: string;
    resolution: "accept" | "reject" | "modify" | "skip";
    resolvedValue?: Record<string, unknown> | null;
    note?: string | null;
  }): Promise<ImportResolutionRow>;
}

export const dataImportService: DataImportService = {
  async listBatchesPage(offset = 0, limit = 50) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<Record<string, unknown>>("dataImports.listBatchesPaginated", { offset, limit });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Import batches are unavailable.");
      return readServerPage(result.value, mapServerBatchRow);
    }
    /* Newest first, matching the server projection's created_at desc order. */
    return sliceDemoPage([...loadStore().batches].reverse().map(toBatchRow), offset, limit);
  },

  async getBatch(batchId) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<Record<string, unknown>>("dataImports.getBatch", { batchId });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The import batch is unavailable.");
      return mapServerBatch(result.value);
    }
    const batch = loadStore().batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    return toDetail(batch);
  },

  async listIssuesPage(batchId, severity, offset = 0, limit = 100) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<Record<string, unknown>>("dataImports.listIssuesPaginated", {
        batchId,
        offset,
        limit,
        ...(severity !== undefined ? { severity } : {}),
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Import issues are unavailable.");
      return readServerPage(result.value, mapServerIssueRow);
    }
    const batch = loadStore().batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    const filtered = (batch.issues ?? []).filter((issue) => severity === undefined || issue.severity === severity);
    return sliceDemoPage(clone(filtered), offset, limit);
  },

  async createBatch(input) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ batchId: string; reference: string; state: string; version: number }>(
        "dataImports.createBatch",
        input,
      );
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The batch could not be created.");
      return result.value;
    }
    const store = loadStore();
    const reference = `IMP-2026-${String(store.counter).padStart(4, "0")}`;
    const batchId = demoId(6000, store.counter);
    store.counter += 1;
    store.batches.push({
      batchId,
      reference,
      state: "uploaded",
      version: 1,
      sourceSystem: input.sourceSystem,
      academicYearId: input.academicYearId,
      rowCount: 0,
      errorCount: 0,
      warningCount: 0,
      createdAtIso: new Date().toISOString(),
      committedAtIso: null,
      rows: [],
      issues: [],
      resolutions: [],
      mapping: null,
      idempotencyKey: null,
      commitResult: null,
      scanHeaders: [],
      scanColumnCount: null,
      scanError: null,
    });
    saveStore(store);
    return { batchId, reference, state: "uploaded", version: 1 };
  },

  async ingestLocalFile(batchId, file) {
    if (clientAdapterMode() === "supabase") {
      throw new Error("Local parsing is only used by the demo adapter.");
    }
    const bytes = new TextEncoder().encode(await readFileText(file));
    const parsed = parseCsv(bytes);
    const shaped = shapeSourceRows(parsed);
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    if (batch.state !== "uploaded") throw new Error(`Import batch is not awaiting a file (state: ${batch.state}).`);
    batch.rows = shaped.map((row) => {
      const stored: StoredDemoRow = { ...row, rowId: demoId(7000, store.rowCounter) };
      store.rowCounter += 1;
      return stored;
    });
    batch.issues = [];
    batch.state = "mapping";
    batch.rowCount = batch.rows.length;
    batch.errorCount = 0;
    batch.warningCount = 0;
    batch.scanHeaders = parsed.headers;
    batch.scanColumnCount = parsed.headers.length;
    batch.scanError = null;
    batch.version += 1;
    saveStore(store);
    return toDetail(batch);
  },

  async preview(batchId) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<DataImportPreview>("dataImports.preview", { batchId });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The preview is unavailable.");
      return result.value;
    }
    const batch = loadStore().batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    return {
      batchId,
      createCount: batch.rows.filter((row) => row.status === "valid" || row.status === "warning" || row.status === "resolved").length,
      updateCount: 0,
      unchangedCount: 0,
      skippedCount: batch.rows.filter((row) => row.status === "skipped").length,
      errorCount: batch.rows.filter((row) => row.status === "error").length,
      warningCount: batch.rows.filter((row) => row.status === "warning").length,
      familyGroupCount: new Set(batch.rows.map((row) => String(row.normalized.familyKey ?? row.sourceKey))).size,
    };
  },

  async reconcileScan(batchId) {
    if (clientAdapterMode() !== "supabase") {
      throw new Error("Scan reconciliation is only used by the live school database.");
    }
    const response = await fetch(`/api/data-imports/${encodeURIComponent(batchId)}/scan-status`, {
      method: "POST",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || body === null) {
      throw new Error(typeof body?.error === "string" ? body.error : "The scan status could not be checked.");
    }
    return {
      state: (body.state ?? "uploaded") as DataImportState,
      version: Number(body.version ?? 1),
      advanced: body.advanced === true,
      scanStatus: (body.scanStatus ?? null) as ImportScanStatus["scanStatus"],
      nextStep: (body.nextStep ?? "none") as ImportScanStatus["nextStep"],
      stalled: body.stalled === true,
      error: typeof body.error === "string" ? body.error : null,
    };
  },

  async runValidation(batchId) {
    if (clientAdapterMode() === "supabase") {
      /* Roster rows stay server-side: the route reads them, validates, and
       * records the issue set; only counts are returned. */
      const response = await fetch(`/api/data-imports/${encodeURIComponent(batchId)}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || body === null) {
        throw new Error(typeof body?.error === "string" ? body.error : "Validation could not be completed.");
      }
      return {
        state: (body.state ?? "needs_resolution") as DataImportState,
        version: Number(body.version ?? 1),
        rowCount: Number(body.rowCount ?? 0),
        errorCount: Number(body.errorCount ?? 0),
        warningCount: Number(body.warningCount ?? 0),
        unresolvedErrorCount: Number(body.unresolvedErrorCount ?? 0),
      };
    }

    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    if (batch.state !== "validating" && batch.state !== "needs_resolution") {
      throw new Error(`Import batch is not ready for validation (state: ${batch.state}).`);
    }
    const validation = validateSourceRows(batch.rows.map((row) => ({
      rowId: row.rowId,
      rowNumber: row.rowNumber,
      entity: row.entity,
      sourceKey: row.sourceKey,
      normalized: row.normalized,
    })), {
      gradeSectionIds: new Set(
        demoGradeSections
          .filter((section) => section.academicYearId === batch.academicYearId)
          .map((section) => section.id),
      ),
    });
    const statusByRow = new Map(validation.rows.map((row) => [row.rowId, row.status]));
    batch.rows = batch.rows.map((row) => ({ ...row, status: statusByRow.get(row.rowId) ?? "valid" }));
    let issueCounter = 1;
    batch.issues = validation.issues.map((issue) => ({
      issueId: demoId(8000, issueCounter++),
      batchId,
      rowId: issue.rowId,
      rowNumber: issue.rowNumber,
      severity: issue.severity,
      code: issue.code,
      field: issue.field,
      message: issue.message,
      resolutionHint: issue.resolutionHint,
      resolvedAtIso: null,
    }));
    batch.resolutions = [];
    batch.errorCount = validation.errorCount;
    batch.warningCount = validation.warningCount;
    batch.state = validation.errorCount > 0 ? "needs_resolution" : "ready";
    batch.version += 1;
    saveStore(store);
    return {
      state: batch.state,
      version: batch.version,
      rowCount: batch.rows.length,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      unresolvedErrorCount: unresolvedErrorCount(batch),
    };
  },

  async finishValidation(batchId) {
    if (clientAdapterMode() === "supabase") {
      const detailResult = await adapterCall<Record<string, unknown>>("dataImports.getBatch", { batchId });
      if (!detailResult.ok) throw new Error(detailResult.errors[0]?.message ?? "The import batch is unavailable.");
      const detail = mapServerBatch(detailResult.value);
      const result = await adapterCall<Record<string, unknown>>("dataImports.finishValidation", {
        batchId,
        expectedVersion: detail.version,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Validation could not be finalised.");
      return {
        state: (result.value.state ?? detail.state) as DataImportState,
        version: Number(result.value.version ?? detail.version),
        rowCount: detail.rowCount,
        errorCount: detail.errorCount,
        warningCount: Number(result.value.warningCount ?? detail.warningCount),
        unresolvedErrorCount: Number(result.value.unresolvedErrorCount ?? 0),
      };
    }
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    if (batch.state !== "validating" && batch.state !== "needs_resolution" && batch.state !== "ready") {
      throw new Error(`Validation cannot be finished from state ${batch.state}.`);
    }
    const unresolved = unresolvedErrorCount(batch);
    const target: DataImportState = unresolved > 0 ? "needs_resolution" : "ready";
    if (batch.state !== target) {
      batch.state = target;
      batch.version += 1;
      saveStore(store);
    }
    return {
      state: batch.state,
      version: batch.version,
      rowCount: batch.rows.length,
      errorCount: batch.errorCount,
      warningCount: batch.warningCount,
      unresolvedErrorCount: unresolved,
    };
  },

  async report(batchId) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<DataImportReport>("dataImports.report", { batchId });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The import report is unavailable.");
      return result.value;
    }
    const batch = loadStore().batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    if (batch.commitResult !== null) return clone(batch.commitResult);
    return {
      batchRef: batch.reference,
      state: batch.state,
      rowCount: batch.rowCount,
      createdCount: batch.rows.filter((row) => row.status === "committed").length,
      updatedCount: 0,
      unchangedCount: 0,
      skippedCount: batch.rows.filter((row) => row.status === "skipped").length,
      errorCount: batch.rows.filter((row) => row.status === "failed" || row.status === "error").length,
      committedAtIso: batch.committedAtIso,
      auditRef: null,
    };
  },

  async listRowOutcomes(batchId, offset = 0, limit = 500) {
    if (clientAdapterMode() === "supabase") {
      const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      const response = await fetch(`/api/data-imports/${encodeURIComponent(batchId)}/row-outcomes?${query.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as { rows?: unknown; total?: unknown; nextOffset?: unknown; error?: unknown } | null;
      if (!response.ok || body === null || !Array.isArray(body.rows)) {
        throw new Error(typeof body?.error === "string" ? body.error : "The per-row import outcomes could not be loaded.");
      }
      return {
        rows: (body.rows as Array<Record<string, unknown>>).map((row) => ({
          rowNumber: Number(row.rowNumber ?? 0),
          entity: String(row.entity ?? "students") as DataImportEntity,
          sourceKey: String(row.sourceKey ?? ""),
          status: String(row.status ?? "pending") as DataImportRowStatus,
          outcome: (row.outcome ?? null) as ImportRowOutcome["outcome"],
        })),
        total: Number(body.total ?? body.rows.length),
        nextOffset: body.nextOffset === null || body.nextOffset === undefined ? null : Number(body.nextOffset),
      };
    }
    const batch = loadStore().batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    const mapped = batch.rows.map((row) => ({
      rowNumber: row.rowNumber,
      entity: row.entity,
      sourceKey: row.sourceKey,
      status: row.status,
      outcome: (row.status === "committed"
        ? "create"
        : row.status === "skipped"
          ? "skipped"
          : row.status === "failed" || row.status === "error"
            ? "error"
            : null) as ImportRowOutcome["outcome"],
    }));
    const page = mapped.slice(offset, offset + limit);
    return {
      rows: page,
      total: mapped.length,
      nextOffset: offset + page.length < mapped.length ? offset + page.length : null,
    };
  },

  async commit(input) {
    const parsed = dataImportCommitInputSchema.parse(input);
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<DataImportReport>("dataImports.commit", {
        batchId: parsed.batchId,
        expectedState: parsed.expectedState,
        expectedVersion: parsed.expectedVersion,
        reason: parsed.reason,
        idempotencyKey: parsed.idempotencyKey,
        confirmedCreateCount: parsed.confirmedCreateCount,
        confirmedUpdateCount: parsed.confirmedUpdateCount,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The commit failed.");
      return { ...result.value, state: result.value.state as DataImportReport["state"] };
    }
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === parsed.batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    if (batch.idempotencyKey === parsed.idempotencyKey && batch.commitResult !== null) return clone(batch.commitResult);
    if (batch.version !== parsed.expectedVersion) {
      throw new Error(`Import batch version mismatch (expected ${parsed.expectedVersion}, found ${batch.version}).`);
    }
    if (batch.state !== parsed.expectedState) {
      throw new Error(`Import batch state changed (expected ${parsed.expectedState}, found ${batch.state}).`);
    }
    if (batch.state !== "ready" && batch.state !== "partially_committed") {
      throw new Error(`Import batch is not ready to commit (state: ${batch.state}).`);
    }
    if (unresolvedErrorCount(batch) > 0) {
      throw new Error("Unresolved errors remain — resolve them before committing.");
    }
    const committedRows = batch.rows.filter((row) => row.status === "valid" || row.status === "warning" || row.status === "resolved");
    if (parsed.confirmedCreateCount !== committedRows.length) {
      throw new Error(`Confirmed create count (${parsed.confirmedCreateCount}) does not match the current preview (${committedRows.length}).`);
    }
    const committedIds = new Set(committedRows.map((row) => row.rowId));
    batch.rows = batch.rows.map((row) => committedIds.has(row.rowId) ? { ...row, status: "committed" } : row);
    batch.state = "completed";
    batch.version += 1;
    batch.committedAtIso = new Date().toISOString();
    batch.idempotencyKey = parsed.idempotencyKey;
    const result: DataImportReport = {
      batchRef: batch.reference,
      state: "completed",
      rowCount: batch.rowCount,
      createdCount: committedRows.length,
      updatedCount: 0,
      unchangedCount: 0,
      skippedCount: batch.rows.filter((row) => row.status === "skipped").length,
      errorCount: 0,
      committedAtIso: batch.committedAtIso,
      auditRef: null,
    };
    batch.commitResult = result;
    saveStore(store);
    return clone(result);
  },

  async cancel(input) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<ImportBatchRow>("dataImports.cancel", input);
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The cancellation failed.");
      return result.value;
    }
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === input.batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    if (batch.version !== input.expectedVersion) {
      throw new Error(`Import batch version mismatch (expected ${input.expectedVersion}, found ${batch.version}).`);
    }
    if (batch.state === "completed" || batch.state === "cancelled") {
      throw new Error("Import batch is already closed.");
    }
    batch.state = "cancelled";
    batch.version += 1;
    saveStore(store);
    return toBatchRow(batch);
  },

  async recordScan(input) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ state: string; version: number }>("dataImports.recordScan", input);
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The scan could not be recorded.");
      return result.value;
    }
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === input.batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    batch.state = input.error ? "uploaded" : "mapping";
    batch.version += 1;
    saveStore(store);
    return { state: batch.state, version: batch.version };
  },

  async recordMapping(input) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ state: string; version: number }>("dataImports.recordMapping", input);
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The mapping could not be recorded.");
      return result.value;
    }
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === input.batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    if (batch.state !== "mapping") throw new Error(`A mapping can only be recorded while mapping (state: ${batch.state}).`);
    if ((input.mappingTemplateId ?? null) === null && (input.columnMappings ?? null) === null) {
      throw new Error("Provide a mapping template or explicit column mappings.");
    }
    batch.mapping = input.columnMappings ?? {};
    batch.state = "validating";
    batch.version += 1;
    saveStore(store);
    return { state: batch.state, version: batch.version };
  },

  async listMappingTemplates(entity) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<MappingTemplateRow[]>("dataImports.listMappingTemplates", { entity });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Mapping templates are unavailable.");
      return result.value;
    }
    return [];
  },

  async listResolutions(batchId) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<ImportResolutionRow[]>("dataImports.listResolutions", { batchId });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Resolutions are unavailable.");
      return result.value;
    }
    return clone(loadStore().batches.find((candidate) => candidate.batchId === batchId)?.resolutions ?? []);
  },

  async resolveIssue(input) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<ImportResolutionRow>("dataImports.resolveIssue", input);
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The issue could not be resolved.");
      return result.value;
    }
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === input.batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    if (batch.state !== "validating" && batch.state !== "needs_resolution") {
      throw new Error(`Issues can only be resolved after validation (state: ${batch.state}).`);
    }
    const issue = batch.issues.find((candidate) => candidate.issueId === input.issueId && candidate.rowId === input.rowId);
    if (issue === undefined) throw new Error("Import issue not found for this row.");
    const existing = batch.resolutions.find((candidate) => candidate.issueId === issue.issueId);
    if (issue.resolvedAtIso === null) {
      const resolvedAtIso = new Date().toISOString();
      issue.resolvedAtIso = resolvedAtIso;
      const resolution: ImportResolutionRow = {
        id: `resolution-${issue.issueId}`,
        batchId: input.batchId,
        rowId: input.rowId,
        issueId: input.issueId,
        resolution: input.resolution,
        resolvedValue: input.resolvedValue ?? null,
        resolvedAtIso,
        note: input.note ?? null,
      };
      batch.resolutions.push(resolution);
      const row = batch.rows.find((candidate) => candidate.rowId === input.rowId);
      if (row !== undefined) {
        if (input.resolution === "skip" || input.resolution === "reject") row.status = "skipped";
        else if (input.resolution === "modify") {
          row.normalized = { ...row.normalized, ...(input.resolvedValue ?? {}) };
          row.status = "resolved";
        } else {
          const otherWarning = batch.issues.some((candidate) => candidate.rowId === input.rowId && candidate.severity === "warning" && candidate.resolvedAtIso === null && candidate.issueId !== issue.issueId);
          row.status = otherWarning ? "warning" : "valid";
        }
      }
      saveStore(store);
      return clone(resolution);
    }
    if (existing === undefined) throw new Error("The existing resolution could not be read.");
    return clone(existing);
  },
};
