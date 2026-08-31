import { z } from "zod";

import {
  financeApproveAdjustment,
  financeApproveRefund,
  financeApplyConcession,
  financeCreateAttempt,
  financeGetAttempt,
  financeImportReconciliation,
  financeIssueAdmissionInvoice,
  financeListAdjustments,
  financeListAllAttempts,
  financeListAttempts,
  financeListMyInvoices,
  financeListMyReceipts,
  financeListReconciliationProjection,
  financeListRefunds,
  financePostPayment,
  financePostAdjustment,
  financePostRefund,
  financeRefreshAttempt,
  financeRequestRefund,
  financeResolveReconciliation,
  financeStartReconciliation,
} from "@/lib/supabase/domain";

import { emptyPayload, jsonObject, operation, publicReference, uuid } from "./common";
import type { AdapterModule } from "./types";

export const financeModule: AdapterModule = {
  domain: "finance",
  operations: [
    operation("finance.listInvoices", emptyPayload, ({ supabase }) => financeListMyInvoices(supabase)),
    operation("finance.listReceipts", emptyPayload, ({ supabase }) => financeListMyReceipts(supabase)),
    operation("finance.listAdjustments", emptyPayload, ({ supabase }) => financeListAdjustments(supabase)),
    operation("finance.listRefunds", emptyPayload, ({ supabase }) => financeListRefunds(supabase)),
    operation(
      "finance.listAttempts",
      z.object({ invoiceRef: publicReference }),
      ({ supabase }, payload) => financeListAttempts(supabase, payload.invoiceRef),
    ),
    operation("finance.listAllAttempts", emptyPayload, ({ supabase }) => financeListAllAttempts(supabase)),
    operation("finance.getAttempt", z.object({ attemptRef: publicReference }), ({ supabase }, payload) => financeGetAttempt(supabase, payload.attemptRef)),
    operation(
      "finance.postPayment",
      z.object({ invoiceRef: publicReference, attemptRef: publicReference, providerTxnId: z.string().min(1), amountPaise: z.number().int().positive(), method: z.string().optional() }),
      ({ supabase }, payload) => financePostPayment(supabase, payload),
    ),
    operation(
      "finance.issueAdmissionInvoice",
      z.object({ applicationId: uuid.optional(), applicationRef: publicReference.optional(), scheduleVersionId: uuid.nullable().optional(), scheduleVersionRef: publicReference.nullable().optional() }).refine((value) => value.applicationId !== undefined || value.applicationRef !== undefined, "application reference is required"),
      ({ supabase }, payload) => financeIssueAdmissionInvoice(supabase, payload as Parameters<typeof financeIssueAdmissionInvoice>[1]),
    ),
    operation(
      "finance.applyConcession",
      z.object({ invoiceId: uuid.optional(), invoiceRef: publicReference.optional(), amountPaise: z.number().int().positive(), reason: z.string().min(1), type: z.enum(["concession", "adjustment", "write_off"]), expectedVersion: z.number().int().nonnegative().optional(), idempotencyKey: z.string().min(3).optional() }).refine((value) => value.invoiceId !== undefined || value.invoiceRef !== undefined, "invoice reference is required"),
      ({ supabase }, payload) => financeApplyConcession(supabase, payload as Parameters<typeof financeApplyConcession>[1]),
    ),
    operation(
      "finance.requestRefund",
      z.object({ paymentId: uuid.optional(), paymentRef: publicReference.optional(), amountPaise: z.number().int().positive(), reason: z.string().min(1), expectedVersion: z.number().int().positive().optional(), idempotencyKey: z.string().min(3).optional() }).refine((value) => value.paymentId !== undefined || value.paymentRef !== undefined, "payment reference is required"),
      ({ supabase }, payload) => financeRequestRefund(supabase, payload as Parameters<typeof financeRequestRefund>[1]),
    ),
    operation("finance.approveAdjustment", z.object({ adjustmentId: uuid, expectedVersion: z.number().int().positive(), approve: z.boolean(), reason: z.string().nullable().optional() }), ({ supabase }, payload) => financeApproveAdjustment(supabase, payload)),
    operation("finance.postAdjustment", z.object({ adjustmentId: uuid, expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(3).optional() }), ({ supabase }, payload) => financePostAdjustment(supabase, payload)),
    operation("finance.approveRefund", z.object({ refundRequestId: uuid, expectedVersion: z.number().int().positive(), approve: z.boolean(), reason: z.string().nullable().optional() }), ({ supabase }, payload) => financeApproveRefund(supabase, payload)),
    operation("finance.postRefund", z.object({ refundRequestId: uuid, expectedVersion: z.number().int().positive(), providerRef: z.string().nullable().optional() }), ({ supabase }, payload) => financePostRefund(supabase, payload)),
    operation("finance.startReconciliation", z.object({ idempotencyKey: z.string().min(3).optional() }), ({ supabase }, payload) => financeStartReconciliation(supabase, payload.idempotencyKey)),
    operation("finance.importReconciliation", z.object({ runId: uuid, evidence: z.array(jsonObject), expectedVersion: z.number().int().positive().optional(), idempotencyKey: z.string().min(3).optional() }), ({ supabase }, payload) => financeImportReconciliation(supabase, { ...payload, evidence: payload.evidence as never })),
    operation("finance.resolveReconciliation", z.object({ exceptionId: uuid, resolutionReason: z.string().min(3), expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(3).optional() }), ({ supabase }, payload) => financeResolveReconciliation(supabase, payload)),
    operation("finance.listReconciliationRuns", emptyPayload, ({ supabase }) => financeListReconciliationProjection(supabase)),
    operation(
      "finance.createAttempt",
      z.object({ invoiceRef: publicReference, amountPaise: z.number().int().positive(), method: z.string().min(1), idempotencyKey: z.string().min(3).optional(), providerCode: z.string().min(1).optional() }),
      ({ supabase }, payload) => financeCreateAttempt(supabase, payload),
    ),
    operation(
      "finance.refreshAttempt",
      z.object({ attemptRef: publicReference, expectedVersion: z.number().int().positive().optional() }),
      ({ supabase }, payload) => financeRefreshAttempt(supabase, payload.attemptRef, payload.expectedVersion),
    ),
  ],
};
