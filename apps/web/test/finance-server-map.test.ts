// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  invoiceSummary,
  mapServerInvoice,
  mapServerInvoiceView,
  mapServerReceipt,
  mergePaymentRegisterRows,
  type ServerInvoiceRow,
  type ServerReceiptRow,
} from "@/modules/services/finance-server-map";
import type { Invoice } from "@/modules/finance/demo";

function invoiceRow(overrides: Partial<ServerInvoiceRow> = {}): ServerInvoiceRow {
  return {
    reference: "INV-2026-0001",
    student_id: "student-1",
    applicant_ref: "APP-1",
    term: "Term 1",
    status: "unpaid",
    issue_date: "2026-04-01T06:00:00Z",
    due_date: "2026-04-20T14:00:00Z",
    version: 1,
    invoice_items: [{ label: "Tuition fee", amount_paise: 100000, kind: "fee" }],
    ledger_entries: [],
    payment_allocations: [],
    receipts: [],
    ...overrides,
  };
}

function receiptRow(overrides: Partial<ServerReceiptRow> = {}): ServerReceiptRow {
  return {
    reference: "RC-2026-0001",
    issued_at: "2026-04-05T08:30:00Z",
    payments: { method: "UPI", amount_paise: 50000 },
    invoices: { reference: "INV-2026-0001", student_id: "student-1" },
    ...overrides,
  };
}

