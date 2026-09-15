// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { Webhook } from "svix";

import { createResendSender } from "@/lib/email/resend";
import { applicationSubmittedEmail, invoiceIssuedEmail, offerExtendedEmail } from "@/lib/email/templates";
import { deliveryFailureClass, deliveryProjection, normalizedWebhookPayload, verifyResendWebhook, webhookSuppressionReason } from "@/lib/email/webhook";
import { generateReceiptPdf, generatedObjectKey, mapReportCardSnapshot } from "@/lib/pdf/adapter";
import { renderReportCardPdf } from "@/lib/pdf/render";
import { FakeDocumentScanner, FakeStorageProvider, HttpDocumentScanner, type ScanInput } from "@/modules/services/document-providers";
import { FakePaymentProvider } from "@/modules/services/payment-provider";

function scanInput(overrides: Partial<ScanInput> = {}): ScanInput {
  return {
    bucket: "b",
    objectKey: "k",
    declaredMimeType: "application/pdf",
    sizeBytes: 1,
    checksumSha256: "a".repeat(64),
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    ...overrides,
  };
}

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
    await expect(new FakeDocumentScanner({ state: "ready" }).scan(scanInput())).resolves.toMatchObject({ state: "ready" });
    await expect(new FakeDocumentScanner({ state: "quarantined", detail: "malware" }).scan(scanInput())).resolves.toMatchObject({ state: "quarantined", detail: "malware" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "failed", detail: "provider timeout" }), { status: 200 }));
    await expect(new HttpDocumentScanner({ endpoint: "https://scanner.invalid", secret: "scanner-secret", fetchImpl }).scan(scanInput())).resolves.toMatchObject({ state: "failed" });
    expect(fetchImpl).toHaveBeenCalledWith("https://scanner.invalid", expect.objectContaining({ method: "POST", body: expect.any(Uint8Array) }));
  });

  it("generated keys do not contain a human receipt/reference", () => {
    const key = generatedObjectKey("00000000-0000-4000-8000-000000000001", "a".repeat(64), "receipt");
    expect(key).toMatch(/^generated\/receipt\/00000000-0000-4000-8000-000000000001\/a{32}\.pdf$/);
    expect(key).not.toContain("RCPT-");
  });

  it("renders deterministic report-card bytes", () => {
    const input = {
      schoolName: "Faiz E Aam School",
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

  it("keeps delivery projections monotonic by terminal severity", () => {
    expect(deliveryProjection("email.delivery_delayed")).toEqual({ status: "failed", rank: 10 });
    expect(deliveryProjection("email.failed")).toEqual({ status: "failed", rank: 20 });
    expect(deliveryProjection("email.delivered")).toEqual({ status: "delivered", rank: 30 });
    expect(deliveryProjection("email.bounced")).toEqual({ status: "bounced", rank: 40 });
  });

  it("keeps a transient bounce retryable instead of terminal", () => {
    const transientBounce = { data: { email_id: "email-1", to: ["guardian@example.test"], bounce: { type: "Transient" } } };
    const permanentBounce = { data: { email_id: "email-1", to: ["guardian@example.test"], bounce: { type: "Permanent", subType: "NoEmail" } } };
    expect(deliveryProjection("email.bounced", transientBounce)).toEqual({ status: "failed", rank: 15 });
    expect(webhookSuppressionReason(transientBounce, "email.bounced")).toBeNull();
    expect(deliveryFailureClass(deliveryProjection("email.bounced", transientBounce))).toBe("transient");
    expect(deliveryFailureClass(deliveryProjection("email.bounced", permanentBounce))).toBe("permanent");
    expect(deliveryFailureClass(deliveryProjection("email.delivered", transientBounce))).toBeNull();
  });

  it("stores only hashed recipients and suppresses permanent bounces or complaints", () => {
    const permanent = { data: { email_id: "email-1", to: ["guardian@example.test"], bounce: { type: "Permanent", subType: "NoEmail" } } };
    const transient = { data: { email_id: "email-1", to: ["guardian@example.test"], bounce: { type: "Transient" } } };
    const normalized = normalizedWebhookPayload(permanent, "email.bounced", "2026-08-10T00:00:00.000Z");
    expect(normalized.recipientHashes).toHaveLength(1);
    expect(JSON.stringify(normalized)).not.toContain("guardian@example.test");
    expect(webhookSuppressionReason(permanent, "email.bounced")).toBe("hard_bounce");
    expect(webhookSuppressionReason(transient, "email.bounced")).toBeNull();
    expect(webhookSuppressionReason({ data: { to: ["guardian@example.test"] } }, "email.complained")).toBe("complaint");
  });

  it("classifies Resend 429 as transient and applies a provider timeout", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "office@example.test");
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const sender = createResendSender();
    await expect(sender({ to: ["guardian@example.test"], subject: "Update", html: "<p>Update</p>", idempotencyKey: "delivery:test" })).rejects.toThrow(/^Transient:Resend 429$/);
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("does not persist provider response bodies in send errors", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "office@example.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("recipient guardian@example.test was rejected", { status: 400 })));
    const sender = createResendSender();
    await expect(sender({ to: ["guardian@example.test"], subject: "Update", html: "<p>Update</p>", idempotencyKey: "delivery:test" })).rejects.toThrow(/^Permanent:Resend 400$/);
  });

  it("uses real applicant status routes in admissions emails", () => {
    vi.stubEnv("APP_URL", "https://school.example.test");
    const submitted = applicationSubmittedEmail({ applicationRef: "APP-2026-0101" });
    const offered = offerExtendedEmail({ applicationRef: "APP-2026-0101", expiresLabel: "20 August 2026" });
    const invoice = invoiceIssuedEmail({ invoiceRef: "INV-2026-0101", applicationRef: "APP-2026-0101" });
    for (const email of [submitted, offered, invoice]) {
      expect(email.html).toContain("/apply/student/APP-2026-0101/status");
      expect(email.html).not.toContain("/applicant/status");
    }
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
