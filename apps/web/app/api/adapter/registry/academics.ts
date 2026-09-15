import { z } from "zod";

import {
  examScheduleListPublished,
  examSchedulePublish,
  examScheduleSaveDraft,
  resultsApproveCorrection,
  resultsEntrySheetCreate,
  resultsEntrySheetModerate,
  resultsEntrySheetPublish,
  resultsEntrySheetSaveDraft,
  resultsEntrySheetSubmit,
  resultsGetEntrySheet,
  resultsGetReportRelease,
  resultsListEntrySheets,
  resultsListExamDefinitions,
  resultsListEntrySheetVersions,
  resultsListReportReleases,
  resultsReportReleasePublish,
  resultsRequestCorrection,
  resultsCorrectionDecide,
  resultsCorrectionRequest,
  resultsListPublications,
  resultsWithdraw,
  resultsListReportReleaseCandidates,
  resultsPublishReportReleaseBatch,
  resultsListPendingCorrections,
  resolveFamilyContext,
  schoolConfigRead,
  timetableGetEffective,
  timetableListOverrides,
  timetableListVersions,
  timetablePublish,
  timetableRevokeOverride,
  timetableSaveDraft,
  timetableSaveOverride,
  timetableValidateDraft,
} from "@/lib/supabase/domain";

import { emptyPayload, jsonObject, operation, publicReference, uuid } from "./common";
import type { AdapterModule } from "./types";

const batchFields = { batchId: uuid.optional(), batchRef: publicReference.optional() };
const batchTarget = z.object(batchFields).refine((value) => value.batchId !== undefined || value.batchRef !== undefined, "batch reference is required");
const batchWith = <T extends z.ZodRawShape>(shape: T) => z.object({ ...batchFields, ...shape }).refine((value) => value.batchId !== undefined || value.batchRef !== undefined, "batch reference is required");
const publicationFields = { publicationId: uuid.optional(), publicationRef: publicReference.optional() };
const publicationTarget = z.object(publicationFields).refine((value) => value.publicationId !== undefined || value.publicationRef !== undefined, "publication reference is required");
const publicationWith = <T extends z.ZodRawShape>(shape: T) => z.object({ ...publicationFields, ...shape }).refine((value) => value.publicationId !== undefined || value.publicationRef !== undefined, "publication reference is required");
const versionFields = { versionId: uuid.optional(), versionRef: publicReference.optional() };
const versionTarget = z.object(versionFields).refine((value) => value.versionId !== undefined || value.versionRef !== undefined, "version reference is required");
const versionWith = <T extends z.ZodRawShape>(shape: T) => z.object({ ...versionFields, ...shape }).refine((value) => value.versionId !== undefined || value.versionRef !== undefined, "version reference is required");
const sectionFields = { gradeSectionId: uuid.optional(), gradeSectionRef: publicReference.optional() };
const sectionTarget = z.object(sectionFields).refine((value) => value.gradeSectionId !== undefined || value.gradeSectionRef !== undefined, "section reference is required");
const sectionWith = <T extends z.ZodRawShape>(shape: T) => z.object({ ...sectionFields, ...shape }).refine((value) => value.gradeSectionId !== undefined || value.gradeSectionRef !== undefined, "section reference is required");
const overrideFields = { overrideId: uuid.optional(), overrideRef: publicReference.optional() };
const overrideWith = <T extends z.ZodRawShape>(shape: T) => z.object({ ...overrideFields, ...shape }).refine((value) => value.overrideId !== undefined || value.overrideRef !== undefined, "override reference is required");

const marks = z.array(z.object({ rosterId: uuid.optional(), rosterRef: publicReference.optional(), componentId: uuid.optional(), componentRef: publicReference.optional(), obtained: z.number().nullable().optional(), absent: z.boolean().optional(), remark: z.string().nullable().optional() }));
const sheetFields = { sheetId: uuid.optional(), sheetRef: publicReference.optional(), batchId: uuid.optional(), batchRef: publicReference.optional() };
const sheetTarget = z.object(sheetFields).refine((value) => value.sheetId !== undefined || value.sheetRef !== undefined || value.batchId !== undefined || value.batchRef !== undefined, "result entry sheet reference is required");
const sheetWith = <T extends z.ZodRawShape>(shape: T) => z.object({ ...sheetFields, ...shape }).refine((value) => value.sheetId !== undefined || value.sheetRef !== undefined || value.batchId !== undefined || value.batchRef !== undefined, "result entry sheet reference is required");

