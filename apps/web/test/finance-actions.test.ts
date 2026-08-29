// @vitest-environment node
/**
 * Deterministic contract tests for the local finance actions (plan L1.2):
 * adjustment/concession requests with maker/checker approval and posting,
 * capped refunds through the local sandbox provider, and reconciliation
 * runs with resolvable exceptions. The clock is pinned and every finance
 * session key is cleared between tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { resetDemoPolicy, setDemoPolicy } from "@/modules/services/demo-policy";
import { FINANCE_SESSION_KEYS, FinanceServiceError, financeService } from "@/modules/services/finance";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-05T09:30:00Z");

const OFFICER = "00000000-0000-4000-8000-000000000203";
const APPROVER = "00000000-0000-4000-8000-000000000205";

beforeEach(() => {
  setDemoNow(PINNED);
  resetDemoPolicy();
  Object.values(FINANCE_SESSION_KEYS).forEach((key) => sessionRemove(key));
});

afterEach(() => {
  setDemoNow(null);
  resetDemoPolicy();
  Object.values(FINANCE_SESSION_KEYS).forEach((key) => sessionRemove(key));
});

describe("adjustments and concessions (maker/checker)", () => {
  it("requests, approves (by a different account), and posts a concession", async () => {
    const requested = await financeService.requestAdjustment({
      invoiceRef: "INV-2026-0103",
      amountPaise: 100000,
      reason: "Merit concession approved for the term fee.",
      type: "concession",
      requestedBy: OFFICER,
    });
    expect(requested.ref).toBe("ADJ-2026-0401");
    expect(requested.status).toBe("pending");
    expect(requested.amountPaise).toBe(-100000);

    const approved = await financeService.approveAdjustment({
      ref: requested.ref,
      approve: true,
      reason: "Concession within the approved merit policy.",
      decidedBy: APPROVER,
    });
    expect(approved.status).toBe("approved");
    expect(approved.version).toBe(2);

    const posted = await financeService.postAdjustment({ ref: requested.ref, postedBy: OFFICER });
    expect(posted.status).toBe("posted");

    /* The ledger balance reflects the concession without rewriting items. */
    const view = await financeService.getInvoice("INV-2026-0103");
    expect(view?.balancePaise).toBe(920000 - 100000);
    expect(view?.ledgerEntries).toHaveLength(1);
    expect(view?.ledgerEntries[0]?.kind).toBe("concession");
    expect(view?.invoice.items.some((item) => item.kind === "concession" && item.amountPaise === -100000)).toBe(false);
  });

  it("blocks self-approval (maker/checker) and double posting", async () => {
    const requested = await financeService.requestAdjustment({
      invoiceRef: "INV-2026-0103",
      amountPaise: 50000,
      reason: "Write-off for the damaged textbook charge.",
      type: "write_off",
      requestedBy: OFFICER,
    });
    await expect(
      financeService.approveAdjustment({ ref: requested.ref, approve: true, reason: "Self-approval must fail.", decidedBy: OFFICER }),
    ).rejects.toThrow(/maker\/checker/);

    const approved = await financeService.approveAdjustment({
      ref: requested.ref,
      approve: true,
      reason: "Write-off approved by the finance approver.",
      decidedBy: APPROVER,
    });
    expect(approved.status).toBe("approved");

    await financeService.postAdjustment({ ref: requested.ref, postedBy: OFFICER });
    await expect(financeService.postAdjustment({ ref: requested.ref, postedBy: OFFICER })).rejects.toThrow(/approved before posting/);
    await expect(
      financeService.approveAdjustment({ ref: requested.ref, approve: true, reason: "Already decided.", decidedBy: APPROVER }),
    ).rejects.toThrow(/already (approved|posted)/);
  });

  it("rejects an adjustment above the outstanding balance and a short reason", async () => {
    await expect(
      financeService.requestAdjustment({
        invoiceRef: "INV-2026-0103",
        amountPaise: 10_000_000,
        reason: "This adjustment is far above the outstanding balance.",
        type: "adjustment",
        requestedBy: OFFICER,
      }),
    ).rejects.toThrow(/exceeds the outstanding balance/);
    await expect(
      financeService.requestAdjustment({
        invoiceRef: "INV-2026-0103",
        amountPaise: 1000,
        reason: "Short.",
        type: "concession",
        requestedBy: OFFICER,
      }),
    ).rejects.toThrow(/at least 10 characters/);
  });

  it("throws policy-pending when the fictional rule is disabled", async () => {
    setDemoPolicy("finance.adjustments", false);
    await expect(
      financeService.requestAdjustment({
        invoiceRef: "INV-2026-0103",
        amountPaise: 1000,
        reason: "A concession request while the rule is off.",
        type: "concession",
        requestedBy: OFFICER,
      }),
    ).rejects.toMatchObject({ code: "policy-pending" });
  });
});

