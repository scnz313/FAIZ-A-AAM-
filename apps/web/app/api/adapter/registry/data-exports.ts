import { z } from "zod";

import {
  dataExportCancel,
  dataExportList,
  dataExportListCatalog,
  dataExportListPaginated,
  dataExportRecover,
  dataExportRequest,
  dataExportRetry,
  dataHealthCheck,
  dataHealthListSnapshots,
  dataHealthSnapshot,
} from "@/lib/supabase/domain";

import { emptyPayload, operation, publicReference, uuid } from "./common";
import type { AdapterModule } from "./types";

export const dataExportModule: AdapterModule = {
  domain: "dataExports",
  operations: [
    operation("dataExports.list", emptyPayload, ({ supabase }) => dataExportList(supabase)),
    operation("dataExports.listCatalog", emptyPayload, ({ supabase }) => dataExportListCatalog(supabase)),
    operation("dataExports.listPaginated", z.object({
      cursor: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }), ({ supabase }, payload) => dataExportListPaginated(supabase, payload)),
    operation("dataExports.request", z.object({
      domain: z.enum(["students", "guardians", "guardian_student_links", "enrollments", "admissions", "invoices", "results"]),
      filters: z.record(z.unknown()),
      columns: z.array(z.string().min(1).max(80)).max(100),
      format: z.enum(["csv", "xlsx"]),
      purpose: z.string().min(3).max(500),
      reason: z.string().min(3),
    }), ({ supabase }, payload) => dataExportRequest(supabase, payload)),
    operation("dataExports.cancel", z.object({ requestReference: publicReference, reason: z.string().min(3) }), ({ supabase }, payload) => dataExportCancel(supabase, payload)),
    operation("dataExports.retry", z.object({ requestReference: publicReference, reason: z.string().min(3) }), ({ supabase }, payload) => dataExportRetry(supabase, payload)),
    operation("dataExports.recover", z.object({ requestId: uuid, reason: z.string().min(3) }), ({ supabase }, payload) => dataExportRecover(supabase, payload)),
    operation("dataExports.healthCheck", emptyPayload, ({ supabase }) => dataHealthCheck(supabase)),
    operation("dataExports.healthSnapshot", emptyPayload, ({ supabase }) => dataHealthSnapshot(supabase)),
    operation("dataExports.healthSnapshots", z.object({ limit: z.number().int().min(1).max(50).optional() }), ({ supabase }, payload) => dataHealthListSnapshots(supabase, payload.limit)),
  ],
};