describe("mapServerInvoice", () => {
  it("maps basic fields and defaults", () => {
    const row = invoiceRow();
    const inv = mapServerInvoice(row);
    expect(inv.ref).toBe("INV-2026-0001");
    expect(inv.studentId).toBe("student-1");
    expect(inv.applicantRef).toBe("APP-1");
    expect(inv.term).toBe("Term 1");
    expect(inv.issuedAtIso).toBe("2026-04-01T06:00:00Z");
    expect(inv.dueAtIso).toBe("2026-04-20T14:00:00Z");
    expect(inv.items).toEqual([{ label: "Tuition fee", amountPaise: 100000, kind: "fee" }]);
    expect(inv.payments).toEqual([]);
  });

  it("falls back term to Fees and dueAtIso to issue_date", () => {
    const inv = mapServerInvoice(invoiceRow({ term: null, due_date: null }));
    expect(inv.term).toBe("Fees");
    expect(inv.dueAtIso).toBe("2026-04-01T06:00:00Z");
  });

  it("preserves null student_id and applicant_ref", () => {
    const inv = mapServerInvoice(invoiceRow({ student_id: null, applicant_ref: null }));
    expect(inv.studentId).toBeNull();
    expect(inv.applicantRef).toBeNull();
  });

  describe("item kind folding", () => {
    it("maps concession kind exactly and defaults others to fee", () => {
      const row = invoiceRow({
        invoice_items: [
          { label: "Tuition", amount_paise: 600000, kind: "fee" },
          { label: "Concession", amount_paise: -60000, kind: "concession" },
          { label: "Unknown", amount_paise: 10000, kind: "discount" },
          { label: "Capitalized", amount_paise: 10000, kind: "Concession" },
          { label: "Empty", amount_paise: 10000, kind: "" },
        ],
      });
      const inv = mapServerInvoice(row);
      expect(inv.items.map((i) => i.kind)).toEqual(["fee", "concession", "fee", "fee", "fee"]);
    });
  });

  describe("totals", () => {
    it("sums items including negative concessions", () => {
      const row = invoiceRow({
        invoice_items: [
          { label: "Tuition", amount_paise: 600000, kind: "fee" },
          { label: "Concession", amount_paise: -60000, kind: "concession" },
        ],
        ledger_entries: [],
      });
      const inv = mapServerInvoice(row);
      expect(invoiceSummary(inv).totalPaise).toBe(540000);
      expect(invoiceSummary(inv).balancePaise).toBe(540000);
    });

    it("derives paidPaise only from negative ledger entries", () => {
      const row = invoiceRow({
        invoice_items: [
          { label: "Fee", amount_paise: 100000, kind: "fee" },
          { label: "Fee2", amount_paise: 50000, kind: "fee" },
        ],
        ledger_entries: [
          { entry_type: "charge", amount_paise: 100000 },
          { entry_type: "charge", amount_paise: 50000 },
          { entry_type: "payment", amount_paise: -40000 },
          { entry_type: "payment", amount_paise: -10000 },
          { entry_type: "refund", amount_paise: 20000 },
        ],
      });
      const inv = mapServerInvoice(row);
      expect(inv.status).toBe("partial");
      const summary = invoiceSummary(inv);
      expect(summary.totalPaise).toBe(150000);
      expect(summary.paidPaise).toBe(0);
      expect(summary.balancePaise).toBe(150000);
    });

    it("uses ledger negative sum for balance not payment_allocations", () => {
      const row = invoiceRow({
        invoice_items: [{ label: "Fee", amount_paise: 100000, kind: "fee" }],
        ledger_entries: [{ entry_type: "payment", amount_paise: -100000 }],
        payment_allocations: [
          { amount_paise: 50000, payments: { reference: "PAY-1", method: "UPI", amount_paise: 50000, created_at: "2026-04-05T08:30:00Z" } },
        ],
        receipts: [{ reference: "RC-1", issued_at: "2026-04-05T08:30:00Z" }],
      });
      const inv = mapServerInvoice(row);
      expect(inv.status).toBe("paid");
      expect(inv.payments).toHaveLength(1);
      expect(invoiceSummary(inv).paidPaise).toBe(50000);
    });

    it("caps balance at zero on overpayment", () => {
      const row = invoiceRow({
        invoice_items: [{ label: "Fee", amount_paise: 100000, kind: "fee" }],
        ledger_entries: [{ entry_type: "payment", amount_paise: -150000 }],
      });
      const inv = mapServerInvoice(row);
      expect(inv.status).toBe("paid");
      const summary = invoiceSummary(mapServerInvoice(invoiceRow({
        invoice_items: [{ label: "Fee", amount_paise: 100000, kind: "fee" }],
        ledger_entries: [{ entry_type: "payment", amount_paise: -150000 }],
      })));
      expect(summary.balancePaise).toBe(0);
      void inv;
    });
  });

  describe("status derivation", () => {
    it("derives paid when balance zero and total > 0", () => {
      const inv = mapServerInvoice(
        invoiceRow({
          status: "unpaid",
          invoice_items: [{ label: "Fee", amount_paise: 100000, kind: "fee" }],
          ledger_entries: [{ entry_type: "payment", amount_paise: -100000 }],
        }),
      );
      expect(inv.status).toBe("paid");
    });

    it("overrides server paid status when actually partial", () => {
      const inv = mapServerInvoice(
        invoiceRow({
          status: "paid",
          invoice_items: [{ label: "Fee", amount_paise: 100000, kind: "fee" }],
          ledger_entries: [{ entry_type: "payment", amount_paise: -40000 }],
        }),
      );
      expect(inv.status).toBe("partial");
    });

    it("derives partial when any payment exists but not fully paid", () => {
      const inv = mapServerInvoice(
        invoiceRow({
          status: "unpaid",
          invoice_items: [{ label: "Fee", amount_paise: 100000, kind: "fee" }],
          ledger_entries: [{ entry_type: "payment", amount_paise: -1 }],
        }),
      );
      expect(inv.status).toBe("partial");
    });

    it("falls back to toInvoiceStatus when no payments", () => {
      expect(mapServerInvoice(invoiceRow({ status: "paid", ledger_entries: [] })).status).toBe("paid");
      expect(mapServerInvoice(invoiceRow({ status: "partially_paid", ledger_entries: [] })).status).toBe("partial");
      expect(mapServerInvoice(invoiceRow({ status: "overdue", ledger_entries: [] })).status).toBe("overdue");
      expect(mapServerInvoice(invoiceRow({ status: "unpaid", ledger_entries: [] })).status).toBe("unpaid");
      expect(mapServerInvoice(invoiceRow({ status: "unknown", ledger_entries: [] })).status).toBe("unpaid");
      expect(mapServerInvoice(invoiceRow({ status: "", ledger_entries: [] })).status).toBe("unpaid");
    });

    it("does not mark zero-total invoice as paid even with zero balance", () => {
      const inv = mapServerInvoice(
        invoiceRow({
          status: "unpaid",
          invoice_items: [],
          ledger_entries: [],
        }),
      );
      expect(inv.status).toBe("unpaid");
    });

    it("zero-total with server paid still falls back to server status", () => {
      const inv = mapServerInvoice(
        invoiceRow({
          status: "paid",
          invoice_items: [],
          ledger_entries: [],
        }),
      );
      expect(inv.status).toBe("paid");
    });

    it("overpayment with zero total does not become paid when total is 0", () => {
      const inv = mapServerInvoice(
        invoiceRow({
          status: "unpaid",
          invoice_items: [],
          ledger_entries: [{ entry_type: "payment", amount_paise: -50000 }],
        }),
      );
      expect(inv.status).toBe("partial");
    });
  });

  describe("method folding via payment_allocations", () => {
    it("folds known methods case-insensitively and defaults unknown to Challan", () => {
      const row = invoiceRow({
        payment_allocations: [
          { amount_paise: 1000, payments: { reference: "PAY-1", method: "UPI", amount_paise: 1000, created_at: "2026-04-05T08:30:00Z" } },
          { amount_paise: 2000, payments: { reference: "PAY-2", method: "upi", amount_paise: 2000, created_at: "2026-04-06T08:30:00Z" } },
          { amount_paise: 3000, payments: { reference: "PAY-3", method: "Card", amount_paise: 3000, created_at: "2026-04-07T08:30:00Z" } },
          { amount_paise: 4000, payments: { reference: "PAY-4", method: "NET BANKING", amount_paise: 4000, created_at: "2026-04-08T08:30:00Z" } },
          { amount_paise: 5000, payments: { reference: "PAY-5", method: "cash", amount_paise: 5000, created_at: "2026-04-09T08:30:00Z" } },
          { amount_paise: 6000, payments: { reference: "PAY-6", method: "Challan", amount_paise: 6000, created_at: "2026-04-10T08:30:00Z" } },
          { amount_paise: 7000, payments: { reference: "PAY-7", method: "Net banking", amount_paise: 7000, created_at: "2026-04-11T08:30:00Z" } },
          { amount_paise: 8000, payments: { reference: "PAY-8", method: null, amount_paise: 8000, created_at: "2026-04-12T08:30:00Z" } },
          { amount_paise: 9000, payments: { reference: "PAY-9", method: "Paytm", amount_paise: 9000, created_at: "2026-04-13T08:30:00Z" } },
          { amount_paise: 10000, payments: { reference: "PAY-10", method: "", amount_paise: 10000, created_at: "2026-04-14T08:30:00Z" } },
        ],
        receipts: Array.from({ length: 10 }, (_, i) => ({ reference: `RC-${i + 1}`, issued_at: "2026-04-05T08:30:00Z" })),
      });
      const inv = mapServerInvoice(row);
      expect(inv.payments.map((p) => p.method)).toEqual([
        "UPI",
        "UPI",
        "Card",
        "Net banking",
        "Cash",
        "Challan",
        "Net banking",
        "Challan",
        "Challan",
        "Challan",
      ]);
    });

    it("maps the method from the nested payment attempt projection", () => {
      const row = invoiceRow({
        payment_allocations: [
          {
            amount_paise: 25000,
            payments: {
              id: "payment-nested-method",
              reference: "PAY-NESTED-METHOD",
              amount_paise: 25000,
              created_at: "2026-04-05T08:30:00Z",
              payment_attempts: { method: "net banking" },
            },
          },
        ],
        receipts: [
          {
            reference: "RC-NESTED-METHOD",
            payment_id: "payment-nested-method",
            issued_at: "2026-04-05T08:30:00Z",
          },
        ],
      });

      expect(mapServerInvoice(row).payments[0]).toMatchObject({
        method: "Net banking",
        receiptRef: "RC-NESTED-METHOD",
      });
      expect(
        mapServerReceipt(
          receiptRow({
            payments: {
              amount_paise: 25000,
              payment_attempts: { method: "card" },
            },
          }),
        ).method,
      ).toBe("Card");
    });

    it("uses allocation amount_paise not payments amount_paise", () => {
      const row = invoiceRow({
        payment_allocations: [
          { amount_paise: 12345, payments: { reference: "PAY-1", method: "UPI", amount_paise: 99999, created_at: "2026-04-05T08:30:00Z" } },
        ],
        receipts: [{ reference: "RC-1", issued_at: "2026-04-05T08:30:00Z" }],
      });
      const inv = mapServerInvoice(row);
      expect(inv.payments[0]?.amountPaise).toBe(12345);
    });

    it("matches receipts by payment id despite order and never borrows another payment's receipt", () => {
      const row = invoiceRow({
        payment_allocations: [
          { amount_paise: 1000, payments: { id: "payment-1", reference: "PAY-1", amount_paise: 1000, created_at: "2026-04-05T08:30:00Z", payment_attempts: { method: "UPI" } } },
          { amount_paise: 2000, payments: { id: "payment-2", reference: "PAY-2", amount_paise: 2000, created_at: "2026-04-06T08:30:00Z", payment_attempts: { method: "Card" } } },
          { amount_paise: 3000, payments: { id: "payment-without-receipt", reference: "PAY-3", amount_paise: 3000, created_at: "2026-04-07T08:30:00Z", payment_attempts: { method: "Cash" } } },
        ],
        receipts: [
          { reference: "RC-2", payment_id: "payment-2", issued_at: "2026-04-06T08:30:00Z" },
          { reference: "RC-OTHER", payment_id: "another-payment", issued_at: "2026-04-08T08:30:00Z" },
          { reference: "RC-1", payment_id: "payment-1", issued_at: "2026-04-05T08:30:00Z" },
        ],
      });
      const invoice = mapServerInvoice(row);
      expect(invoice.payments.map((payment) => [payment.ref, payment.method, payment.receiptRef])).toEqual([
        ["PAY-1", "UPI", "RC-1"],
        ["PAY-2", "Card", "RC-2"],
        ["PAY-3", "Cash", ""],
      ]);
    });

    it("falls back to receipt order when legacy rows omit payment ids", () => {
      const row = invoiceRow({
        payment_allocations: [
          { amount_paise: 1000, payments: { reference: "PAY-1", method: "UPI", amount_paise: 1000, created_at: "2026-04-05T08:30:00Z" } },
          { amount_paise: 2000, payments: { reference: "PAY-2", method: "Cash", amount_paise: 2000, created_at: "2026-04-06T08:30:00Z" } },
          { amount_paise: 3000, payments: { reference: "PAY-3", method: "Card", amount_paise: 3000, created_at: "2026-04-07T08:30:00Z" } },
        ],
        receipts: [{ reference: "RC-ONLY-1", issued_at: "2026-04-05T08:30:00Z" }],
      });
      const inv = mapServerInvoice(row);
      expect(inv.payments[0]?.receiptRef).toBe("RC-ONLY-1");
      expect(inv.payments[1]?.receiptRef).toBe("");
      expect(inv.payments[2]?.receiptRef).toBe("");
    });
  });

  describe("edge cases null and empty", () => {
    it("handles null invoice_items, ledger_entries, payment_allocations, receipts", () => {
      const row = invoiceRow({
        invoice_items: null,
        ledger_entries: null,
        payment_allocations: null,
        receipts: null,
      });
      const inv = mapServerInvoice(row);
      expect(inv.items).toEqual([]);
      expect(inv.payments).toEqual([]);
      expect(inv.status).toBe("unpaid");
      const summary = invoiceSummary(inv);
      expect(summary.totalPaise).toBe(0);
      expect(summary.paidPaise).toBe(0);
      expect(summary.balancePaise).toBe(0);
    });

    it("handles empty arrays", () => {
      const row = invoiceRow({
        invoice_items: [],
        ledger_entries: [],
        payment_allocations: [],
        receipts: [],
      });
      const inv = mapServerInvoice(row);
      expect(inv.items).toEqual([]);
      expect(inv.payments).toEqual([]);
    });

    it("filters out allocations where payments is null", () => {
      const row = invoiceRow({
        payment_allocations: [
          { amount_paise: 1000, payments: null },
          { amount_paise: 2000, payments: { reference: "PAY-2", method: "UPI", amount_paise: 2000, created_at: "2026-04-06T08:30:00Z" } },
          { amount_paise: 3000, payments: null },
        ],
        receipts: [
          { reference: "RC-1", issued_at: "2026-04-05T08:30:00Z" },
          { reference: "RC-2", issued_at: "2026-04-06T08:30:00Z" },
          { reference: "RC-3", issued_at: "2026-04-07T08:30:00Z" },
        ],
      });
      const inv = mapServerInvoice(row);
      expect(inv.payments).toHaveLength(1);
      expect(inv.payments[0]?.ref).toBe("PAY-2");
      expect(inv.payments[0]?.receiptRef).toBe("RC-2");
    });

    it("receiptRef index aligns with filtered payments not original index", () => {
      const row = invoiceRow({
        payment_allocations: [
          { amount_paise: 1000, payments: null },
          { amount_paise: 2000, payments: { reference: "PAY-2", method: "Cash", amount_paise: 2000, created_at: "2026-04-06T08:30:00Z" } },
        ],
        receipts: [{ reference: "RC-A", issued_at: "2026-04-05T08:30:00Z" }],
      });
      const inv = mapServerInvoice(row);
      expect(inv.payments[0]?.receiptRef).toBe("");
    });
  });
});

