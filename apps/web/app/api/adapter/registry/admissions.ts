import { z } from "zod";

import {
  admissionCreateDraft,
  admissionDecide,
  admissionListMine,
  admissionListStaffQueue,
  admissionRequestChanges,
  admissionRespondOffer,
  admissionReviewAdvance,
  admissionSaveDraft,
  admissionSubmit,
  admissionWithdraw,
  contextFamilySelect,
  enrollmentConvert,
  enrollmentReadiness,
  resolveFamilyContext,
} from "@/lib/supabase/domain";

import { emptyPayload, jsonObject, operation, publicReference, uuid } from "./common";
import type { AdapterModule } from "./types";

const targetFields = {
  applicationId: uuid.optional(),
  applicationRef: publicReference.optional(),
};
const target = z.object(targetFields).refine((value) => value.applicationId !== undefined || value.applicationRef !== undefined, "application reference is required");

const applicationTarget = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...targetFields, ...shape }).refine((value) => value.applicationId !== undefined || value.applicationRef !== undefined, "application reference is required");

export const admissionsModule: AdapterModule = {
  domain: "admissions",
  operations: [
    operation("admissions.listMine", emptyPayload, ({ supabase }) => admissionListMine(supabase)),
    operation("admissions.staffQueue", emptyPayload, ({ supabase }) => admissionListStaffQueue(supabase)),
    operation(
      "admissions.saveDraft",
      z.object({
        applicationId: uuid.nullable().optional(),
        applicationRef: publicReference.optional(),
        academicYearId: uuid.nullable().optional(),
        academicYearRef: publicReference.optional(),
        gradeId: uuid.nullable().optional(),
        gradeRef: publicReference.optional(),
        studentName: z.string().nullable().optional(),
        parentName: z.string().nullable().optional(),
        parentContact: z.string().nullable().optional(),
        draft: jsonObject,
        schemaVersion: z.number().int().positive().optional(),
        expectedVersion: z.number().int().nonnegative().nullable().optional(),
        expectedDraftVersion: z.number().int().positive().nullable().optional(),
      }),
      ({ supabase }, payload) => admissionSaveDraft(supabase, payload as Parameters<typeof admissionSaveDraft>[1]),
    ),
    operation(
      "admissions.createDraft",
      z.object({
        academicYearId: uuid.optional(),
        academicYearRef: publicReference.optional(),
        gradeId: uuid.optional(),
        gradeRef: publicReference.optional(),
        studentName: z.string().min(1),
        parentName: z.string().min(1),
        parentContact: z.string().nullable().optional(),
        draft: jsonObject,
        schemaVersion: z.number().int().optional(),
      }).refine((value) => (value.academicYearId ?? value.academicYearRef) !== undefined && (value.gradeId ?? value.gradeRef) !== undefined, "academic year and grade reference are required"),
      ({ supabase, actor }, payload) => admissionCreateDraft(supabase, actor.accountId, payload as Parameters<typeof admissionCreateDraft>[2]),
    ),
    operation(
      "admissions.submit",
      applicationTarget({ snapshot: jsonObject, expectedVersion: z.number().int().nonnegative(), schemaVersion: z.number().int().optional() }),
      ({ supabase }, payload) => admissionSubmit(supabase, payload as Parameters<typeof admissionSubmit>[1]),
    ),
    operation(
      "admissions.requestChanges",
      applicationTarget({ visibleReason: z.string().min(1), privateNote: z.string().nullable().optional(), expectedVersion: z.number().int().nonnegative().nullable().optional() }),
      ({ supabase }, payload) => admissionRequestChanges(supabase, payload as Parameters<typeof admissionRequestChanges>[1]),
    ),
    operation(
      "admissions.reviewAdvance",
      applicationTarget({ action: z.enum(["under_review", "assessment"]), visibleReason: z.string().nullable().optional(), privateNote: z.string().nullable().optional(), expectedVersion: z.number().int().nonnegative().nullable().optional() }),
      ({ supabase }, payload) => admissionReviewAdvance(supabase, payload as Parameters<typeof admissionReviewAdvance>[1]),
    ),
    operation(
      "admissions.decide",
      applicationTarget({
        action: z.enum(["offer", "waitlist", "decline"]),
        visibleReason: z.string().nullable().optional(),
        privateNote: z.string().nullable().optional(),
        conditions: jsonObject.optional(),
        expiresAt: z.string().nullable().optional(),
        expectedVersion: z.number().int().nonnegative().nullable().optional(),
      }),
      ({ supabase }, payload) => admissionDecide(supabase, payload as Parameters<typeof admissionDecide>[1]),
    ),
    operation(
      "admissions.respondOffer",
      applicationTarget({ response: z.enum(["accepted", "declined"]), offerVersion: z.number().int().positive() }),
      ({ supabase }, payload) => admissionRespondOffer(supabase, payload as Parameters<typeof admissionRespondOffer>[1]),
    ),
    operation(
      "admissions.withdraw",
      applicationTarget({ expectedVersion: z.number().int().nonnegative().nullable().optional(), idempotencyKey: z.string().min(3).optional() }),
      ({ supabase }, payload) => admissionWithdraw(supabase, payload as Parameters<typeof admissionWithdraw>[1]),
    ),
    operation(
      "enrollment.readiness",
      target,
      ({ supabase }, payload) => enrollmentReadiness(supabase, payload.applicationId!),
    ),
    operation(
      "enrollment.convert",
      target,
      ({ supabase }, payload) => enrollmentConvert(supabase, payload.applicationId!),
    ),
    operation(
      "context.family",
      z.object({ studentId: uuid.optional(), studentRef: publicReference.optional() }),
      async ({ supabase, actor, selection }, payload) => {
        if (payload.studentId !== undefined) {
          const persisted = await contextFamilySelect(supabase, { studentId: payload.studentId });
          if (!persisted.ok) return persisted;
        }
        return resolveFamilyContext(supabase, { studentId: payload.studentId ?? selection.familyStudentId }, actor);
      },
    ),
    operation(
      "context.family.select",
      z.object({ studentId: uuid, expectedVersion: z.number().int().nonnegative().optional() }),
      ({ supabase }, payload) => contextFamilySelect(supabase, payload),
    ),
  ],
};
