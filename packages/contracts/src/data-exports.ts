/**
 * Purpose-bound protected data exports (three-portal consolidation, Phase 7).
 *
 * Exports are Administrator-only, filtered, column-allowlisted, formula-safe,
 * private, expiring, and audited. Raw database dumps and arbitrary filter or
 * column expressions are never accepted or generated.
 */

import { z } from "zod";

import { opaqueIdSchema, publicReferenceSchema } from "./relationships";

export const DATA_EXPORT_DOMAINS = [
  "students",
  "guardians",
  "guardian_student_links",
  "enrollments",
  "admissions",
  "invoices",
  "results",
] as const;
export const dataExportDomainSchema = z.enum(DATA_EXPORT_DOMAINS);
export type DataExportDomain = z.infer<typeof dataExportDomainSchema>;

export const DATA_EXPORT_STATES = [
  "requested",
  "generating",
  "ready",
  "failed",
  "expired",
  "cancelled",
] as const;
export const dataExportStateSchema = z.enum(DATA_EXPORT_STATES);
export type DataExportState = z.infer<typeof dataExportStateSchema>;

export const DATA_EXPORT_FORMATS = ["csv", "xlsx"] as const;
export const dataExportFormatSchema = z.enum(DATA_EXPORT_FORMATS);
export type DataExportFormat = z.infer<typeof dataExportFormatSchema>;

/** Allowlisted, purpose-stated export request (Administrator + AAL2 only). */
export const dataExportRequestInputSchema = z.object({
  domain: dataExportDomainSchema,
  /** Allowlisted filter fields only; never a raw expression. */
  filters: z.record(z.string().min(1).max(200)),
  /** Allowlisted column selection; defaults apply when omitted. */
  columns: z.array(z.string().min(1).max(80)).max(100),
  format: dataExportFormatSchema,
  purpose: z.string().min(3).max(500),
  reason: z.string().min(3),
});
export type DataExportRequestInput = z.infer<typeof dataExportRequestInputSchema>;

export const dataExportRequestSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  domain: dataExportDomainSchema,
  state: z.enum(["requested", "generating", "ready", "failed", "expired", "cancelled"]),
  format: z.enum(["csv", "xlsx"]),
  /** Allowlisted filters/columns snapshot; immutable after creation. */
  filters: z.record(z.unknown()),
  columns: z.array(z.string().min(1)),
  requestedByAccountId: opaqueIdSchema,
  reason: z.string().min(1),
  rowCount: z.number().int().nonnegative().nullable(),
  /** Private generated artifact reference; never a raw dump. */
  documentRef: publicReferenceSchema.nullable(),
  expiresAtIso: z.string().datetime().nullable(),
  version: z.number().int().positive(),
  createdAtIso: z.string().datetime(),
  completedAtIso: z.string().datetime().nullable(),
});
export type DataExportRequest = z.infer<typeof dataExportRequestSchema>;

/** Formula-dangerous leading characters per OWASP CSV injection guidance. */
export const CSV_FORMULA_TRIGGER_PREFIXES = [
  "=",
  "+",
  "-",
  "@",
  "\t",
  "\r",
  "\n",
  "\0",
  "＝",
  "＋",
  "－",
  "＠",
] as const;

/** True when a cell value would be interpreted as a spreadsheet formula. */
export function isFormulaDangerousCell(value: string): boolean {
  return [...CSV_FORMULA_TRIGGER_PREFIXES].some((trigger) => value.startsWith(trigger));
}
