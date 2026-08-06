// @vitest-environment node
/**
 * Student-scope contract tests for the finance demo adapter
 * (modules/services/finance.ts). Covers the I2 consolidation: portal reads
 * are scoped per student (Aarif keeps his exact ledger, Mariam has her own
 * distinct one), payments post to the owning ledger only, the staff-wide
 * read contains both ledgers, and staff totals equal the sum of the two
 * portal ledgers (parity). The clock is pinned and every session key is
 * cleared between tests, so refs and counters stay deterministic.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { STUDENT_AARIF_ID, STUDENT_MARIAM_ID } from "@/modules/finance/demo";
import {
  FINANCE_SESSION_KEYS,
  financeService,
  setDemoScenario,
  type InvoiceView,
} from "@/modules/services/finance";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-05T09:30:00Z");

const AARIF_UNPAID = "INV-2026-0103";
const AARIF_FULL_AMOUNT_PAISE = 920000;
const MARIAM_UNPAID = "INV-2026-0203";
const MARIAM_FULL_AMOUNT_PAISE = 835000;
const MARIAM_PARTIAL_BALANCE_PAISE = 435000;

beforeEach(() => {
  setDemoNow(PINNED);
  setDemoScenario("success");
  Object.values(FINANCE_SESSION_KEYS).forEach((key) => sessionRemove(key));
});

afterEach(() => {
  setDemoNow(null);
  setDemoScenario("success");
  Object.values(FINANCE_SESSION_KEYS).forEach((key) => sessionRemove(key));
});

/** One gateway poll; each adapter call simulates 200–350 ms latency. */
async function settleHappyPath(attemptId: string): Promise<void> {
  expect((await financeService.refreshAttempt(attemptId)).status).toBe("processing");
  expect((await financeService.refreshAttempt(attemptId)).status).toBe("succeeded");
}

function totals(views: readonly InvoiceView[]): { total: number; paid: number; balance: number } {
  return views.reduce(
    (acc, view) => ({
      total: acc.total + view.totalPaise,
      paid: acc.paid + view.paidPaise,
      balance: acc.balance + view.balancePaise,
    }),
    { total: 0, paid: 0, balance: 0 },
  );
}

describe("financeService student-scoped ledgers", () => {
  it("Aarif sees exactly his three fixture invoices — default and explicit calls agree", async () => {
    const defaults = await financeService.listInvoices();
    const explicit = await financeService.listInvoices(STUDENT_AARIF_ID);

    expect(defaults).toHaveLength(3);
    expect(explicit).toHaveLength(3);
    expect(defaults).toEqual(explicit);
    expect(explicit.map((view) => view.invoice.ref)).toEqual([
      "INV-2026-0101",
      "INV-2026-0102",
      "INV-2026-0103",
    ]);
    for (const view of explicit) {
      expect(view.studentId).toBe(STUDENT_AARIF_ID);
      expect(view.invoice.studentId).toBe(STUDENT_AARIF_ID);
      expect(view.studentName).toBe("Aarif Hussain");
      expect(view.totalPaise).toBe(AARIF_FULL_AMOUNT_PAISE);
    }
    const unpaid = explicit.find((view) => view.invoice.ref === AARIF_UNPAID);
    expect(unpaid?.paidPaise).toBe(0);
    expect(unpaid?.balancePaise).toBe(AARIF_FULL_AMOUNT_PAISE);
    expect(unpaid?.status).toBe("unpaid");

    // An unknown student gets an empty ledger, never a fallback to another child.
    expect(await financeService.listInvoices("00000000-0000-4000-8000-000000000999")).toHaveLength(0);
  });

  it("Mariam sees her distinct three invoices and her receipts resolve to her", async () => {
    const mariam = await financeService.listInvoices(STUDENT_MARIAM_ID);

    expect(mariam).toHaveLength(3);
    expect(mariam.map((view) => view.invoice.ref)).toEqual([
      "INV-2026-0201",
      "INV-2026-0202",
      "INV-2026-0203",
    ]);
    for (const view of mariam) {
      expect(view.studentId).toBe(STUDENT_MARIAM_ID);
      expect(view.invoice.studentId).toBe(STUDENT_MARIAM_ID);
      expect(view.studentName).toBe("Mariam Hussain");
    }
    // Distinct amounts from Aarif's ledger.
    expect(mariam[0]?.totalPaise).toBe(MARIAM_FULL_AMOUNT_PAISE);
    expect(mariam[1]?.totalPaise).toBe(MARIAM_FULL_AMOUNT_PAISE);
    expect(mariam[1]?.status).toBe("partial");
    expect(mariam[1]?.balancePaise).toBe(MARIAM_PARTIAL_BALANCE_PAISE);
    expect(mariam[2]?.status).toBe("unpaid");
    expect(mariam[2]?.balancePaise).toBe(MARIAM_FULL_AMOUNT_PAISE);
    expect(mariam[2]?.totalPaise).not.toBe(AARIF_FULL_AMOUNT_PAISE);

    // Receipts resolve to the owning student.
    const mariamReceipt = await financeService.getReceipt("RC-2026-0138");
    expect(mariamReceipt?.studentId).toBe(STUDENT_MARIAM_ID);
    expect(mariamReceipt?.invoiceRef).toBe("INV-2026-0202");
    const aarifReceipt = await financeService.getReceipt("RC-2026-0102");
    expect(aarifReceipt?.studentId).toBe(STUDENT_AARIF_ID);
  });
});

