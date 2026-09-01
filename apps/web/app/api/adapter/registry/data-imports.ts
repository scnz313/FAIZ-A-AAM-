import { z } from "zod";

import {
  dataImportCancel,
  dataImportCommit,
  dataImportCreateBatch,
  dataImportListBatches,
  dataImportListIssues,
  dataImportPreview,
  dataImportSetState,
  dataImportStoreRows,
} from "@/lib/supabase/domain";

import { emptyPayload, jsonObject, operation, uuid } from "./common";
import type { AdapterModule } from "./types";

const batchTarget = z.object({ batchId: uuid });

export const dataImportModule: AdapterModule = {
  domain: "dataImports",
  operations: [
    operation("dataImports.listBatches", emptyPayload, ({ supabase }) => dataImportListBatches(supabase)),
    operation("dataImports.listIssues", batchTarget.extend({ severity: z.enum(["error", "warning"]).optional() }), ({ supabase }, payload) => dataImportListIssues(supabase, payload.batchId, payload.severity)),
    operation("dataImports.createBatch", z.object({
      academicYearId: uuid,
      sourceSystem: z.string().min(1),
      sourceDocumentId: uuid.nullable().optional(),
      authorityConfirmation: z.literal(true),
      privacyConfirmation: z.literal(true),
    }), ({ supabase }, payload) => dataImportCreateBatch(supabase, payload)),
    operation("dataImports.setState", batchTarget.extend({ newState: z.string().min(1), expectedVersion: z.number().int().positive() }), ({ supabase }, payload) => dataImportSetState(supabase, payload)),
    operation("dataImports.storeRows", batchTarget.extend({ rows: z.array(jsonObject) }), ({ supabase }, payload) => dataImportStoreRows(supabase, payload.batchId, payload.rows as never)),
    operation("dataImports.preview", batchTarget, ({ supabase }, payload) => dataImportPreview(supabase, payload.batchId)),
    operation("dataImports.commit", batchTarget.extend({
      expectedVersion: z.number().int().positive(),
      reason: z.string().min(3),
      idempotencyKey: z.string().min(8),
      confirmedCreateCount: z.number().int().nonnegative(),
      confirmedUpdateCount: z.number().int().nonnegative(),
    }), ({ supabase }, payload) => dataImportCommit(supabase, payload)),
    operation("dataImports.cancel", batchTarget.extend({ expectedVersion: z.number().int().positive(), reason: z.string().min(3) }), ({ supabase }, payload) => dataImportCancel(supabase, payload)),
  ],
};
