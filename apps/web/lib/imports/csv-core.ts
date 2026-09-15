/**
 * Bounded CSV parsing core (browser + server).
 *
 * The authoritative server parse lives in `lib/imports/csv-parser.ts`;
 * this module holds the pure implementation so the demo adapter can parse the
 * operator's own file locally with the same limits, and the server can wrap
 * it behind the `server-only` boundary. Limits are enforced before and during
 * parsing so a hostile file cannot exhaust memory. XLSX parsing is
 * intentionally BLOCKED until a vetted parser dependency with
 * archive-expansion limits is approved (plan Phase 4 gate).
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
  let rowCount = 0;

  const pushField = () => {
    if (field.length > CSV_MAX_CELL_LENGTH) {
      throw new CsvParseError(`A cell exceeds the ${CSV_MAX_CELL_LENGTH} character limit.`);
    }
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    if (record.length > CSV_MAX_COLUMNS) {
      throw new CsvParseError(`A row exceeds the ${CSV_MAX_COLUMNS} column limit.`);
    }
    if (record.some((cell) => cell.trim() !== "")) {
      rowCount += 1;
      if (rowCount > CSV_MAX_ROWS) {
        throw new CsvParseError(`The file exceeds the ${CSV_MAX_ROWS} row limit.`);
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
    } else if (char === "\n") {
      pushRecord();
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new CsvParseError("The file contains an unclosed quoted field.");
  if (field !== "" || record.length > 0) pushRecord();

  const [headerRow, ...dataRows] = records;
  if (headerRow === undefined) {
    throw new CsvParseError("The file has no header row — download the template and retry.");
  }
  const headers = headerRow.map((header) => header.trim());
  if (headers.some((header) => header === "")) throw new CsvParseError("The CSV contains a blank header.");
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new CsvParseError("The CSV contains duplicate headers.");
  }

  return {
    headers,
    rows: dataRows.map((cells) => {
      const row: Record<string, string> = {};
      headers.forEach((header, position) => {
        row[header] = cells[position] ?? "";
      });
      return row;
    }),
    truncated: false,
  };
}

/** True when the declared/actual type is an importable spreadsheet format. */
export function isImportableSpreadsheet(mimeType: string, filename: string): boolean {
  const loweredName = filename.toLowerCase();
  if (mimeType === "text/csv" || loweredName.endsWith(".csv")) return true;
  /* XLSX is blocked until a vetted parser with archive-expansion limits is
     approved — the plan's Phase 4 dependency gate. */
  return false;
}
