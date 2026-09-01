import "server-only";

/**
 * Bounded CSV parsing for school-data imports (Phase 4).
 *
 * Server-only: the browser never receives raw files or full rosters. Limits
 * are enforced before and during parsing so a hostile file cannot exhaust
 * memory. XLSX parsing is intentionally BLOCKED until a vetted parser
 * dependency with archive-expansion limits is approved (plan Phase 4 gate).
 */

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 10_000;
export const CSV_MAX_COLUMNS = 64;
export const CSV_MAX_CELL_LENGTH = 1_000;

export type ParsedCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
  truncated: boolean;
};

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

function detectBom(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** RFC 4180 state machine with hard limits. Rejects NUL bytes and enforces
 * row/column/cell bounds so a zip-bomb-style CSV cannot exhaust memory. */
export function parseCsv(bytes: Uint8Array): ParsedCsv {
  if (bytes.byteLength > CSV_MAX_BYTES) {
    throw new CsvParseError(`The file exceeds the ${Math.floor(CSV_MAX_BYTES / 1024 / 1024)} MB import limit.`);
  }
  const text = detectBom(bytes);
  if (text.includes("\0")) {
    throw new CsvParseError("The file contains binary data — a CSV export is required.");
  }

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let truncated = false;
  let rowCount = 0;

  const pushField = () => {
    if (field.length > CSV_MAX_CELL_LENGTH) field = field.slice(0, CSV_MAX_CELL_LENGTH);
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    if (record.length > CSV_MAX_COLUMNS) {
      record = record.slice(0, CSV_MAX_COLUMNS);
      truncated = true;
    }
    if (record.some((cell) => cell.trim() !== "")) {
      rowCount += 1;
      if (rowCount > CSV_MAX_ROWS) {
        truncated = true;
        record = [];
        return;
      }
      records.push(record);
    }
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      pushRecord();
      if (truncated) break;
    } else if (char === "\n") {
      pushRecord();
      if (truncated) break;
    } else {
      field += char;
    }
  }
  if (!truncated && (field !== "" || record.length > 0)) pushRecord();

  const [headerRow, ...dataRows] = records;
  if (headerRow === undefined) {
    throw new CsvParseError("The file has no header row — download the template and retry.");
  }
  const headers = headerRow.map((header, position) => (header.trim() === "" ? `column_${position + 1}` : header.trim()));

  return {
    headers,
    rows: dataRows.map((cells) => {
      const row: Record<string, string> = {};
      headers.forEach((header, position) => {
        row[header] = cells[position] ?? "";
      });
      return row;
    }),
    truncated,
  };
}

/**
 * Deterministic normalization for import values: email lowercase, Indian
 * mobile to E.164, whitespace collapsed, relationship labels canonicalized.
 * The canonical implementation lives in `csv-shared.ts`.
 */
export { normalizeImportValue } from "./csv-shared";

/** True when the declared/actual type is an importable spreadsheet format. */
export function isImportableSpreadsheet(mimeType: string, filename: string): boolean {
  const loweredName = filename.toLowerCase();
  if (mimeType === "text/csv" || loweredName.endsWith(".csv")) return true;
  /* XLSX is blocked until a vetted parser with archive-expansion limits is
     approved — the plan's Phase 4 dependency gate. */
  return false;
}