describe("paying Mariam's unpaid invoice posts to Mariam's ledger only", () => {
  it("issues one payment and one fresh receipt on INV-2026-0203 and never touches Aarif", async () => {
    const created = await financeService.createPaymentAttempt(MARIAM_UNPAID, "UPI", MARIAM_FULL_AMOUNT_PAISE);

    expect(created.id).toBe("PAY-2026-0301");
    expect(created.gatewayRef).toBe("G-2026-0201");
    await settleHappyPath(created.id);

    const pair = await financeService.confirmSuccess(created.id);
    expect(pair.receipt.ref).toBe("RC-2026-0145");
    expect(pair.receipt.invoiceRef).toBe(MARIAM_UNPAID);
    expect(pair.receipt.studentId).toBe(STUDENT_MARIAM_ID);
    expect(pair.receipt.amountPaise).toBe(MARIAM_FULL_AMOUNT_PAISE);
    expect(pair.payment.ref).toBe(created.id);

    // Mariam's ledger now shows the posted payment.
    const mariam = await financeService.listInvoices(STUDENT_MARIAM_ID);
    const paid = mariam.find((view) => view.invoice.ref === MARIAM_UNPAID);
    expect(paid?.paidPaise).toBe(MARIAM_FULL_AMOUNT_PAISE);
    expect(paid?.balancePaise).toBe(0);
    expect(paid?.status).toBe("paid");
    expect(paid?.payments).toHaveLength(1);
    expect(paid?.payments[0]?.ref).toBe(created.id);
    expect(paid?.receipts.map((receipt) => receipt.ref)).toEqual(["RC-2026-0145"]);

    // Aarif's ledger is untouched: same balance, no payments, no new receipts.
    const aarif = await financeService.listInvoices(STUDENT_AARIF_ID);
    const aarifUnpaid = aarif.find((view) => view.invoice.ref === AARIF_UNPAID);
    expect(aarifUnpaid?.balancePaise).toBe(AARIF_FULL_AMOUNT_PAISE);
    expect(aarifUnpaid?.payments).toHaveLength(0);
    expect(aarifUnpaid?.status).toBe("unpaid");
    const aarifReceipts = (await financeService.listReceipts()).filter(
      (receipt) => receipt.studentId === STUDENT_AARIF_ID,
    );
    expect(aarifReceipts).toHaveLength(2);
    expect(aarifReceipts.map((receipt) => receipt.ref)).toEqual(["RC-2026-0102", "RC-2026-0131"]);

    const attempts = await financeService.listAttempts(MARIAM_UNPAID);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("succeeded");
    expect(await financeService.listAttempts(AARIF_UNPAID)).toHaveLength(0);
  });
});

describe("staff-wide finance reads", () => {
  it("listAllInvoices contains both ledgers and detail lookup crosses them", async () => {
    const all = await financeService.listAllInvoices();

    expect(all).toHaveLength(6);
    expect(all.filter((view) => view.studentId === STUDENT_AARIF_ID)).toHaveLength(3);
    expect(all.filter((view) => view.studentId === STUDENT_MARIAM_ID)).toHaveLength(3);
    expect(new Set(all.map((view) => view.invoice.ref)).size).toBe(6);
    expect(all.map((view) => view.invoice.ref)).toEqual([
      "INV-2026-0101",
      "INV-2026-0102",
      "INV-2026-0103",
      "INV-2026-0201",
      "INV-2026-0202",
      "INV-2026-0203",
    ]);

    const mariamDetail = await financeService.getInvoice(MARIAM_UNPAID);
    expect(mariamDetail?.studentId).toBe(STUDENT_MARIAM_ID);
    expect(mariamDetail?.studentName).toBe("Mariam Hussain");
  });

  it("staff totals equal the sum of the two portal ledgers (parity)", async () => {
    const staff = await financeService.listAllInvoices();
    const aarif = await financeService.listInvoices(STUDENT_AARIF_ID);
    const mariam = await financeService.listInvoices(STUDENT_MARIAM_ID);

    expect(totals(staff)).toEqual(totals([...aarif, ...mariam]));
    // Spot-check the shared sums: every invoice and every receipt is counted once.
    expect(totals(staff).total).toBe(920000 * 3 + 835000 * 3);
    // Outstanding = Aarif 0102 partial (420000) + 0103 (920000) + Mariam 0202 partial (435000) + 0203 (835000).
    expect(totals(staff).balance).toBe(2610000);

    const receipts = await financeService.listReceipts();
    expect(receipts.filter((receipt) => receipt.studentId === STUDENT_AARIF_ID)).toHaveLength(2);
    expect(receipts.filter((receipt) => receipt.studentId === STUDENT_MARIAM_ID)).toHaveLength(2);
  });
});
