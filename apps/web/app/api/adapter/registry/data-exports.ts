import { z } from "zod";

import { dataExportCancel, dataExportList, dataExportRequest } from "@/lib/supabase/domain";

import { emptyPayload, operation, publicReference } from "./common";
import type { AdapterModule } from "./types";

export const dataExportModule: AdapterModule = {
  domain: "dataExports",
  operations: [
    operation("dataExports.list", emptyPayload, ({ supabase }) => dataExportList(supabase)),
    operation("dataExports.request", z.object({
      domain: z.enum(["students", "guardians", "guardian_student_links", "enrollments", "admissions", "invoices", "results"]),
      filters: z.record(z.unknown()),
      columns: z.array(z.string().min(1).max(80)).max(100),
      format: z.enum(["csv", "xlsx"]),
      purpose: z.string().min(3).max(500),
      reason: z.string().min(3),
    }), ({ supabase }, payload) => dataExportRequest(supabase, payload)),
    operation("dataExports.cancel", z.object({ requestReference: publicReference, reason: z.string().min(3) }), ({ supabase }, payload) => dataExportCancel(supabase, payload)),
  ],
};