describe("mapServerInvoiceView signed ledger parity", () => {
  it("preserves concession, adjustment, and refund signs in the authoritative balance", () => {
    const row = invoiceRow({
      status: "paid",
      invoice_items: [{ label: "Term fee", amount_paise: 600000, kind: "fee" }],
      payment_allocations: [
        {
          amount_paise: 600000,
          payments: {
            id: "payment-1",
            reference: "PAY-1",
            amount_paise: 600000,
            provider_txn_id: "sbx-order-1",
            created_at: "2026-04-05T08:30:00Z",
            payment_attempts: { method: "UPI", provider_order_ref: "sbx-order-1" },
          },
        },
      ],
      receipts: [
        { reference: "RC-1", payment_id: "payment-1", issued_at: "2026-04-05T08:30:00Z" },
      ],
      ledger_entries: [
        { entry_type: "charge", amount_paise: 600000 },
        { entry_type: "payment", amount_paise: -600000 },
        { reference: "LED-CONCESSION", entry_type: "concession", amount_paise: -50000, reason: "ADJ-1: Merit concession" },
        { reference: "LED-ADJUSTMENT", entry_type: "adjustment", amount_paise: -20000, reason: "ADJ-2: Billing correction" },
        { reference: "LED-REFUND", entry_type: "refund", amount_paise: 125000, reason: "RFD-1: Partial refund" },
      ],
    });

    const view = mapServerInvoiceView(row);

    expect(view.ledgerEntries.map(({ kind, amountPaise }) => [kind, amountPaise])).toEqual([
      ["concession", -50000],
      ["adjustment", -20000],
      ["refund", 125000],
    ]);
    expect(view).toMatchObject({
      totalPaise: 600000,
      paidPaise: 600000,
      balancePaise: 55000,
      status: "partial",
    });
    expect(view.invoice.status).toBe(view.status);
  });
});

