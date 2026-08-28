/**
 * Dependency-free PDF writer (plan.md §6 Documents / §10 provider adapters).
 *
 * Produces valid single/multi-page PDF 1.4 documents with the standard
 * Helvetica family — no external runtime dependency, deterministic output,
 * reproducible from stored records. Text layout is intentionally simple
 * (headings, key-value rows, table lines, rules) to match the institutional
 * document style: status and readability over decoration.
 *
 * WinAnsi limitation: the standard fonts carry no ₹ glyph, so money is
 * rendered as "Rs." by the templates. Non-Latin-1 characters are folded to
 * close ASCII equivalents so output never corrupts.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 56;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN_X;

type FontName = "Helvetica" | "Helvetica-Bold";

const CHAR_FOLDS: Record<string, string> = {
  "₹": "Rs.",
  "—": "-",
  "–": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "•": "-",
  "…": "...",
};

function foldText(text: string): string {
  let out = "";
  for (const char of text) {
    const fold = CHAR_FOLDS[char];
    out += fold ?? (char.charCodeAt(0) <= 0xff ? char : "?");
  }
  return out;
}

function escapePdfText(text: string): string {
  return foldText(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Approximate Helvetica advance width — good enough for right alignment. */
function textWidth(text: string, size: number, bold: boolean): number {
  return foldText(text).length * size * (bold ? 0.55 : 0.5);
}

type TextOp = { x: number; y: number; text: string; size: number; font: FontName };

class PageBuilder {
  readonly ops: TextOp[] = [];
  private cursorY = PAGE_HEIGHT - MARGIN_TOP;

  get remaining(): number {
    return this.cursorY - MARGIN_BOTTOM;
  }

  text(input: { text: string; size?: number; bold?: boolean; x?: number; rightAlign?: boolean; gapAfter?: number }): void {
    const size = input.size ?? 10;
    const font: FontName = input.bold ? "Helvetica-Bold" : "Helvetica";
    const x =
      input.x ??
      (input.rightAlign === true ? CONTENT_RIGHT - textWidth(input.text, size, input.bold === true) : MARGIN_X);
    this.ops.push({ x, y: this.cursorY, text: escapePdfText(input.text), size, font });
    this.cursorY -= (input.gapAfter ?? size) + 4;
  }

  rule(): void {
    this.ops.push({ x: MARGIN_X, y: this.cursorY, text: "__".repeat(66), size: 6, font: "Helvetica" });
    this.cursorY -= 10;
  }

  spacer(height = 12): void {
    this.cursorY -= height;
  }
}

export type ReceiptPdfInput = {
  schoolName: string;
  schoolContact: string;
  receiptRef: string;
  issuedAtIso: string;
  invoiceRef: string;
  studentLabel: string;
  payerLabel: string;
  amountPaise: number;
  method: string;
  gatewayRef: string;
  status: string;
  allocations: Array<{ label: string; amountPaise: number }>;
};

export type ReportCardPdfInput = {
  schoolName: string;
  studentRef: string;
  studentName: string;
  className: string;
  examLabel: string;
  publicationRef: string;
  publishedAtIso: string;
  state: string;
  correctionNote: string | null;
  rows: Array<{ subject: string; components: string; obtained: string; max: string; grade: string }>;
};

export const RECEIPT_TEMPLATE_VERSION = "receipt-v1";
export const REPORT_CARD_TEMPLATE_VERSION = "report-card-v1";

