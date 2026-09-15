import "server-only";

/**
 * Bounded CSV parsing for school-data imports (Phase 4).
 *
 * Server-only boundary: the browser never receives raw files or full rosters
 * in Supabase mode. The pure implementation lives in `csv-core.ts` so the
 * demo adapter can parse the operator's own file locally with identical
 * limits. XLSX parsing is intentionally BLOCKED until a vetted parser
 * dependency with archive-expansion limits is approved (plan Phase 4 gate).
 */

export {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  CSV_MAX_COLUMNS,
  CSV_MAX_CELL_LENGTH,
  CsvParseError,
  parseCsv,
  isImportableSpreadsheet,
  type ParsedCsv,
} from "./csv-core";

export { normalizeImportValue } from "./csv-shared";