describe("invoiceSummary", () => {
  function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
    return {
      ref: "INV-1",
      studentId: "s1",
      term: "Term 1",
      issuedAtIso: "2026-04-01T06:00:00Z",
      dueAtIso: "2026-04-20T14:00:00Z",
      status: "unpaid",
      items: [],
      payments: [],
      ...overrides,
    };
  }

  it("sums items and payments", () => {
    const inv = makeInvoice({
      items: [
        { label: "Tuition", amountPaise: 600000, kind: "fee" },
        { label: "Concession", amountPaise: -60000, kind: "concession" },
      ],
      payments: [{ ref: "PAY-1", paidAtIso: "2026-04-05T08:30:00Z", method: "UPI", amountPaise: 400000, receiptRef: "RC-1" }],
    });
    const s = invoiceSummary(inv);
    expect(s.totalPaise).toBe(540000);
    expect(s.paidPaise).toBe(400000);
    expect(s.balancePaise).toBe(140000);
  });

  it("returns zeros for empty invoice", () => {
    const s = invoiceSummary(makeInvoice({ items: [], payments: [] }));
    expect(s).toEqual({ totalPaise: 0, paidPaise: 0, balancePaise: 0 });
  });

  it("caps balance at zero when overpaid", () => {
    const inv = makeInvoice({
      items: [{ label: "Fee", amountPaise: 100000, kind: "fee" }],
      payments: [{ ref: "PAY-1", paidAtIso: "2026-04-05T08:30:00Z", method: "Cash", amountPaise: 150000, receiptRef: "RC-1" }],
    });
    expect(invoiceSummary(inv).balancePaise).toBe(0);
  });

  it("handles multiple payments", () => {
    const inv = makeInvoice({
      items: [{ label: "Fee", amountPaise: 100000, kind: "fee" }],
      payments: [
        { ref: "PAY-1", paidAtIso: "2026-04-05T08:30:00Z", method: "UPI", amountPaise: 30000, receiptRef: "RC-1" },
        { ref: "PAY-2", paidAtIso: "2026-04-06T08:30:00Z", method: "Card", amountPaise: 20000, receiptRef: "RC-2" },
      ],
    });
    const s = invoiceSummary(inv);
    expect(s.paidPaise).toBe(50000);
    expect(s.balancePaise).toBe(50000);
  });

  it("handles negative total via concessions", () => {
    const inv = makeInvoice({
      items: [
        { label: "Fee", amountPaise: 50000, kind: "fee" },
        { label: "Big concession", amountPaise: -80000, kind: "concession" },
      ],
      payments: [],
    });
    const s = invoiceSummary(inv);
    expect(s.totalPaise).toBe(-30000);
    expect(s.balancePaise).toBe(0);
  });
});

