import "server-only";

/**
 * Formula-safe CSV generation for protected data exports (Phase 7).
 *
 * Every cell value is neutralized against OWASP CSV formula injection
 * (leading =, +, -, @, tab, CR/LF, NUL, and full-width variants) and then
 * RFC 4180-escaped. The XLSX format is intentionally BLOCKED until a vetted
 * writer dependency is approved (plan Phase 7 dependency gate).
 */

import { CSV_FORMULA_TRIGGER_PREFIXES } from "@fass/contracts";

export const EXPORT_MAX_ROWS = 50_000;

export class ExportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportLimitError";
  }
}

/** True when a cell value would be interpreted as a spreadsheet formula. */
export function isFormulaDangerousCell(value: string): boolean {
  return [...CSV_FORMULA_TRIGGER_PREFIXES].some((trigger) => value.startsWith(trigger));
}

/** Neutralize formula triggers, then RFC 4180-escape the cell. */
export function escapeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (isFormulaDangerousCell(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export type ExportRows = {
  columns: readonly string[];
  rows: ReadonlyArray<Record<string, unknown>>;
};

/** Bounded CSV generation. Throws when the row cap is exceeded so the job
 * fails visibly instead of silently truncating an export. */
export function generateCsv(exportRows: ExportRows): string {
  if (exportRows.rows.length > EXPORT_MAX_ROWS) {
    throw new ExportLimitError(`The export exceeds the ${EXPORT_MAX_ROWS}-row limit — narrow the filters.`);
  }
  const lines: string[] = [exportRows.columns.map((column) => escapeCsvCell(column)).join(",")];
  for (const row of exportRows.rows) {
    lines.push(exportRows.columns.map((column) => escapeCsvCell(row[column])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
