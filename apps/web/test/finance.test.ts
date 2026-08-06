// @vitest-environment node
/**
 * Deterministic contract tests for the finance demo adapter
 * (modules/services/finance.ts). Node environment exercises the SSR-safe
 * in-memory fallback of the session store (no window). The clock is pinned
 * and every session key is cleared between tests, so refs (PAY-/G-/RC-),
 * timestamps and counters are fully deterministic. Pure helpers in
 * modules/finance/demo.ts are untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  FINANCE_SESSION_KEYS,
  FinanceServiceError,
  financeService,
  setDemoScenario,
} from "@/modules/services/finance";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-05T09:30:00Z");

const UNPAID_INVOICE = "INV-2026-0103";
const FULL_AMOUNT_PAISE = 920000;

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

describe("financeService ledger", () => {
  it("defaults to the fixture ledger with pure-helper totals", async () => {
    const views = await financeService.listInvoices();

    expect(views).toHaveLength(3);
    const view = views.find((item) => item.invoice.ref === UNPAID_INVOICE);
    expect(view).toBeDefined();
    expect(view?.totalPaise).toBe(FULL_AMOUNT_PAISE);
    expect(view?.paidPaise).toBe(0);
    expect(view?.balancePaise).toBe(FULL_AMOUNT_PAISE);
    expect(view?.status).toBe("unpaid");
    expect(view?.payments).toHaveLength(0);
  });

  it("returns null for an unknown invoice and unknown receipt", async () => {
    expect(await financeService.getInvoice("INV-9999-0000")).toBeNull();
    expect(await financeService.getReceipt("RC-9999-0000")).toBeNull();
  });
});

describe("create → processing → success posts exactly one payment and one receipt", () => {
  it("issues RC-2026-0145, updates the invoice balance and links the payment to the receipt", async () => {
    const created = await financeService.createPaymentAttempt(UNPAID_INVOICE, "UPI", FULL_AMOUNT_PAISE);

    expect(created.status).toBe("created");
    expect(created.id).toBe("PAY-2026-0301");
    expect(created.gatewayRef).toBe("G-2026-0201");
    expect(created.createdAtIso).toBe("2026-08-05T09:30:00.000Z");
    expect(created.updatedAtIso).toBe("2026-08-05T09:30:00.000Z");

    await settleHappyPath(created.id);

    const pair = await financeService.confirmSuccess(created.id);
    expect(pair.receipt.ref).toBe("RC-2026-0145");
    expect(pair.receipt.invoiceRef).toBe(UNPAID_INVOICE);
    expect(pair.receipt.amountPaise).toBe(FULL_AMOUNT_PAISE);
    expect(pair.receipt.issuedAtIso).toBe("2026-08-05T09:30:00.000Z");
    expect(pair.payment.ref).toBe(created.id);
    expect(pair.payment.receiptRef).toBe(pair.receipt.ref);

    const receipts = await financeService.listReceipts();
    const issued = receipts.filter((receipt) => receipt.invoiceRef === UNPAID_INVOICE);
    expect(issued).toHaveLength(1);
    expect(issued[0]?.ref).toBe("RC-2026-0145");

    const view = await financeService.getInvoice(UNPAID_INVOICE);
    expect(view?.balancePaise).toBe(0);
    expect(view?.paidPaise).toBe(FULL_AMOUNT_PAISE);
    expect(view?.status).toBe("paid");
    expect(view?.payments).toHaveLength(1);
    expect(view?.payments[0]?.ref).toBe(created.id);
    expect(view?.receipts.map((receipt) => receipt.ref)).toEqual(["RC-2026-0145"]);

    const attempts = await financeService.listAttempts(UNPAID_INVOICE);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("succeeded");
  });

  it("confirmSuccess twice returns the SAME receipt — no double post, no second receipt", async () => {
    const created = await financeService.createPaymentAttempt(UNPAID_INVOICE, "Card", FULL_AMOUNT_PAISE);
    await settleHappyPath(created.id);

    const first = await financeService.confirmSuccess(created.id);
    const second = await financeService.confirmSuccess(created.id);

    expect(second.receipt.ref).toBe(first.receipt.ref);
    expect(second.receipt.ref).toBe("RC-2026-0145");
    expect(second.payment.ref).toBe(first.payment.ref);

    const view = await financeService.getInvoice(UNPAID_INVOICE);
    expect(view?.payments).toHaveLength(1);
    expect(view?.payments.filter((payment) => payment.ref === created.id)).toHaveLength(1);
    expect((await financeService.listReceipts()).filter((receipt) => receipt.invoiceRef === UNPAID_INVOICE)).toHaveLength(1);
  });
});

describe("failed and cancelled attempts never post", () => {
  it("a failed attempt carries the bank reason and confirmSuccess rejects", async () => {
    setDemoScenario("failed");
    const created = await financeService.createPaymentAttempt(UNPAID_INVOICE, "UPI", FULL_AMOUNT_PAISE);

    expect((await financeService.refreshAttempt(created.id)).status).toBe("processing");
    const failed = await financeService.refreshAttempt(created.id);
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Bank declined the transaction");

    await expect(financeService.confirmSuccess(created.id)).rejects.toBeInstanceOf(FinanceServiceError);
    await expect(financeService.confirmSuccess(created.id)).rejects.toMatchObject({ code: "attempt-not-succeeded" });

    const view = await financeService.getInvoice(UNPAID_INVOICE);
    expect(view?.balancePaise).toBe(FULL_AMOUNT_PAISE);
    expect(view?.payments).toHaveLength(0);
    expect((await financeService.listReceipts()).filter((receipt) => receipt.invoiceRef === UNPAID_INVOICE)).toHaveLength(0);
  });

  it("a cancelled attempt does not post either", async () => {
    setDemoScenario("cancelled");
    const created = await financeService.createPaymentAttempt(UNPAID_INVOICE, "UPI", FULL_AMOUNT_PAISE);
    await financeService.refreshAttempt(created.id);

    expect((await financeService.refreshAttempt(created.id)).status).toBe("cancelled");
    await expect(financeService.confirmSuccess(created.id)).rejects.toMatchObject({ code: "attempt-not-succeeded" });

    const view = await financeService.getInvoice(UNPAID_INVOICE);
    expect(view?.balancePaise).toBe(FULL_AMOUNT_PAISE);
    expect(view?.payments).toHaveLength(0);
  });
});

describe("delayed scenario is deterministic", () => {
  it("the first poll returns delayed, the second returns succeeded, then one receipt posts", async () => {
    setDemoScenario("delayed");
    const created = await financeService.createPaymentAttempt(UNPAID_INVOICE, "Net banking", FULL_AMOUNT_PAISE);

    expect((await financeService.refreshAttempt(created.id)).status).toBe("processing");

    const delayed = await financeService.refreshAttempt(created.id);
    expect(delayed.status).toBe("delayed");
    expect(delayed.failureReason).toBeUndefined();

    const succeeded = await financeService.refreshAttempt(created.id);
    expect(succeeded.status).toBe("succeeded");

    const pair = await financeService.confirmSuccess(created.id);
    expect(pair.receipt.ref).toBe("RC-2026-0145");
    expect((await financeService.listReceipts()).filter((receipt) => receipt.invoiceRef === UNPAID_INVOICE)).toHaveLength(1);
  });
});

describe("create-attempt failure is recoverable", () => {
  it("the gateway-unreachable scenario rejects create and switching back recovers", async () => {
    setDemoScenario("create-fails");

    await expect(
      financeService.createPaymentAttempt(UNPAID_INVOICE, "UPI", FULL_AMOUNT_PAISE),
    ).rejects.toMatchObject({ code: "gateway-unreachable" });
    expect(await financeService.listAttempts(UNPAID_INVOICE)).toHaveLength(0);

    setDemoScenario("success");
    const created = await financeService.createPaymentAttempt(UNPAID_INVOICE, "UPI", FULL_AMOUNT_PAISE);
    expect(created.id).toBe("PAY-2026-0301");
    expect(created.gatewayRef).toBe("G-2026-0201");
  });
});