export const academicsModule: AdapterModule = {
  domain: "academics",
  operations: [
    operation("results.listBatches", emptyPayload, ({ supabase }) => resultsListEntrySheets(supabase)),
    /* Exam definitions the signed-in result officer may create a batch for.
       Read-only; the projection enforces role-grant scope server-side. */
    operation("results.examDefinitions", emptyPayload, ({ supabase }) => resultsListExamDefinitions(supabase)),
    /* Create (or idempotently reopen) the entry sheet for one exam/subject and
       return the full mapped sheet so the caller never sees a partial record. */
    operation("results.createBatch", z.object({
      examDefinitionId: uuid,
      gradeSectionId: uuid,
      subjectId: uuid,
      idempotencyKey: z.string().min(1).optional(),
    }), async ({ supabase }, payload) => {
      const created = await resultsEntrySheetCreate(supabase, payload);
      if (!created.ok) return created;
      const sheetId = (created.value as Record<string, unknown>).sheetId;
      if (typeof sheetId !== "string") return created;
      return resultsGetEntrySheet(supabase, sheetId);
    }),
    operation("results.getBatch", sheetTarget, async ({ supabase }, payload) => {
      const sheetId = (payload.sheetId ?? payload.batchId)!;
      const sheet = await resultsGetEntrySheet(supabase, sheetId);
      if (!sheet.ok) return sheet;
      /* The batch record alone carries no workflow note or version history;
         both travel with the detail read so the entry workspace can show the
         moderator's return reason and the audited correction trail. */
      const [versions, corrections] = await Promise.all([
        resultsListEntrySheetVersions(supabase, sheetId),
        resultsListPendingCorrections(supabase, sheetId),
      ]);
      return {
        ok: true as const,
        value: {
          ...(sheet.value as Record<string, unknown>),
          versions: versions.ok ? versions.value : [],
          corrections: corrections.ok ? corrections.value : [],
        },
      };
    }),
    operation("results.listVersions", sheetTarget, ({ supabase }, payload) => resultsListEntrySheetVersions(supabase, (payload.sheetId ?? payload.batchId)!)),
    /* Pending correction requests for the review queue. RLS scopes rows to the
       caller's entry-sheet/publication scope; reviewers see requests awaiting
       their independent approval. */
    operation("results.listCorrections", emptyPayload, ({ supabase }) => resultsListPendingCorrections(supabase)),
    operation("results.listPublications", z.object({ studentId: uuid.optional(), studentRef: publicReference.optional() }), async ({ supabase, actor, selection }, payload) => {
      const family = await resolveFamilyContext(supabase, selection.familyStudentId ? { studentId: selection.familyStudentId } : {}, actor);
      if (family.ok && family.value.guardianId !== null) {
        const activeStudentId = family.value.activeStudentId;
        if (activeStudentId === null) return { ok: true as const, value: [] };
        if (payload.studentId !== undefined && payload.studentId !== activeStudentId) {
          return { ok: false as const, errors: [{ code: "forbidden" as const, message: "Results are limited to the active child.", field: null }] };
        }
        payload.studentId = activeStudentId;
      }
      return resultsListPublications(supabase, payload.studentId);
    }),
    operation("results.publish", sheetWith({ expectedVersion: z.number().int().nonnegative(), idempotencyKey: z.string().min(1).optional() }), ({ supabase }, payload) => resultsEntrySheetPublish(supabase, { sheetId: (payload.sheetId ?? payload.batchId)!, expectedVersion: payload.expectedVersion, idempotencyKey: payload.idempotencyKey })),
    operation("results.submitMarks", sheetWith({ marks, expectedVersion: z.number().int().nonnegative(), idempotencyKey: z.string().min(1).optional() }), async ({ supabase }, payload) => {
      const saved = await resultsEntrySheetSaveDraft(supabase, { sheetId: (payload.sheetId ?? payload.batchId)!, marks: payload.marks as never, expectedVersion: payload.expectedVersion, idempotencyKey: payload.idempotencyKey });
      if (!saved.ok) return saved;
      return resultsEntrySheetSubmit(supabase, { sheetId: (payload.sheetId ?? payload.batchId)!, expectedVersion: Number((saved.value as Record<string, unknown>).version ?? payload.expectedVersion + 1), idempotencyKey: payload.idempotencyKey });
    }),
    operation("results.moderate", sheetWith({ outcome: z.enum(["approved", "returned"]), note: z.string().nullable().optional(), expectedVersion: z.number().int().nonnegative(), idempotencyKey: z.string().min(1).optional() }), ({ supabase }, payload) => resultsEntrySheetModerate(supabase, { sheetId: (payload.sheetId ?? payload.batchId)!, outcome: payload.outcome, note: payload.note, expectedVersion: payload.expectedVersion, idempotencyKey: payload.idempotencyKey })),
    operation("results.withdraw", publicationWith({ reason: z.string().min(1) }), ({ supabase }, payload) => resultsWithdraw(supabase, { publicationId: payload.publicationId!, reason: payload.reason })),
    operation("results.correctionRequest", publicationWith({ reason: z.string().min(1) }), ({ supabase }, payload) => resultsCorrectionRequest(supabase, { publicationId: payload.publicationId!, reason: payload.reason })),
    operation("results.saveDraft", sheetWith({ marks, expectedVersion: z.number().int().nonnegative(), idempotencyKey: z.string().min(1).optional() }), ({ supabase }, payload) => resultsEntrySheetSaveDraft(supabase, { sheetId: (payload.sheetId ?? payload.batchId)!, marks: payload.marks as never, expectedVersion: payload.expectedVersion, idempotencyKey: payload.idempotencyKey })),
    operation("results.listReleases", z.object({ studentId: uuid.optional(), studentRef: publicReference.optional() }), async ({ supabase, actor, selection }, payload) => {
      const family = await resolveFamilyContext(supabase, selection.familyStudentId ? { studentId: selection.familyStudentId } : {}, actor);
      if (family.ok && family.value.guardianId !== null) {
        const activeStudentId = family.value.activeStudentId;
        if (activeStudentId === null) return { ok: true as const, value: [] };
        if (payload.studentId !== undefined && payload.studentId !== activeStudentId) return { ok: false as const, errors: [{ code: "forbidden" as const, message: "Results are limited to the active child.", field: null }] };
        payload.studentId = activeStudentId;
      }
      return resultsListReportReleases(supabase, payload.studentId);
    }),
    operation("results.getRelease", z.object({ releaseId: uuid.optional(), releaseRef: publicReference.optional() }).refine((value) => value.releaseId !== undefined || value.releaseRef !== undefined, "release reference is required"), ({ supabase }, payload) => resultsGetReportRelease(supabase, payload.releaseId!)),
    operation("results.publishRelease", z.object({ studentId: uuid.optional(), studentRef: publicReference.optional(), enrollmentId: uuid.optional(), enrollmentRef: publicReference.optional(), academicYearId: uuid.optional(), academicYearRef: publicReference.optional(), term: z.string().min(1), publicationIds: z.array(uuid).optional(), publicationRefs: z.array(publicReference).optional(), expectedVersion: z.number().int().nonnegative().nullable().optional(), idempotencyKey: z.string().min(1).optional() }).refine((value) => (value.studentId ?? value.studentRef) !== undefined && (value.enrollmentId ?? value.enrollmentRef) !== undefined && (value.academicYearId ?? value.academicYearRef) !== undefined && (value.publicationIds ?? value.publicationRefs)?.length, "report release references are required"), ({ supabase }, payload) => resultsReportReleasePublish(supabase, { studentId: payload.studentId!, enrollmentId: payload.enrollmentId!, academicYearId: payload.academicYearId!, term: payload.term, publicationIds: payload.publicationIds as never, expectedVersion: payload.expectedVersion, idempotencyKey: payload.idempotencyKey })),
    operation("results.releaseCandidates", sheetTarget, ({ supabase }, payload) => resultsListReportReleaseCandidates(supabase, (payload.sheetId ?? payload.batchId)!)),
    operation("results.publishReleaseBatch", sheetWith({ studentIds: z.array(uuid).optional(), idempotencyKey: z.string().min(1).optional() }), ({ supabase }, payload) => resultsPublishReportReleaseBatch(supabase, { sheetId: (payload.sheetId ?? payload.batchId)!, studentIds: payload.studentIds, idempotencyKey: payload.idempotencyKey })),
    operation("results.requestCorrection", z.object({ releaseId: uuid.optional(), releaseRef: publicReference.optional(), publicationId: uuid.optional(), publicationRef: publicReference.optional(), reason: z.string().min(1), idempotencyKey: z.string().min(1).optional() }).refine((value) => (value.releaseId ?? value.releaseRef) !== undefined && (value.publicationId ?? value.publicationRef) !== undefined, "correction references are required"), ({ supabase }, payload) => resultsRequestCorrection(supabase, payload as never)),
    operation("results.approveCorrection", z.object({ requestId: uuid.optional(), requestRef: publicReference.optional(), expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(1).optional() }).refine((value) => (value.requestId ?? value.requestRef) !== undefined, "correction request reference is required"), ({ supabase }, payload) => resultsApproveCorrection(supabase, payload as never)),
    operation("results.correctionDecide", z.object({ requestId: uuid.optional(), requestRef: publicReference.optional(), outcome: z.enum(["approved", "rejected"]), note: z.string().nullable().optional() }).refine((value) => value.requestId !== undefined || value.requestRef !== undefined, "correction request reference is required"), ({ supabase }, payload) => resultsCorrectionDecide(supabase, { requestId: payload.requestId!, outcome: payload.outcome, note: payload.note })),
    operation("timetable.listVersions", emptyPayload, ({ supabase }) => timetableListVersions(supabase)),
    operation("timetable.effective", sectionTarget, async ({ supabase, actor, selection }, payload) => {
      const family = await resolveFamilyContext(supabase, selection.familyStudentId ? { studentId: selection.familyStudentId } : {}, actor);
      if (family.ok && family.value.guardianId !== null) {
        const active = family.value.contexts.find((context) => context.student.id === family.value.activeStudentId);
        if (active === undefined || active.gradeSection.id !== payload.gradeSectionId) return { ok: false as const, errors: [{ code: "forbidden" as const, message: "Timetable is limited to the active child section.", field: null }] };
      }
      return timetableGetEffective(supabase, payload.gradeSectionId!);
    }),
    operation("timetable.listOverrides", sectionTarget, async ({ supabase, actor, selection }, payload) => {
      const family = await resolveFamilyContext(supabase, selection.familyStudentId ? { studentId: selection.familyStudentId } : {}, actor);
      if (family.ok && family.value.guardianId !== null) {
        const active = family.value.contexts.find((context) => context.student.id === family.value.activeStudentId);
        if (active === undefined || active.gradeSection.id !== payload.gradeSectionId) return { ok: false as const, errors: [{ code: "forbidden" as const, message: "Timetable overrides are limited to the active child section.", field: null }] };
      }
      return timetableListOverrides(supabase, payload.gradeSectionId!);
    }),
    operation("timetable.listDateSheets", sectionTarget, async ({ supabase, actor, selection }, payload) => {
      const family = await resolveFamilyContext(supabase, selection.familyStudentId ? { studentId: selection.familyStudentId } : {}, actor);
      if (family.ok && family.value.guardianId !== null) {
        const active = family.value.contexts.find((context) => context.student.id === family.value.activeStudentId);
        if (active === undefined || active.gradeSection.id !== payload.gradeSectionId) return { ok: false as const, errors: [{ code: "forbidden" as const, message: "Exam date sheets are limited to the active child section.", field: null }] };
      }
      return examScheduleListPublished(supabase, payload.gradeSectionId!);
    }),
    operation("timetable.saveDraft", sectionWith({ versionId: uuid.nullable().optional(), versionRef: publicReference.nullable().optional(), periods: z.array(jsonObject), expectedRevision: z.number().int().nonnegative().optional() }), ({ supabase }, payload) => timetableSaveDraft(supabase, { gradeSectionId: payload.gradeSectionId!, versionId: payload.versionId, periods: payload.periods as never, expectedRevision: payload.expectedRevision })),
    operation("timetable.validateDraft", versionTarget, ({ supabase }, payload) => timetableValidateDraft(supabase, payload.versionId!)),
    operation("timetable.publish", versionWith({ note: z.string().nullable().optional() }), ({ supabase }, payload) => timetablePublish(supabase, { versionId: payload.versionId!, note: payload.note })),
    operation("timetable.saveOverride", sectionWith({ overrideDate: z.string(), dayOfWeek: z.number().int().min(1).max(7), periodNumber: z.number().int().positive(), kind: z.string(), subjectId: uuid.nullable().optional(), roomId: uuid.nullable().optional(), substituteTeacherAssignmentId: uuid.nullable().optional(), note: z.string().nullable().optional() }), ({ supabase }, payload) => timetableSaveOverride(supabase, { ...payload, gradeSectionId: payload.gradeSectionId! })),
    operation("timetable.revokeOverride", overrideWith({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(10) }), ({ supabase }, payload) => timetableRevokeOverride(supabase, { overrideId: payload.overrideId!, expectedVersion: payload.expectedVersion, reason: payload.reason })),
    operation("timetable.saveDateSheet", sectionWith({ versionId: uuid.nullable().optional(), versionRef: publicReference.nullable().optional(), entries: z.array(jsonObject) }), ({ supabase }, payload) => examScheduleSaveDraft(supabase, { gradeSectionId: payload.gradeSectionId!, versionId: payload.versionId, entries: payload.entries as never })),
    operation("timetable.publishDateSheet", versionWith({ note: z.string().nullable().optional() }), ({ supabase }, payload) => examSchedulePublish(supabase, { versionId: payload.versionId!, note: payload.note })),
    operation("config.read", z.object({ academicYearId: uuid.optional(), academicYearRef: publicReference.optional() }), ({ supabase }, payload) => schoolConfigRead(supabase, payload)),
  ],
};
