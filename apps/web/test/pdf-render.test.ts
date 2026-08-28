/**
 * PDF renderer tests (lib/pdf/render.ts).
 *
 * The renderer is dependency-free and deterministic: the same input always
 * produces byte-identical output, so assertions can pin exact structure —
 * valid PDF header/trailer, escaped text, folded currency, and the
 * reproducibility contract from plan.md §6.
 */
import { describe, expect, it } from "vitest";

import {
  RECEIPT_TEMPLATE_VERSION,
  formatInr,
  formatIst,
  renderReceiptPdf,
} from "@/lib/pdf/render";

function decode(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

describe("formatInr", () => {
  it("formats paise as grouped rupees", () => {
    expect(formatInr(200000)).toBe("Rs. 2,000.00");
    expect(formatInr(123456789)).toBe("Rs. 12,34,567.89");
    expect(formatInr(5)).toBe("Rs. 0.05");
    expect(formatInr(-250)).toBe("-Rs. 2.50");
  });
});

describe("formatIst", () => {
  it("renders an ISO timestamp in Asia/Kolkata", () => {
    const label = formatIst("2026-08-06T06:30:00Z");
    expect(label).toContain("2026");
    expect(label).toContain("12");
  });
});

describe("renderReceiptPdf", () => {
  const input = {
    schoolName: "Faiz Aam School",
    schoolContact: "Fee receipt - official record",
    receiptRef: "RCPT-2026-000007",
    issuedAtIso: "2026-08-06T06:30:00Z",
    invoiceRef: "INV-2026-000004",
    studentLabel: "Aisha Lone",
    payerLabel: "Firdous Ahmad",
    amountPaise: 200000,
    method: "sandbox",
    gatewayRef: "sbx_txn_001",
    status: "paid",
    allocations: [{ label: "Admission fee", amountPaise: 200000 }],
  };

  it("produces a structurally valid PDF", () => {
    const bytes = renderReceiptPdf(input);
    const text = decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("startxref");
  });

  it("renders receipt identity and amounts with the template version", () => {
    const text = decode(renderReceiptPdf(input));
    expect(text).toContain("RCPT-2026-000007");
    expect(text).toContain("INV-2026-000004");
    expect(text).toContain("(Rs. 2,000.00)");
    expect(text).toContain(RECEIPT_TEMPLATE_VERSION);
  });

  it("escapes parentheses and folds non-Latin characters safely", () => {
    const text = decode(
      renderReceiptPdf({ ...input, payerLabel: "Test (guardian) ₹100" }),
    );
    expect(text).toContain("\\(guardian\\)");
    expect(text).not.toContain("₹");
  });

  it("is deterministic and reproducible from stored records", () => {
    expect(decode(renderReceiptPdf(input))).toEqual(decode(renderReceiptPdf(input)));
  });
});
