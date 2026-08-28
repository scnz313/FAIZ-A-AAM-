import { z } from "zod";

import {
  admissionConfiguration,
  auditList,
  contentList,
  contentPublishNotice,
  contentApproveVersion,
  contentPublishVersionV2,
  contentRequestReview,
  contentReviewVersion,
  contentSaveDraft,
  contentUnpublish,
  documentsList,
  jobsCreateDraftApplication,
  jobsDecide,
  jobsDecideV2,
  jobsListMine,
  jobsListPublishedVacancies,
  jobsListStaffQueue,
  jobsSaveDraft,
  jobsSaveScorecard,
  jobsRetentionStatus,
  jobsSubmit,
  jobsAssignReviewer,
  jobsWithdraw,
  notificationMarkRead,
  notificationsMarkAll,
  notificationsList,
  settingsRead,
  settingsReadLatest,
  settingsSave,
  settingsApprove,
  supportAssign,
  supportCreate,
  supportList,
  supportPublicIntake,
  supportReopen,
  supportRespond,
  supportSetStatus,
} from "@/lib/supabase/domain";

import { emptyPayload, jsonObject, operation, publicReference, uuid } from "./common";
import type { AdapterModule } from "./types";

const jobTargetFields = { applicationId: uuid.optional(), applicationRef: publicReference.optional() };
const jobTarget = z.object(jobTargetFields).refine((value) => value.applicationId !== undefined || value.applicationRef !== undefined, "application reference is required");
const jobTargetWith = <T extends z.ZodRawShape>(shape: T) => z.object({ ...jobTargetFields, ...shape }).refine((value) => value.applicationId !== undefined || value.applicationRef !== undefined, "application reference is required");
const contentTargetFields = { contentItemId: uuid.optional(), contentItemRef: publicReference.optional() };
const contentTarget = z.object(contentTargetFields).refine((value) => value.contentItemId !== undefined || value.contentItemRef !== undefined, "content reference is required");
const contentTargetWith = <T extends z.ZodRawShape>(shape: T) => z.object({ ...contentTargetFields, ...shape }).refine((value) => value.contentItemId !== undefined || value.contentItemRef !== undefined, "content reference is required");

