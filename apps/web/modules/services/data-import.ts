/**
 * Data import service (Phase 4) — Administrator-only school-data import.
 *
 * Demo adapter: deterministic in-session batches. Supabase adapter: the
 * app.data_import_* commands through the same-origin gateway. Raw files and
 * full rosters never reach the browser; the service exchanges normalized
 * rows, issues, previews, and reports only.
 */

import {
  dataImportCommitInputSchema,
  type DataImportPreview,
  type DataImportReport,
  type DataImportState,
} from "@fass/contracts";

import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

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

export type ImportIssueRow = {
  issueId: string;
  batchId: string;
  rowNumber: number | null;
  severity: "error" | "warning";
  code: string;
  field: string | null;
  message: string;
  resolutionHint: string | null;
  resolvedAtIso: string | null;
};

export type ParsedSourceRow = {
  rowNumber: number;
  entity: "students" | "guardians" | "guardian_student_relationships" | "enrollments" | "teaching_assignments";
  sourceKey: string;
  normalized: Record<string, unknown>;
  status: "pending" | "mapped" | "valid" | "warning" | "error";
};

const IMPORTS_SESSION_KEY = sessionKey("data-imports");

type DemoImportStore = {
  batches: Array<ImportBatchRow & { rows: ParsedSourceRow[]; issues: ImportIssueRow[] }>;
  counter: number;
};

function loadStore(): DemoImportStore {
  return sessionGet<DemoImportStore>(IMPORTS_SESSION_KEY) ?? { batches: [], counter: 1 };
}

function saveStore(store: DemoImportStore): void {
  sessionSet(IMPORTS_SESSION_KEY, store);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface DataImportService {
  listBatches(): Promise<ImportBatchRow[]>;
  listIssues(batchId: string, severity?: "error" | "warning"): Promise<ImportIssueRow[]>;
  /** Create a batch (Administrator + aal2; authority/privacy confirmed). */
  createBatch(input: {
    academicYearId: string;
    sourceSystem: string;
    sourceDocumentId?: string | null;
    authorityConfirmation: true;
    privacyConfirmation: true;
  }): Promise<{ batchId: string; reference: string; state: string; version: number }>;
  /** Store parsed, normalized rows server-side (browser sends them once). */
  storeRows(batchId: string, rows: ParsedSourceRow[]): Promise<number>;
  preview(batchId: string): Promise<DataImportPreview>;
  commit(input: {
    batchId: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    confirmedCreateCount: number;
    confirmedUpdateCount: number;
  }): Promise<DataImportReport>;
  cancel(input: { batchId: string; expectedVersion: number; reason: string }): Promise<ImportBatchRow>;
}

export const dataImportService: DataImportService = {
  async listBatches() {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<ImportBatchRow[]>("dataImports.listBatches", {});
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Import batches are unavailable.");
      return result.value;
    }
    return clone(loadStore().batches.map(({ rows: _rows, issues: _issues, ...batch }) => batch));
  },

  async listIssues(batchId, severity) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<ImportIssueRow[]>("dataImports.listIssues", {
        batchId,
        ...(severity !== undefined ? { severity } : {}),
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Import issues are unavailable.");
      return result.value;
    }
    const batch = loadStore().batches.find((candidate) => candidate.batchId === batchId);
    return clone((batch?.issues ?? []).filter((issue) => severity === undefined || issue.severity === severity));
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
    const batchId = `00000000-0000-4000-8000-${String(6000 + store.counter).padStart(12, "0")}`;
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
    });
    saveStore(store);
    return { batchId, reference, state: "uploaded", version: 1 };
  },

  async storeRows(batchId, rows) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<{ count: number }>("dataImports.storeRows", { batchId, rows });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Rows could not be stored.");
      return result.value.count;
    }
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    batch.rows = clone(rows);
    batch.rowCount = rows.length;
    saveStore(store);
    return rows.length;
  },

  async preview(batchId) {
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<DataImportPreview>("dataImports.preview", { batchId });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The preview is unavailable.");
      return result.value;
    }
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    return {
      batchId,
      createCount: batch.rows.filter((row) => row.status === "valid").length,
      updateCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      errorCount: batch.rows.filter((row) => row.status === "error").length,
      warningCount: batch.rows.filter((row) => row.status === "warning").length,
      familyGroupCount: new Set(batch.rows.map((row) => String(row.normalized.familyKey ?? row.sourceKey))).size,
    };
  },

  async commit(input) {
    const parsed = dataImportCommitInputSchema.parse(input);
    if (clientAdapterMode() === "supabase") {
      const result = await adapterCall<DataImportReport>("dataImports.commit", {
        batchId: parsed.batchId,
        expectedVersion: parsed.expectedVersion,
        reason: parsed.reason,
        idempotencyKey: parsed.idempotencyKey,
        confirmedCreateCount: parsed.confirmedCreateCount,
        confirmedUpdateCount: parsed.confirmedUpdateCount,
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The commit failed.");
      return result.value;
    }
    const store = loadStore();
    const batch = store.batches.find((candidate) => candidate.batchId === parsed.batchId);
    if (batch === undefined) throw new Error("Import batch not found.");
    if (batch.version !== parsed.expectedVersion) {
      throw new Error(`Import batch version mismatch (expected ${parsed.expectedVersion}, found ${batch.version}).`);
    }
    if (batch.state !== "ready") {
      throw new Error(`Import batch is not ready to commit (state: ${batch.state}).`);
    }
    if (batch.issues.some((issue) => issue.severity === "error" && issue.resolvedAtIso === null)) {
      throw new Error("Unresolved errors remain — resolve them before committing.");
    }
    const committedRows = batch.rows.filter((row) => row.status === "valid" || row.status === "warning");
    const created = committedRows.length;
    batch.rows = batch.rows.map((row) =>
      row.status === "valid" || row.status === "warning" ? { ...row, status: "valid" } : row,
    );
    batch.state = "completed";
    batch.version += 1;
    batch.committedAtIso = new Date().toISOString();
    saveStore(store);
    return {
      batchRef: batch.reference,
      state: batch.state,
      rowCount: batch.rowCount,
      createdCount: created,
      updatedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      committedAtIso: batch.committedAtIso,
      auditRef: null,
    };
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
    const { rows: _rows, issues: _issues, ...row } = batch;
    return clone(row);
  },
};
