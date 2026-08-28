/** Provider-neutral payment boundary.  The school ledger owns money state;
 * providers only create checkout evidence and report normalized outcomes. */
export type PaymentProviderStatus = "created" | "processing" | "succeeded" | "failed" | "cancelled" | "delayed";

export type PaymentOrder = {
  providerCode: string;
  providerOrderRef: string;
  idempotencyKey: string;
  amountPaise: number;
  currency: "INR";
  status: PaymentProviderStatus;
};

export type PaymentRefund = {
  providerCode: string;
  providerRefundRef: string;
  idempotencyKey: string;
  amountPaise: number;
  status: "pending" | "confirmed" | "failed";
};

export interface PaymentProvider {
  readonly code: string;
  createOrder(input: { invoiceRef: string; amountPaise: number; method: string; idempotencyKey: string }): Promise<PaymentOrder>;
  getOrder(input: { providerOrderRef: string }): Promise<PaymentOrder>;
  refund(input: { providerTxnRef: string; amountPaise: number; idempotencyKey: string }): Promise<PaymentRefund>;
}

/** Deterministic local provider used by demo/contract tests.  Production
 * providers are injected behind this exact interface in Slice 6. */
export function createLocalSandboxPaymentProvider(): PaymentProvider {
  const orders = new Map<string, PaymentOrder>();
  const refunds = new Map<string, PaymentRefund>();
  return {
    code: "sandbox",
    async createOrder(input) {
      const existing = orders.get(input.idempotencyKey);
      if (existing) return { ...existing };
      const order: PaymentOrder = {
        providerCode: "sandbox",
        providerOrderRef: `sbx_${input.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)}`,
        idempotencyKey: input.idempotencyKey,
        amountPaise: input.amountPaise,
        currency: "INR",
        status: "created",
      };
      orders.set(input.idempotencyKey, order);
      return { ...order };
    },
    async getOrder(input) {
      const order = [...orders.values()].find((candidate) => candidate.providerOrderRef === input.providerOrderRef);
      if (!order) throw new Error("sandbox payment order not found");
      return { ...order };
    },
    async refund(input) {
      const existing = refunds.get(input.idempotencyKey);
      if (existing) return { ...existing };
      const refund: PaymentRefund = { providerCode: "sandbox", providerRefundRef: `sbr_${input.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)}`, idempotencyKey: input.idempotencyKey, amountPaise: input.amountPaise, status: "confirmed" };
      refunds.set(input.idempotencyKey, refund);
      return { ...refund };
    },
  };
}

/** Class form used by provider contract suites that need to inspect state. */
export class FakePaymentProvider implements PaymentProvider {
  readonly code = "fake";
  readonly orders = new Map<string, PaymentOrder>();
  readonly refunds = new Map<string, PaymentRefund>();

  async createOrder(input: { invoiceRef: string; amountPaise: number; method: string; idempotencyKey: string }): Promise<PaymentOrder> {
    const existing = this.orders.get(input.idempotencyKey);
    if (existing) return { ...existing };
    const order: PaymentOrder = { providerCode: this.code, providerOrderRef: `fake-order-${this.orders.size + 1}`, idempotencyKey: input.idempotencyKey, amountPaise: input.amountPaise, currency: "INR", status: "created" };
    this.orders.set(input.idempotencyKey, order);
    return { ...order };
  }

  async getOrder(input: { providerOrderRef: string }): Promise<PaymentOrder> {
    const order = [...this.orders.values()].find((candidate) => candidate.providerOrderRef === input.providerOrderRef);
    if (!order) throw new Error("fake payment order not found");
    return { ...order };
  }

  async refund(input: { providerTxnRef: string; amountPaise: number; idempotencyKey: string }): Promise<PaymentRefund> {
    const existing = this.refunds.get(input.idempotencyKey);
    if (existing) return { ...existing };
    const refund: PaymentRefund = { providerCode: this.code, providerRefundRef: `fake-refund-${this.refunds.size + 1}`, idempotencyKey: input.idempotencyKey, amountPaise: input.amountPaise, status: "confirmed" };
    this.refunds.set(input.idempotencyKey, refund);
    return { ...refund };
  }
}