describe("refunds (capped, sandbox provider)", () => {
  it("requests, approves, and posts a refund against a paid invoice", async () => {
    const requested = await financeService.requestRefund({
      paymentRef: "PAY-2026-0188",
      amountPaise: 200000,
      reason: "Duplicate payment received on the term fee.",
      requestedBy: OFFICER,
    });
    expect(requested.ref).toBe("RFD-2026-0501");
    expect(requested.invoiceRef).toBe("INV-2026-0101");

    await expect(
      financeService.approveRefund({ ref: requested.ref, approve: true, reason: "Self-approval must fail.", decidedBy: OFFICER }),
    ).rejects.toThrow(/maker\/checker/);

    const approved = await financeService.approveRefund({
      ref: requested.ref,
      approve: true,
      reason: "Duplicate payment confirmed by the approver.",
      decidedBy: APPROVER,
    });
    expect(approved.status).toBe("approved");

    const posted = await financeService.postRefund({ ref: requested.ref, postedBy: OFFICER });
    expect(posted.status).toBe("posted");
    expect(posted.providerRefundRef).toMatch(/^sbr_/);

    /* Balance restored by the refund; the original payment stays on record. */
    const view = await financeService.getInvoice("INV-2026-0101");
    expect(view?.balancePaise).toBe(200000);
    expect(view?.payments).toHaveLength(1);
    expect(view?.ledgerEntries[0]?.kind).toBe("refund");
    expect(view?.ledgerEntries[0]?.amountPaise).toBe(200000);
  });

  it("caps the refund at the payment's remaining refundable amount", async () => {
    await financeService.requestRefund({
      paymentRef: "PAY-2026-0188",
      amountPaise: 800000,
      reason: "First partial refund on the paid term fee.",
      requestedBy: OFFICER,
    });
    await expect(
      financeService.requestRefund({
        paymentRef: "PAY-2026-0188",
        amountPaise: 200000,
        reason: "Second refund exceeds the remaining refundable amount.",
        requestedBy: OFFICER,
      }),
    ).rejects.toThrow(/refundable amount/);
  });

  it("rejects refunds for unknown payments and when the rule is off", async () => {
    await expect(
      financeService.requestRefund({
        paymentRef: "PAY-9999-0000",
        amountPaise: 10000,
        reason: "Refund against a payment that does not exist.",
        requestedBy: OFFICER,
      }),
    ).rejects.toThrow(/payment was not found/);

    setDemoPolicy("finance.refunds", false);
    await expect(
      financeService.requestRefund({
        paymentRef: "PAY-2026-0188",
        amountPaise: 10000,
        reason: "Refund while the fictional rule is off.",
        requestedBy: OFFICER,
      }),
    ).rejects.toMatchObject({ code: "policy-pending" });
  });
});

describe("reconciliation runs and exceptions", () => {
  it("records a run with matched rows and open exceptions, then resolves one", async () => {
    const run = await financeService.startReconciliation({ by: OFFICER });
    expect(run.ref).toBe("REC-2026-0601");
    expect(run.matchedCount).toBeGreaterThanOrEqual(4);
    expect(run.exceptions.length).toBeGreaterThan(0);
    const gatewayOnly = run.exceptions.find((exception) => exception.kind === "gateway-only");
    expect(gatewayOnly?.payRef).toBe("PAY-2026-0303");
    expect(gatewayOnly?.status).toBe("open");

    const resolved = await financeService.resolveReconciliationException({
      runRef: run.ref,
      exceptionId: gatewayOnly?.id ?? "",
      reason: "Manual post confirmed by the finance office.",
      by: OFFICER,
    });
    const after = resolved.exceptions.find((exception) => exception.id === gatewayOnly?.id);
    expect(after?.status).toBe("resolved");
    expect(after?.resolvedBy).toBe(OFFICER);
    expect(after?.version).toBe(2);

    /* A second resolve is rejected (version/state guard). */
    await expect(
      financeService.resolveReconciliationException({
        runRef: run.ref,
        exceptionId: gatewayOnly?.id ?? "",
        reason: "Already resolved.",
        by: OFFICER,
      }),
    ).rejects.toThrow(/already resolved/);
  });

  it("lists runs and applies policy-pending when the rule is off", async () => {
    await financeService.startReconciliation({ by: OFFICER });
    await financeService.startReconciliation({ by: OFFICER });
    const runs = await financeService.listReconciliationRuns();
    expect(runs).toHaveLength(2);
    const refs = runs.map((run) => run.ref).sort();
    expect(refs).toEqual(["REC-2026-0601", "REC-2026-0602"]);

    setDemoPolicy("finance.reconciliation", false);
    await expect(financeService.startReconciliation({ by: OFFICER })).rejects.toMatchObject({ code: "policy-pending" });
  });
});