describe("mergePaymentRegisterRows", () => {
  it("suppresses the succeeded attempt already represented by a posted provider transaction", () => {
    const posted = [
      { ref: "PAY-POSTED", status: "success" as const, providerTxnRef: "sbx-order-1", source: "ledger" },
    ];
    const attempts = [
      { ref: "ATTEMPT-SUCCEEDED", status: "success" as const, providerTxnRef: " sbx-order-1 ", source: "attempt" },
      { ref: "ATTEMPT-PENDING", status: "pending" as const, providerTxnRef: "sbx-order-1", source: "attempt" },
      { ref: "ATTEMPT-FAILED", status: "failed" as const, providerTxnRef: "sbx-order-2", source: "attempt" },
    ];

    const merged = mergePaymentRegisterRows(posted, attempts);

    expect(merged.map((row) => row.ref)).toEqual([
      "PAY-POSTED",
      "ATTEMPT-PENDING",
      "ATTEMPT-FAILED",
    ]);
    expect(merged.filter((row) => row.providerTxnRef?.trim() === "sbx-order-1" && row.status === "success")).toHaveLength(1);
  });

  it("deduplicates repeated references without hiding distinct succeeded attempts", () => {
    const posted = [
      { ref: "PAY-1", status: "success" as const, providerTxnRef: null },
      { ref: "PAY-1", status: "success" as const, providerTxnRef: null },
    ];
    const attempts = [
      { ref: "PAY-1", status: "success" as const, providerTxnRef: null },
      { ref: "ATTEMPT-2", status: "success" as const, providerTxnRef: "sbx-order-2" },
    ];

    expect(mergePaymentRegisterRows(posted, attempts).map((row) => row.ref)).toEqual(["PAY-1", "ATTEMPT-2"]);
  });
});

