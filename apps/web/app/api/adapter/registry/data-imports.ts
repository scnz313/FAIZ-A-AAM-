import { z } from "zod";

import {
  dataImportApplyValidation,
  dataImportCancel,
  dataImportCommit,
  dataImportCreateBatch,
  dataImportFinishValidation,
  dataImportGetBatch,
  dataImportListBatchesPaginated,
  dataImportListIssuesPaginated,
  dataImportListMappingTemplates,
  dataImportListResolutions,
  dataImportPreview,
  dataImportRecordMapping,
  dataImportRecordScan,
  dataImportReport,
  dataImportResolveIssue,
  dataImportSetState,
} from "@/lib/supabase/domain";

import { emptyPayload, jsonObject, operation, uuid } from "./common";
import type { AdapterModule } from "./types";

const batchTarget = z.object({ batchId: uuid });

export const dataImportModule: AdapterModule = {
  domain: "dataImports",
  operations: [
    operation("dataImports.listBatchesPaginated", z.object({
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    }), ({ supabase }, payload) => dataImportListBatchesPaginated(supabase, payload)),
    operation("dataImports.getBatch", batchTarget, ({ supabase }, payload) => dataImportGetBatch(supabase, payload.batchId)),
    operation("dataImports.listIssuesPaginated", batchTarget.extend({
      severity: z.enum(["error", "warning"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    }), ({ supabase }, payload) => dataImportListIssuesPaginated(supabase, payload)),
    operation("dataImports.createBatch", z.object({
      academicYearId: uuid,
      sourceSystem: z.string().min(1),
      sourceDocumentId: uuid.nullable().optional(),
      authorityConfirmation: z.literal(true),
      privacyConfirmation: z.literal(true),
    }), ({ supabase }, payload) => dataImportCreateBatch(supabase, payload)),
    operation("dataImports.setState", batchTarget.extend({ newState: z.string().min(1), expectedVersion: z.number().int().positive() }), ({ supabase }, payload) => dataImportSetState(supabase, payload)),
    operation("dataImports.preview", batchTarget, ({ supabase }, payload) => dataImportPreview(supabase, payload.batchId)),
    operation("dataImports.report", batchTarget, ({ supabase }, payload) => dataImportReport(supabase, payload.batchId)),
    operation("dataImports.commit", batchTarget.extend({
      expectedState: z.string().optional(),
      expectedVersion: z.number().int().positive(),
      reason: z.string().min(3),
      idempotencyKey: z.string().min(8),
      confirmedCreateCount: z.number().int().nonnegative(),
      confirmedUpdateCount: z.number().int().nonnegative(),
    }), ({ supabase }, payload) => dataImportCommit(supabase, payload)),
    operation("dataImports.cancel", batchTarget.extend({ expectedVersion: z.number().int().positive(), reason: z.string().min(3) }), ({ supabase }, payload) => dataImportCancel(supabase, payload)),
    operation("dataImports.recordScan", batchTarget.extend({
      rowCount: z.number().int().nonnegative(),
      columnCount: z.number().int().nonnegative(),
      headers: z.array(z.string()),
      encoding: z.string().min(1),
      error: z.string().nullable().optional(),
    }), ({ supabase }, payload) => dataImportRecordScan(supabase, payload)),
    operation("dataImports.applyValidation", batchTarget.extend({
      rows: z.array(z.record(z.unknown())).max(10_000),
      issues: z.array(z.record(z.unknown())).max(50_000),
    }), ({ supabase }, payload) => dataImportApplyValidation(supabase, payload)),
    operation("dataImports.finishValidation", batchTarget.extend({
      expectedVersion: z.number().int().positive(),
    }), ({ supabase }, payload) => dataImportFinishValidation(supabase, payload)),
    operation("dataImports.recordMapping", batchTarget.extend({
      mappingTemplateId: uuid.nullable().optional(),
      columnMappings: jsonObject.nullable().optional(),
    }), ({ supabase }, payload) => dataImportRecordMapping(supabase, payload)),
    operation("dataImports.listMappingTemplates", z.object({ entity: z.string().optional() }), ({ supabase }, payload) => dataImportListMappingTemplates(supabase, payload.entity)),
    operation("dataImports.listResolutions", batchTarget, ({ supabase }, payload) => dataImportListResolutions(supabase, payload.batchId)),
    operation("dataImports.resolveIssue", batchTarget.extend({
      rowId: uuid,
      issueId: uuid,
      resolution: z.enum(["accept", "reject", "modify", "skip"]),
      resolvedValue: jsonObject.nullable().optional(),
      note: z.string().nullable().optional(),
    }), ({ supabase }, payload) => dataImportResolveIssue(supabase, payload)),
  ],
};
