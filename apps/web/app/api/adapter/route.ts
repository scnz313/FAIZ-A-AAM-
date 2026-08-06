import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerActor, type ServerActor } from "@/lib/auth/actor";
import { dataAdapter } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";
import {
  admissionCreateDraft,
  admissionDecide,
  admissionListMine,
  admissionListStaffQueue,
  admissionRequestChanges,
  admissionRespondOffer,
  admissionReviewAdvance,
  admissionSubmit,
  enrollmentConvert,
  financeListMyInvoices,
  financeListMyReceipts,
  financePostPayment,
  resolveFamilyContext,
  resolveStaffContext,
  resultsListBatches,
  resultsPublish,
  timetableListVersions,
  timetablePublish,
} from "@/lib/supabase/domain";
import type { ServiceResult } from "@fass/contracts";

/**
 * Session-protected adapter endpoint (plan.md §10).
 *
 * The client adapter (`modules/services/adapter-client.ts`) calls this route
 * when `FASS_DATA_ADAPTER=supabase`. Every operation is re-authorized
 * server-side: the actor is resolved fresh (never from client claims) and the
 * domain functions enforce role/scope through RLS and the transactional RPCs.
 * The response is always the canonical `ServiceResult<T>` envelope.
 */

const ops = z.discriminatedUnion("op", [
  z.object({ op: z.literal("admissions.listMine"), payload: z.object({}) }),
  z.object({ op: z.literal("admissions.staffQueue"), payload: z.object({}) }),
  z.object({
    op: z.literal("admissions.createDraft"),
    payload: z.object({
      academicYearId: z.string().uuid(),
      gradeId: z.string().uuid(),
      studentName: z.string().min(1),
      parentName: z.string().min(1),
      parentContact: z.string().nullable().optional(),
      draft: z.record(z.unknown()),
      schemaVersion: z.number().int().optional(),
    }),
  }),
  z.object({
    op: z.literal("admissions.submit"),
    payload: z.object({
      applicationId: z.string().uuid(),
      snapshot: z.record(z.unknown()),
      expectedVersion: z.number().int().nonnegative(),
      schemaVersion: z.number().int().optional(),
    }),
  }),
  z.object({
    op: z.literal("admissions.requestChanges"),
    payload: z.object({
      applicationId: z.string().uuid(),
      visibleReason: z.string().min(1),
      privateNote: z.string().nullable().optional(),
    }),
  }),
  z.object({
    op: z.literal("admissions.reviewAdvance"),
    payload: z.object({
      applicationId: z.string().uuid(),
      action: z.enum(["under_review", "assessment"]),
      visibleReason: z.string().nullable().optional(),
      privateNote: z.string().nullable().optional(),
    }),
  }),
  z.object({
    op: z.literal("admissions.decide"),
    payload: z.object({
      applicationId: z.string().uuid(),
      action: z.enum(["offer", "waitlist", "decline"]),
      visibleReason: z.string().nullable().optional(),
      privateNote: z.string().nullable().optional(),
      conditions: z.record(z.unknown()).optional(),
      expiresAt: z.string().nullable().optional(),
    }),
  }),
  z.object({
    op: z.literal("admissions.respondOffer"),
    payload: z.object({
      applicationId: z.string().uuid(),
      response: z.enum(["accepted", "declined"]),
      offerVersion: z.number().int().positive(),
    }),
  }),
  z.object({ op: z.literal("finance.listInvoices"), payload: z.object({}) }),
  z.object({ op: z.literal("finance.listReceipts"), payload: z.object({}) }),
  z.object({
    op: z.literal("finance.postPayment"),
    payload: z.object({
      invoiceRef: z.string().min(1),
      attemptRef: z.string().min(1),
      providerTxnId: z.string().min(1),
      amountPaise: z.number().int().positive(),
      method: z.string().optional(),
    }),
  }),
  z.object({ op: z.literal("enrollment.convert"), payload: z.object({ applicationId: z.string().uuid() }) }),
  z.object({ op: z.literal("results.listBatches"), payload: z.object({}) }),
  z.object({
    op: z.literal("results.publish"),
    payload: z.object({ batchId: z.string().uuid(), expectedVersion: z.number().int().nonnegative() }),
  }),
  z.object({ op: z.literal("timetable.listVersions"), payload: z.object({}) }),
  z.object({
    op: z.literal("timetable.publish"),
    payload: z.object({ versionId: z.string().uuid(), note: z.string().nullable().optional() }),
  }),
  z.object({ op: z.literal("context.family"), payload: z.object({}) }),
  z.object({ op: z.literal("context.staff"), payload: z.object({}) }),
]);

type Op = z.infer<typeof ops>;

async function dispatch(
  supabase: SupabaseClient<Database>,
  actor: ServerActor,
  input: Op,
): Promise<ServiceResult<unknown>> {
  switch (input.op) {
    case "admissions.listMine":
      return admissionListMine(supabase);
    case "admissions.staffQueue":
      return admissionListStaffQueue(supabase);
    case "admissions.createDraft":
      return admissionCreateDraft(supabase, actor.accountId, input.payload);
    case "admissions.submit":
      return admissionSubmit(supabase, input.payload);
    case "admissions.requestChanges":
      return admissionRequestChanges(supabase, input.payload);
    case "admissions.reviewAdvance":
      return admissionReviewAdvance(supabase, input.payload);
    case "admissions.decide":
      return admissionDecide(supabase, input.payload);
    case "admissions.respondOffer":
      return admissionRespondOffer(supabase, input.payload);
    case "finance.listInvoices":
      return financeListMyInvoices(supabase);
    case "finance.listReceipts":
      return financeListMyReceipts(supabase);
    case "finance.postPayment":
      return financePostPayment(supabase, input.payload);
    case "enrollment.convert":
      return enrollmentConvert(supabase, input.payload.applicationId);
    case "results.listBatches":
      return resultsListBatches(supabase);
    case "results.publish":
      return resultsPublish(supabase, input.payload);
    case "timetable.listVersions":
      return timetableListVersions(supabase);
    case "timetable.publish":
      return timetablePublish(supabase, input.payload);
    case "context.family":
      return resolveFamilyContext(supabase);
    case "context.staff":
      return resolveStaffContext(supabase, actor.personId);
  }
}

export async function POST(request: NextRequest) {
  if (dataAdapter() !== "supabase") {
    return NextResponse.json({ ok: false, error: "adapter inactive" }, { status: 503 });
  }

  const actor = await getServerActor();
  if (actor === null) {
    return NextResponse.json(
      { ok: false, errors: [{ code: "unauthenticated", message: "Sign in to continue.", field: null }] },
      { status: 401 },
    );
  }

  let input: Op;
  try {
    input = ops.parse(await request.json());
  } catch {
    return NextResponse.json(
      { ok: false, errors: [{ code: "validation", message: "Invalid operation payload.", field: null }] },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  let result: ServiceResult<unknown>;
  try {
    result = await dispatch(supabase, actor, input);
  } catch {
    result = { ok: false, errors: [{ code: "unavailable", message: "Operation failed.", field: null }] };
  }
  return NextResponse.json(result);
}