describe("mapServerReceipt", () => {
  it("maps basic fields", () => {
    const r = mapServerReceipt(receiptRow());
    expect(r.ref).toBe("RC-2026-0001");
    expect(r.invoiceRef).toBe("INV-2026-0001");
    expect(r.studentId).toBe("student-1");
    expect(r.issuedAtIso).toBe("2026-04-05T08:30:00Z");
    expect(r.method).toBe("UPI");
    expect(r.amountPaise).toBe(50000);
    expect(r.counter).toBe("Online payment");
  });

  it("folds payment method case-insensitively", () => {
    expect(mapServerReceipt(receiptRow({ payments: { method: "card", amount_paise: 1000 } })).method).toBe("Card");
    expect(mapServerReceipt(receiptRow({ payments: { method: "NET BANKING", amount_paise: 1000 } })).method).toBe("Net banking");
    expect(mapServerReceipt(receiptRow({ payments: { method: "cash", amount_paise: 1000 } })).method).toBe("Cash");
    expect(mapServerReceipt(receiptRow({ payments: { method: "Challan", amount_paise: 1000 } })).method).toBe("Challan");
    expect(mapServerReceipt(receiptRow({ payments: { method: "uPi", amount_paise: 1000 } })).method).toBe("UPI");
  });

  it("defaults unknown or null method to Challan", () => {
    expect(mapServerReceipt(receiptRow({ payments: { method: null, amount_paise: 1000 } })).method).toBe("Challan");
    expect(mapServerReceipt(receiptRow({ payments: { method: "Paytm", amount_paise: 1000 } })).method).toBe("Challan");
    expect(mapServerReceipt(receiptRow({ payments: { method: "", amount_paise: 1000 } })).method).toBe("Challan");
    expect(mapServerReceipt(receiptRow({ payments: null })).method).toBe("Challan");
  });

  it("defaults amount to 0 when payments is null", () => {
    const r = mapServerReceipt(receiptRow({ payments: null }));
    expect(r.amountPaise).toBe(0);
    expect(r.method).toBe("Challan");
  });

  it("handles null invoices", () => {
    const r = mapServerReceipt(receiptRow({ invoices: null }));
    expect(r.invoiceRef).toBe("");
    expect(r.studentId).toBeNull();
  });

  it("handles invoices with null student_id", () => {
    const r = mapServerReceipt(receiptRow({ invoices: { reference: "INV-X", student_id: null } }));
    expect(r.invoiceRef).toBe("INV-X");
    expect(r.studentId).toBeNull();
  });

  it("handles both payments and invoices null", () => {
    const r = mapServerReceipt({ reference: "RC-1", issued_at: "2026-04-05T08:30:00Z", payments: null, invoices: null });
    expect(r.ref).toBe("RC-1");
    expect(r.invoiceRef).toBe("");
    expect(r.studentId).toBeNull();
    expect(r.amountPaise).toBe(0);
    expect(r.method).toBe("Challan");
    expect(r.counter).toBe("Online payment");
  });
});