export const operationsModule: AdapterModule = {
  domain: "operations",
  operations: [
    operation("config.admissions", emptyPayload, ({ supabase }) => admissionConfiguration(supabase)),
    operation("jobs.vacancies", emptyPayload, ({ supabase }) => jobsListPublishedVacancies(supabase)),
    operation("jobs.listMine", emptyPayload, ({ supabase }) => jobsListMine(supabase)),
    operation("jobs.staffQueue", emptyPayload, ({ supabase }) => jobsListStaffQueue(supabase)),
    operation("jobs.createDraft", z.object({ vacancyVersionId: uuid.optional(), vacancyRef: publicReference.optional(), applicantName: z.string().min(1) }).refine((value) => value.vacancyVersionId !== undefined || value.vacancyRef !== undefined, "vacancy reference is required"), ({ supabase }, payload) => jobsCreateDraftApplication(supabase, payload as Parameters<typeof jobsCreateDraftApplication>[1])),
    operation("jobs.submit", jobTargetWith({ snapshot: jsonObject, expectedVersion: z.number().int().nonnegative() }), ({ supabase }, payload) => jobsSubmit(supabase, payload as Parameters<typeof jobsSubmit>[1])),
    operation("jobs.decide", jobTargetWith({ action: z.enum(["shortlist", "interview", "offer", "not_selected"]), reason: z.string().nullable().optional(), privateNote: z.string().nullable().optional(), scheduledAt: z.string().nullable().optional(), expectedVersion: z.number().int().nonnegative().nullable().optional() }), ({ supabase }, payload) => jobsDecide(supabase, payload as Parameters<typeof jobsDecide>[1])),
    operation("jobs.saveDraft", jobTargetWith({ draft: jsonObject, schemaVersion: z.number().int().positive().optional(), expectedVersion: z.number().int().nonnegative().nullable().optional(), expectedDraftVersion: z.number().int().positive().nullable().optional() }), ({ supabase }, payload) => jobsSaveDraft(supabase, payload as Parameters<typeof jobsSaveDraft>[1])),
    operation("jobs.withdraw", jobTargetWith({ expectedVersion: z.number().int().nonnegative().nullable().optional() }), ({ supabase }, payload) => jobsWithdraw(supabase, payload as Parameters<typeof jobsWithdraw>[1])),
    operation("jobs.assignReviewer", jobTargetWith({ reviewerAccountId: uuid.optional(), reviewerRef: publicReference.optional() }), ({ supabase }, payload) => jobsAssignReviewer(supabase, payload as Parameters<typeof jobsAssignReviewer>[1])),
    operation("jobs.saveScorecard", jobTargetWith({ score: z.number().nonnegative(), notes: z.string().nullable().optional() }), ({ supabase }, payload) => jobsSaveScorecard(supabase, payload as Parameters<typeof jobsSaveScorecard>[1])),
    operation("jobs.retentionStatus", jobTarget, ({ supabase }, payload) => jobsRetentionStatus(supabase, payload.applicationId!)),
    operation("jobs.decideV2", jobTargetWith({ action: z.enum(["shortlist", "interview", "offer", "not_selected"]), reason: z.string().nullable().optional(), privateNote: z.string().nullable().optional(), scheduledAt: z.string().nullable().optional(), expectedVersion: z.number().int().nonnegative().nullable().optional() }), ({ supabase }, payload) => jobsDecideV2(supabase, payload as Parameters<typeof jobsDecideV2>[1])),
    operation("content.list", z.object({ scope: z.enum(["public", "family", "staff"]).optional() }), ({ supabase }, payload) => contentList(supabase, payload.scope ?? "public")),
    operation("content.saveDraft", z.object({ ...contentTargetFields, kind: z.string(), slug: z.string().min(1), title: z.string().min(1), body: jsonObject, expectedVersion: z.number().int().nonnegative().nullable().optional(), idempotencyKey: z.string().min(3).optional() }).refine((value) => value.contentItemId !== undefined || value.contentItemRef === undefined, "new drafts omit content reference"), ({ supabase }, payload) => contentSaveDraft(supabase, payload as Parameters<typeof contentSaveDraft>[1])),
    operation("content.reviewVersion", z.object({ versionId: uuid.optional(), versionRef: publicReference.optional(), outcome: z.enum(["in_review", "approved"]) }).refine((value) => value.versionId !== undefined || value.versionRef !== undefined, "content version reference is required"), ({ supabase }, payload) => contentReviewVersion(supabase, payload as Parameters<typeof contentReviewVersion>[1])),
    operation("content.publishVersion", z.object({ versionId: uuid.optional(), versionRef: publicReference.optional(), expectedVersion: z.number().int().positive().optional(), scheduledAt: z.string().datetime().nullable().optional(), expiresAt: z.string().datetime().nullable().optional(), idempotencyKey: z.string().min(3).optional() }).refine((value) => value.versionId !== undefined || value.versionRef !== undefined, "content version reference is required"), ({ supabase }, payload) => contentPublishVersionV2(supabase, payload as Parameters<typeof contentPublishVersionV2>[1])),
    operation("content.requestReview", z.object({ versionId: uuid.optional(), versionRef: publicReference.optional(), expectedVersion: z.number().int().positive().optional(), idempotencyKey: z.string().min(3).optional() }).refine((value) => value.versionId !== undefined || value.versionRef !== undefined, "content version reference is required"), ({ supabase }, payload) => contentRequestReview(supabase, payload as Parameters<typeof contentRequestReview>[1])),
    operation("content.approveVersion", z.object({ versionId: uuid.optional(), versionRef: publicReference.optional(), expectedVersion: z.number().int().positive().optional(), idempotencyKey: z.string().min(3).optional() }).refine((value) => value.versionId !== undefined || value.versionRef !== undefined, "content version reference is required"), ({ supabase }, payload) => contentApproveVersion(supabase, payload as Parameters<typeof contentApproveVersion>[1])),
    operation("content.unpublish", contentTargetWith({ reason: z.string().min(1), expectedVersion: z.number().int().nonnegative().optional() }), ({ supabase }, payload) => contentUnpublish(supabase, payload as Parameters<typeof contentUnpublish>[1])),
    operation("content.publishNotice", z.object({ noticeId: uuid.optional(), noticeRef: publicReference.optional() }).refine((value) => value.noticeId !== undefined || value.noticeRef !== undefined, "notice reference is required"), ({ supabase }, payload) => contentPublishNotice(supabase, payload.noticeId!)),
    operation("support.list", z.object({ scope: z.enum(["mine", "staff"]) }), ({ supabase }, payload) => supportList(supabase, payload.scope)),
    operation("support.create", z.object({ category: z.string().min(1), subject: z.string().min(1), body: z.string().min(1), priority: z.string().optional() }), ({ supabase }, payload) => supportCreate(supabase, payload)),
    operation("support.publicIntake", z.object({ category: z.string().min(1), subject: z.string().min(1), body: z.string().min(1), contact: z.string().min(5), requesterName: z.string().nullable().optional(), intakeKey: z.string().nullable().optional() }), ({ supabase }, payload) => supportPublicIntake(supabase, payload)),
    operation("support.respond", z.object({ requestId: uuid.optional(), requestRef: publicReference.optional(), body: z.string().min(1), isPrivate: z.boolean().optional(), expectedVersion: z.number().int().positive().optional(), idempotencyKey: z.string().min(3).optional() }).refine((value) => value.requestId !== undefined || value.requestRef !== undefined, "support request reference is required"), ({ supabase }, payload) => supportRespond(supabase, payload as Parameters<typeof supportRespond>[1])),
    operation("support.setStatus", z.object({ requestId: uuid.optional(), requestRef: publicReference.optional(), status: z.enum(["open", "assigned", "in_progress", "resolved", "closed"]), expectedVersion: z.number().int().positive(), reason: z.string().nullable().optional(), resolutionCode: z.string().nullable().optional() }).refine((value) => value.requestId !== undefined || value.requestRef !== undefined, "support request reference is required"), ({ supabase }, payload) => supportSetStatus(supabase, payload as Parameters<typeof supportSetStatus>[1])),
    operation("support.reopen", z.object({ requestId: uuid.optional(), requestRef: publicReference.optional(), expectedVersion: z.number().int().nonnegative() }).refine((value) => value.requestId !== undefined || value.requestRef !== undefined, "support request reference is required"), ({ supabase }, payload) => supportReopen(supabase, payload as Parameters<typeof supportReopen>[1])),
    operation("support.assign", z.object({ requestId: uuid.optional(), requestRef: publicReference.optional(), assigneeAccountId: uuid.optional(), assigneeRef: publicReference.optional(), expectedVersion: z.number().int().nonnegative() }).refine((value) => (value.requestId !== undefined || value.requestRef !== undefined) && (value.assigneeAccountId !== undefined || value.assigneeRef !== undefined), "support references are required"), ({ supabase }, payload) => supportAssign(supabase, payload as Parameters<typeof supportAssign>[1])),
    operation("settings.read", emptyPayload, ({ supabase }) => settingsRead(supabase)),
    operation("settings.readLatest", emptyPayload, ({ supabase }) => settingsReadLatest(supabase)),
    operation("settings.save", z.object({ policy: jsonObject, reason: z.string().min(1), expectedVersion: z.number().int().nonnegative() }), ({ supabase }, payload) => settingsSave(supabase, payload as Parameters<typeof settingsSave>[1])),
    operation("settings.approve", z.object({ settingsId: uuid, expectedVersion: z.number().int().positive(), effectiveFrom: z.string().datetime().nullable().optional() }), ({ supabase }, payload) => settingsApprove(supabase, payload)),
    operation("audit.list", z.object({ limit: z.number().int().positive().max(500).optional() }), ({ supabase }, payload) => auditList(supabase, payload.limit)),
    operation("notifications.list", emptyPayload, ({ supabase }) => notificationsList(supabase)),
    operation("notifications.markRead", z.object({ notificationId: uuid.optional(), notificationRef: publicReference.optional(), expectedVersion: z.number().int().positive().optional() }).refine((value) => value.notificationId !== undefined || value.notificationRef !== undefined, "notification reference is required"), ({ supabase }, payload) => notificationMarkRead(supabase, payload.notificationId!, payload.expectedVersion ?? 1)),
    operation("notifications.markAll", z.object({ expectedVersion: z.number().int().positive().optional() }), ({ supabase }, payload) => notificationsMarkAll(supabase, payload.expectedVersion)),
    operation("documents.list", z.object({ ownerDomain: z.string().optional(), ownerRecordId: uuid.optional(), ownerRecordRef: publicReference.optional() }), ({ supabase }, payload) => documentsList(supabase, payload.ownerDomain, payload.ownerRecordId)),
  ],
};
