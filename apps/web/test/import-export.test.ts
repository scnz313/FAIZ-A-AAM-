import { describe, expect, it } from "vitest";

import { CsvParseError, isImportableSpreadsheet, normalizeImportValue, parseCsv } from "@/lib/imports/csv-parser";
import { escapeCsvCell, generateCsv, isFormulaDangerousCell } from "@/lib/exports/csv-generator";

describe("bounded CSV parser", () => {
  it("parses a simple roster with quoted cells", () => {
    const csv = 'student_key,given_name,family_name,contact\r\nSTU-1,"Wani, Aarif",Hussain,+919000000000\r\n';
    const parsed = parseCsv(new TextEncoder().encode(csv));
    expect(parsed.headers).toEqual(["student_key", "given_name", "family_name", "contact"]);
    expect(parsed.rows[0]?.given_name).toBe("Wani, Aarif");
    expect(parsed.rows[0]?.contact).toBe("+919000000000");
  });

  it("rejects binary content and empty files", () => {
    expect(() => parseCsv(new TextEncoder().encode("a\0b"))).toThrow(CsvParseError);
    expect(() => parseCsv(new TextEncoder().encode(""))).toThrow(CsvParseError);
  });

  it("rejects oversized input instead of silently truncating school data", () => {
    const rows = Array.from({ length: 12_000 }, (_, index) => `key-${index},name\r\n`).join("");
    expect(() => parseCsv(new TextEncoder().encode(`student_key,given_name\r\n${rows}`))).toThrow(/row limit/i);
  });

  it("rejects blank or duplicate headers and unclosed quotes", () => {
    expect(() => parseCsv(new TextEncoder().encode("name,,grade\nA,,8"))).toThrow(/blank header/i);
    expect(() => parseCsv(new TextEncoder().encode("name,Name\nA,B"))).toThrow(/duplicate headers/i);
    expect(() => parseCsv(new TextEncoder().encode('name,grade\n"A,8'))).toThrow(/unclosed quoted field/i);
  });

  it("normalizes Indian mobile numbers to E.164 deterministically", () => {
    expect(normalizeImportValue("phone", "9000000000")).toBe("+919000000000");
    expect(normalizeImportValue("phone", "09000000000")).toBe("+919000000000");
    expect(normalizeImportValue("phone", "+91 90000 00000")).toBe("+919000000000");
    expect(normalizeImportValue("email", "  Parent@Example.COM ")).toBe("parent@example.com");
    expect(normalizeImportValue("name", "  Aarif   Hussain ")).toBe("Aarif Hussain");
    expect(normalizeImportValue("relationship", "father")).toBe("Father");
  });

  it("accepts only CSV as an importable spreadsheet", () => {
    expect(isImportableSpreadsheet("text/csv", "roster.csv")).toBe(true);
    expect(isImportableSpreadsheet("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "roster.xlsx")).toBe(false);
    expect(isImportableSpreadsheet("application/vnd.ms-excel", "roster.xls")).toBe(false);
  });
});

describe("formula-safe CSV generator", () => {
  it("flags every OWASP formula-triggering leading character", () => {
    for (const trigger of ["=", "+", "-", "@", "\t", "\r", "\n", "\0", "＝", "＋", "－", "＠"]) {
      expect(isFormulaDangerousCell(`${trigger}payload`)).toBe(true);
    }
    expect(isFormulaDangerousCell("safe value")).toBe(false);
  });

  it("neutralizes and escapes dangerous cells", () => {
    /* Neutralize first, then RFC 4180-quote when the value contains quotes. */
    expect(escapeCsvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(escapeCsvCell("+1+2")).toBe("'+1+2");
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("has,comma")).toBe('"has,comma"');
    expect(escapeCsvCell('has"quote')).toBe('"has""quote"');
    expect(escapeCsvCell(null)).toBe("");
  });

  it("generates RFC 4180 output with CRLF line endings", () => {
    const csv = generateCsv({
      columns: ["reference", "display_name"],
      rows: [{ reference: "STU-1", display_name: "Aarif, Hussain" }],
    });
    expect(csv).toBe("reference,display_name\r\nSTU-1,\"Aarif, Hussain\"\r\n");
  });

  it("rejects exports beyond the row cap instead of truncating", () => {
    const rows = Array.from({ length: 50_001 }, (_, index) => ({ reference: `STU-${index}` }));
    expect(() => generateCsv({ columns: ["reference"], rows })).toThrow(/row limit/);
  });
});
