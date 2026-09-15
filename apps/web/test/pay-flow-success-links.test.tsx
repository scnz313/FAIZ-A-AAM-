import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPaymentAttempt: vi.fn(),
  refreshAttempt: vi.fn(),
  confirmSuccess: vi.fn(),
  getInvoice: vi.fn(),
  convertApplication: vi.fn(),
}));

vi.mock("@/modules/services/adapter-client", () => ({
  adapterCall: vi.fn(),
  clientAdapterMode: () => "supabase",
}));

vi.mock("@/modules/services/finance", () => ({
  FinanceServiceError: class FinanceServiceError extends Error {},
  financeService: {
    createPaymentAttempt: mocks.createPaymentAttempt,
    refreshAttempt: mocks.refreshAttempt,
    confirmSuccess: mocks.confirmSuccess,
    getInvoice: mocks.getInvoice,
  },
  formatINR: (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`,
  getDemoScenario: () => "success",
  setDemoScenario: vi.fn(),
}));

vi.mock("@/modules/services/enrollment", () => ({
  EnrollmentConversionError: class EnrollmentConversionError extends Error {},
  convertApplication: mocks.convertApplication,
}));

import AdmissionFeeStep from "@/components/applicant/AdmissionFeeStep";
import { PayFlow } from "@/components/portal/PayFlow";

const INVOICE_REF = "INV-2026-0001";
const RECEIPT_REF = "REC-2026-0001";
const APPLICATION_REF = "APP-2026-0001";

function primeSettledPayment(): void {
  mocks.createPaymentAttempt.mockResolvedValue({
    id: "PAY-2026-0001",
    invoiceRef: INVOICE_REF,
    status: "created",
    method: "UPI",
    amountPaise: 125000,
    failureReason: null,
    updatedAtIso: "2026-09-10T00:00:00.000Z",
  });
  mocks.refreshAttempt.mockResolvedValue({
    id: "PAY-2026-0001",
    invoiceRef: INVOICE_REF,
    status: "succeeded",
    method: "UPI",
    amountPaise: 125000,
    failureReason: null,
    updatedAtIso: "2026-09-10T00:00:00.000Z",
  });
  mocks.confirmSuccess.mockResolvedValue({
    receipt: { ref: RECEIPT_REF, amountPaise: 125000, method: "UPI" },
    payment: { ref: "PMT-2026-0001" },
  });
}

/** Open the island, start checkout, and wait for the success panel. */
async function settlePayment(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole("button", { name: /^Pay / }));
  await user.click(screen.getByRole("button", { name: "Continue to checkout" }));
  await screen.findByText("Payment recorded");
}

describe("PayFlow success destinations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeSettledPayment();
    mocks.getInvoice.mockResolvedValue({ balancePaise: 125000, totalPaise: 125000 });
  });

  it("keeps the guardian portal links when hrefs are omitted", async () => {
    const user = userEvent.setup();
    render(
      <PayFlow
        invoiceRef={INVOICE_REF}
        term="Term 2"
        amountPaise={125000}
        balanceAfterPaise={0}
        onSettled={vi.fn()}
      />,
    );

    await settlePayment(user);

    expect(screen.getByRole("link", { name: `View receipt ${RECEIPT_REF} →` })).toHaveAttribute(
      "href",
      `/portal/receipts/${RECEIPT_REF}`,
    );
    expect(screen.getByRole("link", { name: "Back to the fee ledger →" })).toHaveAttribute(
      "href",
      "/portal/fees",
    );
  });

  it("suppresses portal links and offers the status page for the applicant before conversion", async () => {
    const user = userEvent.setup();
    render(
      <AdmissionFeeStep
        applicationRef={APPLICATION_REF}
        invoiceRef={INVOICE_REF}
        acceptByIso="2026-12-31T00:00:00.000Z"
      />,
    );

    await settlePayment(user);

    expect(screen.queryByRole("link", { name: /View receipt/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Back to the fee ledger/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to application status →" })).toHaveAttribute(
      "href",
      `/apply/student/${APPLICATION_REF}/status`,
    );
    expect(
      screen.getByText(/It appears in the family portal once the guardian account is linked\./),
    ).toBeInTheDocument();
  });

  it("renders a custom receipt href and treats an empty string as suppressed", async () => {
    const user = userEvent.setup();
    render(
      <PayFlow
        invoiceRef={INVOICE_REF}
        term="Term 2"
        amountPaise={125000}
        balanceAfterPaise={0}
        onSettled={vi.fn()}
        receiptHref={`/receipts/${RECEIPT_REF}`}
        feesHref=""
        portalPending
      />,
    );

    await settlePayment(user);

    expect(screen.getByRole("link", { name: `View receipt ${RECEIPT_REF} →` })).toHaveAttribute(
      "href",
      `/receipts/${RECEIPT_REF}`,
    );
    expect(screen.queryByRole("link", { name: /Back to/ })).toBeNull();
  });
});
