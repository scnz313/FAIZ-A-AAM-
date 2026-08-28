// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { Webhook } from "svix";

import { createResendSender } from "@/lib/email/resend";
import { verifyResendWebhook } from "@/lib/email/webhook";
import { generateReceiptPdf, generatedObjectKey, mapReportCardSnapshot } from "@/lib/pdf/adapter";
import { renderReportCardPdf } from "@/lib/pdf/render";
import { FakeDocumentScanner, FakeStorageProvider, HttpDocumentScanner } from "@/modules/services/document-providers";
import { FakePaymentProvider } from "@/modules/services/payment-provider";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("provider contracts", () => {
  it("storage stat is server-byte based and cleanup is idempotent", async () => {
    const storage = new FakeStorageProvider();
    const bytes = new TextEncoder().encode("%PDF-1.4 provider test");
    await storage.upload({ bucket: "fass-private-documents", objectKey: "uploads/test.pdf", bytes, contentType: "application/pdf" });
    const first = await storage.stat({ bucket: "fass-private-documents", objectKey: "uploads/test.pdf" });
    const second = await storage.stat({ bucket: "fass-private-documents", objectKey: "uploads/test.pdf" });
    expect(first.contentType).toBe("application/pdf");
    expect(first.sizeBytes).toBe(bytes.byteLength);
    expect(first.checksumSha256).toHaveLength(64);
    expect(first.checksumSha256).toBe(second.checksumSha256);
    await storage.remove({ bucket: "fass-private-documents", objectKey: "uploads/test.pdf" });
    await storage.remove({ bucket: "fass-private-documents", objectKey: "uploads/test.pdf" });
    expect(await storage.list({ bucket: "fass-private-documents" })).toHaveLength(0);
  });

  it("scanner preserves ready/quarantined/failed contract states", async () => {
    await expect(new FakeDocumentScanner({ state: "ready" }).scan({ bucket: "b", objectKey: "k", declaredMimeType: "application/pdf", sizeBytes: 1, checksumSha256: "a" })).resolves.toMatchObject({ state: "ready" });
    await expect(new FakeDocumentScanner({ state: "quarantined", detail: "malware" }).scan({ bucket: "b", objectKey: "k", declaredMimeType: "application/pdf", sizeBytes: 1, checksumSha256: "a" })).resolves.toMatchObject({ state: "quarantined", detail: "malware" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "failed", detail: "provider timeout" }), { status: 200 }));
    await expect(new HttpDocumentScanner({ endpoint: "https://scanner.invalid", secret: "scanner-secret", fetchImpl }).scan({ bucket: "b", objectKey: "k", declaredMimeType: "application/pdf", sizeBytes: 1, checksumSha256: "a" })).resolves.toMatchObject({ state: "failed" });
    expect(fetchImpl).toHaveBeenCalledWith("https://scanner.invalid", expect.objectContaining({ method: "POST" }));
  });

  it("generated keys do not contain a human receipt/reference", () => {
    const key = generatedObjectKey("00000000-0000-4000-8000-000000000001", "a".repeat(64), "receipt");
    expect(key).toMatch(/^generated\/receipt\/00000000-0000-4000-8000-000000000001\/a{32}\.pdf$/);
    expect(key).not.toContain("RCPT-");
  });

  it("renders deterministic report-card bytes", () => {
    const input = {
      schoolName: "Faiz Aam School",
      studentRef: "STU-1",
      studentName: "Aarif Khan",
      className: "Class 8 A",
      examLabel: "Term 1",
      publicationRef: "RPR-1",
      publishedAtIso: "2026-08-06T06:30:00Z",
      state: "published",
      correctionNote: null,
      rows: [{ subject: "Mathematics", components: "Written", obtained: "80", max: "100", grade: "A" }],
    };
    const first = renderReportCardPdf(input);
    const second = renderReportCardPdf(input);
    expect(first).toEqual(second);
    expect(new TextDecoder().decode(first)).toContain("RPR-1");
  });

  it("maps Slice 4 marks snapshots to real subject totals and components", () => {
    expect(mapReportCardSnapshot({ marks: [
      { component: "Written", max: 80, obtained: 64, status: "present" },
      { component: "Oral", max: 20, obtained: 18, status: "present" },
    ] }, "Mathematics")).toEqual({
      subject: "Mathematics",
      components: "Written: 64/80; Oral: 18/20",
      obtained: "82",
      max: "100",
      grade: "-",
    });
  });

  it("resolves a receipt owner from the authoritative invoice id", async () => {
    let receiptSelection = "";
    const receiptRow = {
      id: "receipt-id",
      reference: "RCPT-1",
      issued_at: "2026-08-06T06:30:00Z",
      invoices: { id: "invoice-id", reference: "INV-1", status: "paid", student_id: null, applicant_ref: null, invoice_items: [] },
      payments: { provider_txn_id: "txn-1", method: "upi", amount_paise: 100, payment_allocations: [] },
    };
    const fakeAdmin = {
      from(table: string) {
        const chain = {
          select(selection: string) { if (table === "receipts") receiptSelection = selection; return chain; },
          eq() { return chain; },
          maybeSingle: async () => ({ data: table === "receipts" ? receiptRow : null, error: null }),
        };
        return chain;
      },
    };
    const generated = await generateReceiptPdf(fakeAdmin as never, "RCPT-1");
    expect(receiptSelection).toContain("invoices(id");
    expect(generated.ownerDomain).toBe("invoice");
    expect(generated.ownerRecordId).toBe("invoice-id");
  });

  it("uses exact Svix v1,signature envelopes and rejects v1=", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg_1" } });
    const id = "msg_evt_1";
    const timestampDate = new Date();
    const timestamp = String(Math.floor(timestampDate.getTime() / 1000));
    const signature = new Webhook(secret).sign(id, timestampDate, body);
    expect(verifyResendWebhook(secret, body, { id, timestamp, signature })).toBe(true);
    expect(verifyResendWebhook(secret, body, { id, timestamp, signature: signature.replace("v1,", "v1=") })).toBe(false);
  });

  it("classifies Resend 429 as transient", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "office@example.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const sender = createResendSender();
    await expect(sender({ to: ["guardian@example.test"], subject: "Update", html: "<p>Update</p>", idempotencyKey: "delivery:test" })).rejects.toThrow(/^Transient:Resend 429/);
  });

  it("payment fake preserves idempotent order/refund contracts", async () => {
    const provider = new FakePaymentProvider();
    const first = await provider.createOrder({ invoiceRef: "INV-1", amountPaise: 100, method: "upi", idempotencyKey: "order-1" });
    const retry = await provider.createOrder({ invoiceRef: "INV-1", amountPaise: 100, method: "upi", idempotencyKey: "order-1" });
    expect(retry.providerOrderRef).toBe(first.providerOrderRef);
    const refund = await provider.refund({ providerTxnRef: "txn-1", amountPaise: 100, idempotencyKey: "refund-1" });
    expect((await provider.refund({ providerTxnRef: "txn-1", amountPaise: 100, idempotencyKey: "refund-1" })).providerRefundRef).toBe(refund.providerRefundRef);
  });
});
