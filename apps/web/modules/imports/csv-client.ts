/**
 * Browser-side import helpers (Phase 4). The browser never parses full
 * rosters: it validates the file type/size locally for fast feedback and the
 * server boundary (`lib/imports/csv-parser.ts`) does the authoritative,
 * bounded parse. These constants mirror the server limits.
 */

export const CSV_MAX_BYTES = 5 * 1024 * 1024;

/** True when the declared/actual type is an importable spreadsheet format. */
export function isImportableSpreadsheet(mimeType: string, filename: string): boolean {
  const loweredName = filename.toLowerCase();
  if (mimeType === "text/csv" || loweredName.endsWith(".csv")) return true;
  /* XLSX is blocked until a vetted parser with archive-expansion limits is
     approved — the plan's Phase 4 dependency gate. */
  return false;
}

/** Fast local pre-check before upload; the server re-validates authoritatively. */
export function validateImportFile(file: { type: string; name: string; size: number }): string | null {
  if (!isImportableSpreadsheet(file.type, file.name)) {
    return "Only CSV exports are accepted. XLSX parsing is not enabled in this environment.";
  }
  if (file.size <= 0) return "The file is empty.";
  if (file.size > CSV_MAX_BYTES) {
    return `The file exceeds the ${Math.floor(CSV_MAX_BYTES / 1024 / 1024)} MB import limit.`;
  }
  return null;
}

export { normalizeImportValue } from "@/lib/imports/csv-shared";