export function formatInr(paise: number): string {
  const negative = paise < 0;
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / 100).toString();
  const rest = String(absolute % 100).padStart(2, "0");
  let grouped: string;
  if (rupees.length <= 3) {
    grouped = rupees;
  } else {
    const last3 = rupees.slice(-3);
    grouped = `${rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
  }
  return `${negative ? "-" : ""}Rs. ${grouped}.${rest}`;
}

export function formatIst(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function renderDocument(blocks: (page: PageBuilder) => void): Uint8Array {
  const page = new PageBuilder();
  blocks(page);

  const contentOps: string[] = [];
  for (const op of page.ops) {
    contentOps.push(`BT /${op.font === "Helvetica-Bold" ? "F2" : "F1"} ${op.size} Tf 1 0 0 1 ${op.x.toFixed(2)} ${op.y.toFixed(2)} Tm (${op.text}) Tj ET`);
  }
  const content = contentOps.join("\n");

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const bytes = new Uint8Array(body.length);
  for (let index = 0; index < body.length; index += 1) bytes[index] = body.charCodeAt(index) & 0xff;
  return bytes;
}

export function renderReceiptPdf(input: ReceiptPdfInput): Uint8Array {
  return renderDocument((page) => {
    page.text({ text: input.schoolName.toUpperCase(), size: 16, bold: true, gapAfter: 2 });
    page.text({ text: input.schoolContact, size: 9, gapAfter: 14 });
    page.rule();
    page.text({ text: "FEE RECEIPT", size: 12, bold: true, gapAfter: 16 });

    page.text({ text: "Receipt", size: 9, bold: true });
    page.text({ text: input.receiptRef, rightAlign: true, size: 10, bold: true, gapAfter: 2, x: undefined });
    page.text({ text: "Date", size: 9, bold: true });
    page.text({ text: formatIst(input.issuedAtIso), rightAlign: true, size: 10, gapAfter: 14 });

    page.text({ text: `Invoice: ${input.invoiceRef}`, size: 10, gapAfter: 2 });
    page.text({ text: `Student: ${input.studentLabel}`, size: 10, gapAfter: 2 });
    page.text({ text: `Payer: ${input.payerLabel}`, size: 10, gapAfter: 12 });

    page.rule();
    for (const allocation of input.allocations) {
      page.text({ text: allocation.label, size: 10 });
      page.text({ text: formatInr(allocation.amountPaise), rightAlign: true, size: 10 });
    }
    page.rule();
    page.text({ text: "Total paid", size: 11, bold: true });
    page.text({ text: formatInr(input.amountPaise), rightAlign: true, size: 11, bold: true, gapAfter: 14 });

    page.text({ text: `Payment method: ${input.method}`, size: 9, gapAfter: 2 });
    page.text({ text: `Gateway reference: ${input.gatewayRef}`, size: 9, gapAfter: 2 });
    page.text({ text: `Status: ${input.status}`, size: 9, gapAfter: 20 });

    page.rule();
    page.text({
      text: `Generated from the school fee ledger - template ${RECEIPT_TEMPLATE_VERSION}. This receipt is reproducible from stored records.`,
      size: 8,
    });
  });
}

export function renderReportCardPdf(input: ReportCardPdfInput): Uint8Array {
  return renderDocument((page) => {
    page.text({ text: input.schoolName.toUpperCase(), size: 16, bold: true, gapAfter: 2 });
    page.text({ text: "REPORT CARD", size: 12, bold: true, gapAfter: 14 });
    page.rule();

    page.text({ text: `Student: ${input.studentName} (${input.studentRef})`, size: 10, gapAfter: 2 });
    page.text({ text: `Class: ${input.className}`, size: 10, gapAfter: 2 });
    page.text({ text: `Examination: ${input.examLabel}`, size: 10, gapAfter: 2 });
    page.text({ text: `Publication: ${input.publicationRef} - ${formatIst(input.publishedAtIso)}`, size: 9, gapAfter: 2 });
    page.text({ text: `State: ${input.state}`, size: 9, gapAfter: 12 });

    page.text({ text: "Subject", size: 9, bold: true });
    page.text({ text: "Obtained", rightAlign: true, size: 9, bold: true });
    page.rule();
    for (const row of input.rows) {
      page.text({ text: row.subject, size: 10 });
      page.text({ text: `${row.obtained} / ${row.max}  ${row.grade}`, rightAlign: true, size: 10 });
      if (row.components.length > 0) {
        page.text({ text: row.components, size: 8, x: MARGIN_X + 12 });
      }
    }
    page.rule();

    if (input.correctionNote !== null) {
      page.text({ text: `Correction: ${input.correctionNote}`, size: 9, gapAfter: 10 });
    }
    page.text({
      text: `Template ${REPORT_CARD_TEMPLATE_VERSION}. Marks shown are the published snapshot for this student.`,
      size: 8,
    });
  });
}
