"use client";

import { useEffect, useRef, useState } from "react";

import Button from "@/components/ui/Button";
import { formatINR } from "@/modules/services/finance";
import {
  FinanceServiceError,
  financeService,
  getDemoScenario,
  setDemoScenario,
  type DemoPaymentScenario,
  type PaymentAttempt,
  type Receipt,
} from "@/modules/services/finance";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./PayFlow.module.css";

type CheckoutMethod = "UPI" | "Card" | "Net banking";

/**
 * Checkout states, in order: method → creating → gateway → processing →
 * (succeeded → confirming → success | failed | cancelled | delayed).
 * "error" is a recoverable create/confirm failure; retry starts a NEW
 * attempt (create) or polls again (confirm). "delayed" waits for the
 * duplicate-safe "Check status again" poll.
 */
type FlowStep =
  | "method"
  | "creating"
  | "gateway"
  | "processing"
  | "delayed"
  | "failed"
  | "cancelled"
  | "error"
  | "confirming"
  | "success";

type ErrorKind = "create" | "confirm";

const METHODS: ReadonlyArray<{ key: CheckoutMethod; label: string; helper: string }> = [
  { key: "UPI", label: "UPI", helper: "UPI Intent / QR — pay from any UPI app." },
  { key: "Card", label: "Card", helper: "Credit or debit card, processed by the gateway." },
  { key: "Net banking", label: "Net banking", helper: "Bank accounts supported by the gateway." },
];

/** Deterministic demo-gateway outcomes, selectable without editing code. */
const SCENARIOS: ReadonlyArray<{ key: DemoPaymentScenario; label: string }> = [
  { key: "success", label: "Success" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "delayed", label: "Delayed" },
  { key: "create-fails", label: "Create fails" },
];

/** How long the demo gateway "works" before the next poll returns. */
const GATEWAY_POLL_MS = 1200;

type PayFlowProps = {
  invoiceRef: string;
  term: string;
  /** The invoice balance this checkout pays (validated against the ledger). */
  amountPaise: number;
  /** Balance the invoice will show once this payment posts (normally 0). */
  balanceAfterPaise: number;
  /** Fired once with the NEW receipt reference — the page refreshes the ledger. */
  onSettled: (receiptRef: string) => void;
};

/**
 * Demo checkout island for one invoice, driven by the typed financeService.
 * Step 1 picks a method and the demo scenario; the adapter then owns the
 * attempt: create → gateway handoff → processing → outcome, with failure,
 * cancellation, delayed/unknown and duplicate-safe refresh branches. A
 * confirmed payment posts to the ledger and issues exactly one new receipt,
 * which the success step links to. In production the server creates the
 * gateway order, verifies the signed webhook and posts to the ledger.
 */
