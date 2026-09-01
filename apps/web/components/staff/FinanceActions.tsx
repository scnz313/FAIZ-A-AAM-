"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { formatINR, financeService, type AdjustmentRequest, type InvoiceView, type RefundRequest } from "@/modules/services/finance";

import styles from "./FinanceActions.module.css";

const APPROVAL_TONE: Record<AdjustmentRequest["status"], "good" | "watch" | "alert" | "neutral"> = {
  pending: "watch",
  approved: "good",
  rejected: "alert",
  posted: "neutral",
};

/**
 * Staff finance actions (plan L1.2): maker/checker adjustment and refund
 * workflows with an explicit fictional demo policy marker. Finance officers
 * request; finance approvers decide; posting appends signed ledger entries
 * that both the family portal and the staff ledger read.
 */
export function FinanceActions({
  views,
  mode = "demo",
  onLedgerChanged,
}: {
  views: InvoiceView[];
  mode?: "demo" | "supabase";
  onLedgerChanged?: () => Promise<void>;
}) {
  const { summary } = useStaffContext();
  const canOperate = canAnyRole(summary?.roles ?? [], "finance.operate");
  const canApprove = canAnyRole(summary?.roles ?? [], "finance.approve");
  const actor = summary?.accountId ?? "demo-officer";

  const [adjustments, setAdjustments] = useState<AdjustmentRequest[]>([]);
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /* Adjustment form state. */
  const [adjustType, setAdjustType] = useState<"concession" | "adjustment" | "write_off">("concession");
  const [adjustInvoice, setAdjustInvoice] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  /* Refund form state. */
  const [refundPayment, setRefundPayment] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  /* Decision state. */
  const [decidingRef, setDecidingRef] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const refresh = () => {
    void financeService.listAdjustments().then(setAdjustments).catch(() => setAdjustments([]));
    void financeService.listRefunds().then(setRefunds).catch(() => setRefunds([]));
  };

  useEffect(() => {
    refresh();
  }, []);

  const payments = Array.from(
    new Map(
      views.flatMap((view) =>
        view.invoice.payments.map((payment) => [payment.ref, { ...payment, studentName: view.studentName }] as const),
      ),
    ).values(),
  );

  function announce(text: string) {
    setMessage(text);
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const request = await financeService.requestAdjustment({
        invoiceRef: adjustInvoice,
        amountPaise: Math.round(Number(adjustAmount) * 100),
        reason: adjustReason,
        type: adjustType,
        requestedBy: actor,
      });
      announce(`${request.ref} requested — awaiting finance approver.`);
      setAdjustAmount("");
      setAdjustReason("");
      refresh();
    } catch (error) {
      announce(error instanceof Error ? error.message : "Adjustment could not be requested.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const request = await financeService.requestRefund({
        paymentRef: refundPayment,
        amountPaise: Math.round(Number(refundAmount) * 100),
        reason: refundReason,
        requestedBy: actor,
      });
      announce(`${request.ref} requested — awaiting finance approver.`);
      setRefundAmount("");
      setRefundReason("");
      refresh();
    } catch (error) {
      announce(error instanceof Error ? error.message : "Refund could not be requested.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(ref: string, kind: "adjustment" | "refund", approve: boolean) {
    setBusy(true);
    setMessage(null);
    setDecisionError(null);
    try {
      if (kind === "adjustment") {
        await financeService.approveAdjustment({ ref, approve, reason: decisionReason, decidedBy: actor });
      } else {
        await financeService.approveRefund({ ref, approve, reason: decisionReason, decidedBy: actor });
      }
      announce(`${ref} ${approve ? "approved" : "rejected"}.`);
      setDecidingRef(null);
      setDecisionReason("");
      refresh();
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : "The decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function post(ref: string, kind: "adjustment" | "refund") {
    setBusy(true);
    setMessage(null);
    try {
      if (kind === "adjustment") {
        const posted = await financeService.postAdjustment({ ref, postedBy: actor });
        announce(`${ref} posted — balance updated on the shared ledger.`);
        void posted;
      } else {
        const posted = await financeService.postRefund({ ref, postedBy: actor });
        announce(`${ref} posted through the sandbox provider — original receipt stays on record.`);
        void posted;
      }
      await onLedgerChanged?.();
      refresh();
    } catch (error) {
      announce(error instanceof Error ? error.message : "Posting failed.");
    } finally {
      setBusy(false);
    }
  }

  const pendingAdjustments = adjustments.filter((request) => request.status === "pending");
  const pendingRefunds = refunds.filter((request) => request.status === "pending");
  const decisionTarget = decidingRef === null ? null : [...adjustments, ...refunds].find((request) => request.ref === decidingRef);

  return (
    <section className="panel" aria-labelledby="finance-actions-heading">
      <div className={styles.sectionHead}>
        <h2 id="finance-actions-heading" className="section-label">
          Adjustments &amp; refunds
        </h2>
        <StatusBadge tone="watch">{mode === "supabase" ? "Policy-controlled workflow" : "Fictional demo policy"}</StatusBadge>
      </div>

      <p className={styles.intro}>
        {mode === "supabase"
          ? "Officer requests and approver decisions follow maker/checker separation; posting appends authoritative signed ledger entries. Online refund provider activity remains in the local sandbox."
          : "Officer requests and approver decisions follow maker/checker separation; posting appends signed ledger entries that never rewrite invoice items or payment history (demo rules — the school’s real policy is still pending)."}
      </p>

      <div className={styles.grid}>
        {canOperate ? (
          <>
            <form className={styles.panel} onSubmit={submitAdjustment} noValidate>
              <h3 className="section-label">Request an adjustment</h3>
              <div className="field">
                <label htmlFor="adjust-invoice">Invoice</label>
                <select
                  id="adjust-invoice"
                  className="select"
                  value={adjustInvoice}
                  onChange={(event) => setAdjustInvoice(event.target.value)}
                  required
                >
                  <option value="">Select an invoice…</option>
                  {views.map((view) => (
                    <option key={view.invoice.ref} value={view.invoice.ref}>
                      {view.invoice.ref} · {view.studentName} · {formatINR(view.balancePaise)} outstanding
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="adjust-type">Type</label>
                <select
                  id="adjust-type"
                  className="select"
                  value={adjustType}
                  onChange={(event) => setAdjustType(event.target.value as typeof adjustType)}
                >
                  <option value="concession">Concession</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="write_off">Write-off</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="adjust-amount">Amount (₹)</label>
                <input
                  id="adjust-amount"
                  className={`input num ${styles.amountInput}`}
                  type="number"
                  min={1}
                  step="0.01"
                  value={adjustAmount}
                  onChange={(event) => setAdjustAmount(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="adjust-reason">Reason (recorded in the ledger)</label>
                <textarea
                  id="adjust-reason"
                  className="textarea"
                  rows={2}
                  value={adjustReason}
                  onChange={(event) => setAdjustReason(event.target.value)}
                  required
                />
              </div>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Requesting…" : "Request adjustment"}
              </Button>
            </form>

            <form className={styles.panel} onSubmit={submitRefund} noValidate>
              <h3 className="section-label">Request a refund</h3>
              <div className="field">
                <label htmlFor="refund-payment">Payment</label>
                <select
                  id="refund-payment"
                  className="select"
                  value={refundPayment}
                  onChange={(event) => setRefundPayment(event.target.value)}
                  required
                >
                  <option value="">Select a posted payment…</option>
                  {payments.map((payment) => (
                    <option key={payment.ref} value={payment.ref}>
                      {payment.ref} · {payment.studentName} · {formatINR(payment.amountPaise)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="refund-amount">Amount (₹)</label>
                <input
                  id="refund-amount"
                  className={`input num ${styles.amountInput}`}
                  type="number"
                  min={1}
                  step="0.01"
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="refund-reason">Reason (recorded in the ledger)</label>
                <textarea
                  id="refund-reason"
                  className="textarea"
                  rows={2}
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  required
                />
              </div>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Requesting…" : "Request refund"}
              </Button>
            </form>
          </>
        ) : (
          <p className={styles.readOnly}>
            Requesting adjustments and refunds requires the Finance officer workspace.
          </p>
        )}

        <div className={styles.history}>
          <h3 className="section-label">Approval queue</h3>
          {pendingAdjustments.length === 0 && pendingRefunds.length === 0 ? (
            <p className={styles.empty}>No pending adjustment or refund requests.</p>
          ) : (
            <>
              {[...pendingAdjustments, ...pendingRefunds].map((request) => {
                const isRefund = "paymentRef" in request;
                return (
                <div key={request.ref} className={styles.requestRow}>
                  <div className={styles.requestCopy}>
                    <p>
                      <strong>{request.ref}</strong> ·{" "}
                      {isRefund
                        ? `refund of ${formatINR(request.amountPaise)} on ${request.paymentRef}`
                        : `${request.type} of ${formatINR(request.amountPaise)}`}
                    </p>
                    <small>
                      {request.reason} · requested by {request.requestedBy}
                    </small>
                  </div>
                  <StatusBadge tone={APPROVAL_TONE[request.status]}>{request.status}</StatusBadge>
                  {canApprove && request.status === "pending" ? (
                    <div className={styles.decide}>
                      <input
                        className="input"
                        type="text"
                        placeholder="Decision reason (required)"
                        value={decidingRef === request.ref ? decisionReason : ""}
                        onChange={(event) => {
                          setDecidingRef(request.ref);
                          setDecisionReason(event.target.value);
                          setDecisionError(null);
                        }}
                        aria-label={`Decision reason for ${request.ref}`}
                      />
                      <div className={styles.decideActions}>
                        <Button variant="primary" disabled={busy || decidingRef !== request.ref} onClick={() => void decide(request.ref, isRefund ? "refund" : "adjustment", true)}>
                          Approve
                        </Button>
                        <Button variant="danger" disabled={busy || decidingRef !== request.ref} onClick={() => void decide(request.ref, isRefund ? "refund" : "adjustment", false)}>
                          Reject
                        </Button>
                      </div>
                      {decidingRef === request.ref && decisionError ? (
                        <p className={styles.error} role="alert">
                          {decisionError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {canOperate && request.status === "approved" ? (
                    <Button variant="quiet" disabled={busy} onClick={() => void post(request.ref, isRefund ? "refund" : "adjustment")}>
                      Post to ledger
                    </Button>
                  ) : null}
                </div>
                );
              })}
            </>
          )}

          {adjustments.length > 0 || refunds.length > 0 ? (
            <h3 className={styles.historyLabel}>History</h3>
          ) : null}
          {[...adjustments, ...refunds]
            .filter((request) => request.status !== "pending")
            .slice(0, 8)
            .map((request) => {
              const isRefund = "paymentRef" in request;
              return (
              <div key={request.ref} className={styles.requestRow}>
                <div className={styles.requestCopy}>
                  <p>
                    <strong>{request.ref}</strong> · {request.status} · {formatINR(request.amountPaise)}
                  </p>
                  <small>
                    {request.reason}
                    {request.decisionReason ? ` · ${request.decisionReason}` : ""}
                  </small>
                </div>
                <StatusBadge tone={APPROVAL_TONE[request.status]}>{request.status}</StatusBadge>
                {canOperate && request.status === "approved" ? (
                  <Button variant="quiet" disabled={busy} onClick={() => void post(request.ref, isRefund ? "refund" : "adjustment")}>
                    Post to ledger
                  </Button>
                ) : null}
              </div>
              );
            })}
        </div>
      </div>

      <p className={styles.live} role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