export function PayFlow({ invoiceRef, term, amountPaise, balanceAfterPaise, onSettled }: PayFlowProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<FlowStep>("method");
  const [method, setMethod] = useState<CheckoutMethod>("UPI");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [scenario, setScenario] = useState<DemoPaymentScenario>(() => supabaseMode ? "success" : getDemoScenario());
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>("create");
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const attemptRef = useRef<PaymentAttempt | null>(null);
  const regionRef = useRef<HTMLElement>(null);

  // Snapshot the amount the flow was opened for: after a successful payment
  // the page's balance becomes 0 and this prop changes under the success step.
  const [flowAmountPaise] = useState(amountPaise);

  // Demo polling: the gateway handoff and processing states advance after a
  // short interval. "delayed" never auto-advances — it waits for the user's
  // duplicate-safe "Check status again".
  useEffect(() => {
    if (step !== "gateway" && step !== "processing") return;
    if (supabaseMode) {
      void pollGateway();
      return;
    }
    const timer = setTimeout(() => {
      void pollGateway();
    }, GATEWAY_POLL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Move focus into the island whenever the flow leaves the method step, so
  // keyboard and screen-reader users follow every state change.
  useEffect(() => {
    if (step !== "method") regionRef.current?.focus();
  }, [step]);

  async function pollGateway(): Promise<void> {
    const current = attemptRef.current;
    if (!current || busy) return;
    setBusy(true);
    try {
      const next = await financeService.refreshAttempt(current.id);
      attemptRef.current = next;
      setAttempt(next);
      switch (next.status) {
        case "created":
          setStep("gateway");
          break;
        case "processing":
          setStep("processing");
          break;
        case "delayed":
          setStep("delayed");
          break;
        case "failed":
          setStep("failed");
          break;
        case "cancelled":
          setStep("cancelled");
          break;
        case "succeeded":
          await confirmSettlement(next);
          break;
      }
    } catch (error) {
      setErrorMessage(
        error instanceof FinanceServiceError
          ? error.message
          : "The payment gateway could not be reached. Check status again shortly.",
      );
      setErrorKind("confirm");
      setStep("error");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSettlement(settledAttempt: PaymentAttempt): Promise<void> {
    setStep("confirming");
    try {
      const pair = await financeService.confirmSuccess(settledAttempt.id);
      setReceipt(pair.receipt);
      setStep("success");
      onSettled(pair.receipt.ref);
    } catch (error) {
      setErrorMessage(
        error instanceof FinanceServiceError
          ? error.message
          : "The payment was confirmed but the receipt could not be issued. Check status again.",
      );
      setErrorKind("confirm");
      setStep("error");
    }
  }

  async function startCheckout(): Promise<void> {
    setStep("creating");
    setErrorMessage("");
    try {
      const created = await financeService.createPaymentAttempt(invoiceRef, method, flowAmountPaise, supabaseMode ? crypto.randomUUID() : undefined);
      attemptRef.current = created;
      setAttempt(created);
      setStep("gateway");
    } catch (error) {
      setErrorMessage(
        error instanceof FinanceServiceError
          ? error.message
          : "The payment gateway could not be reached. Please try again.",
      );
      setErrorKind("create");
      setStep("error");
    }
  }

  /** Retry the failing step: a NEW attempt after create failure, a poll after confirm failure. */
  function retry(): void {
    if (errorKind === "create") void startCheckout();
    else void pollGateway();
  }

  function closePanel(): void {
    setOpen(false);
    setStep("method");
    attemptRef.current = null;
    setAttempt(null);
    setReceipt(null);
    setErrorMessage("");
  }

  const liveText = (() => {
    switch (step) {
      case "creating":
        return "Contacting the payment gateway…";
      case "gateway":
        return supabaseMode ? "Handing off to the local sandbox…" : "Handing off to the Demo gateway…";
      case "processing":
        return supabaseMode ? "Processing with the local sandbox — this takes a few seconds." : "Processing with the Demo gateway — this takes a few seconds.";
      case "delayed":
        return "The gateway has not confirmed the payment — we will confirm shortly.";
      case "failed":
        return `Payment failed — ${attempt?.failureReason ?? "the gateway declined the transaction"}.`;
      case "cancelled":
        return "Payment cancelled — you left the gateway before it was confirmed.";
      case "error":
        return errorMessage;
      case "confirming":
        return "Recording the payment with the school server…";
      case "success":
        return receipt ? `Payment recorded — receipt ${receipt.ref}.` : "Payment recorded.";
      default:
        return "";
    }
  })();

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        Pay {formatINR(flowAmountPaise)} →
      </Button>
    );
  }

  return (
    <section
      ref={regionRef}
      tabIndex={-1}
      className={styles.flow}
      aria-labelledby="payflow-title"
      aria-busy={step === "creating" || step === "gateway" || step === "processing" || step === "confirming"}
    >
      <p className={styles.liveLine} aria-live="polite">
        {liveText}
      </p>
      <div className={styles.flowHead}>
        <p className="section-label">Checkout · {term}</p>
        <span className="demo-badge">{supabaseMode ? "Local sandbox" : "Demo checkout"}</span>
      </div>
      <h3 id="payflow-title" className={styles.flowTitle}>
        Pay {formatINR(flowAmountPaise)}
      </h3>
      <p className={styles.flowRef}>
        Invoice <span className="num">{invoiceRef}</span>
      </p>

      {step === "method" ? (
        <>
          <fieldset className={styles.methodList}>
            <legend className={styles.methodLegend}>Payment method</legend>
            {METHODS.map((option) => (
              <label key={option.key} className={styles.methodOption}>
                <input
                  type="radio"
                  name="payflow-method"
                  value={option.key}
                  checked={method === option.key}
                  onChange={() => setMethod(option.key)}
                />
                <span className={styles.methodCopy}>
                  <strong>{option.label}</strong>
                  <small>{option.helper}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {!supabaseMode ? <div className={styles.scenario}>
            <label htmlFor="payflow-scenario">
              Demo scenario <span className={styles.scenarioTag}>(demo scenario)</span>
            </label>
            <select
              id="payflow-scenario"
              className="select"
              value={scenario}
              onChange={(event) => {
                const next = event.target.value as DemoPaymentScenario;
                setScenario(next);
                setDemoScenario(next);
              }}
            >
              {SCENARIOS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div> : null}

          <p className={styles.flowNote}>
            The school never stores card or UPI credentials — the gateway handles the payment.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void startCheckout()}>
              Continue to checkout
            </Button>
            <Button variant="quiet" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </>
      ) : null}

      {step === "creating" || step === "confirming" ? (
        <div className={styles.processing}>
          <p className={styles.processingLine}>
            {step === "creating" ? "Contacting the payment gateway…" : "Recording your payment…"}
          </p>
          <p className={styles.processingNote}>
            {step === "creating"
              ? supabaseMode ? "Creating a payment attempt in the local sandbox." : "Creating a payment attempt with the Demo gateway."
              : "The school server is posting the payment and issuing the receipt — this happens exactly once."}
          </p>
        </div>
      ) : null}

      {step === "gateway" || step === "processing" ? (
        <div className={styles.processing}>
          <p className={styles.processingLine}>
            {step === "gateway" ? (supabaseMode ? "Handing off to the local sandbox…" : "Handing off to the Demo gateway…") : "Processing…"}
          </p>
          <p className={styles.processingNote}>
            {step === "gateway"
              ? supabaseMode ? "Your payment is with the local sandbox. Keep this window open — the result is confirmed here." : "Your payment is with the Demo gateway. Keep this window open — the result is confirmed here."
              : "Your payment is confirmed only when the school server verifies it with the gateway."}
          </p>
        </div>
      ) : null}

      {step === "delayed" ? (
        <div className={styles.stateBlock}>
          <p className={styles.stateTitle}>Payment delayed</p>
          <p className={styles.stateText}>
            The gateway has not confirmed your payment yet. We will confirm shortly — nothing is posted to the
            ledger until it does.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void pollGateway()} disabled={busy}>
              {busy ? "Checking…" : "Check status again"}
            </Button>
            <Button variant="quiet" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {step === "failed" ? (
        <div className={styles.stateBlock}>
          <p className={styles.stateTitle}>Payment failed</p>
          <p className={styles.stateText}>{attempt?.failureReason ?? "The gateway declined the transaction."}</p>
          <p className={styles.stateText}>No money was taken and nothing was posted to the ledger.</p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void startCheckout()}>
              Try again
            </Button>
            <Button variant="quiet" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {step === "cancelled" ? (
        <div className={styles.stateBlock}>
          <p className={styles.stateTitle}>Payment cancelled</p>
          <p className={styles.stateText}>
            You left the gateway before the payment was confirmed. Nothing was posted to the ledger.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void startCheckout()}>
              Try again
            </Button>
            <Button variant="quiet" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {step === "error" ? (
        <div className={styles.stateBlock}>
          <p className={styles.stateTitle}>
            {errorKind === "create" ? "Payment could not be started" : "Payment could not be confirmed"}
          </p>
          <p className={styles.stateText}>{errorMessage}</p>
          <p className={styles.stateText}>
            {errorKind === "create"
              ? "No payment attempt was created — nothing was charged."
              : "The attempt itself was not duplicated — checking again is safe."}
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={retry}>
              Try again
            </Button>
            <Button variant="quiet" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {step === "success" && receipt ? (
        <div className={styles.success}>
          <p className={styles.successMark} aria-hidden="true">
            ✓
          </p>
          <p className={styles.successTitle}>Payment recorded{!supabaseMode ? " — demo" : ""}</p>
          <dl className={styles.successMeta}>
            <div>
              <dt>Payment</dt>
              <dd className="num">{attempt?.id}</dd>
            </div>
            <div>
              <dt>Receipt</dt>
              <dd className="num">{receipt.ref}</dd>
            </div>
            <div>
              <dt>Invoice</dt>
              <dd className="num">{invoiceRef}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd className="num">{formatINR(receipt.amountPaise)}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>{receipt.method}</dd>
            </div>
            <div>
              <dt>Balance remaining</dt>
              <dd className="num">{formatINR(balanceAfterPaise)}</dd>
            </div>
          </dl>
          <p className={styles.flowNote}>
            {supabaseMode ? "Local sandbox evidence is recorded by the server; the gateway provider remains deferred." : "Demo — in production this redirects to the gateway and verifies the signed webhook before posting to the ledger exactly once."}
          </p>
          <p className={styles.successLinks}>
            <a className="link-arrow" href={`/portal/receipts/${receipt.ref}`}>
              View receipt {receipt.ref} →
            </a>
            <a className="link-arrow" href="/portal/fees">
              Back to the fee ledger →
            </a>
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default PayFlow;
