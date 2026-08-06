import { z } from "zod";

import { opaqueIdSchema, publicReferenceSchema, roleScopeSchema } from "./relationships";

/* ------------------------------------------------------------------ */
/* Error codes and service results                                     */
/* ------------------------------------------------------------------ */

export const ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not-found",
  "validation",
  "stale-version",
  "conflict",
  "duplicate",
  "retryable",
  "unavailable",
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const serviceErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  field: z.string().nullable().optional(),
  retryable: z.boolean().optional(),
});
export type ServiceError = z.infer<typeof serviceErrorSchema>;

/** Discriminated result envelope: either the authoritative value or typed errors. */
export function serviceResultSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: valueSchema }),
    z.object({ ok: z.literal(false), errors: z.array(serviceErrorSchema) }),
  ]);
}
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: ServiceError[] };

/* ------------------------------------------------------------------ */
/* Actor and record scope                                              */
/* ------------------------------------------------------------------ */

export const actorContextSchema = z.object({
  accountId: opaqueIdSchema,
  grantId: opaqueIdSchema,
  role: z.string().min(1),
  scopes: roleScopeSchema,
  correlationId: z.string().min(1),
});
export type ActorContext = z.infer<typeof actorContextSchema>;

/** Optional filters that narrow a read/write to one record or class of records. */
export const recordScopeSchema = z.object({
  academicYearId: opaqueIdSchema.optional(),
  gradeSectionId: opaqueIdSchema.optional(),
  subjectId: opaqueIdSchema.optional(),
  studentId: opaqueIdSchema.optional(),
  enrollmentId: opaqueIdSchema.optional(),
});
export type RecordScope = z.infer<typeof recordScopeSchema>;

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export const commandMetaSchema = z.object({
  idempotencyKey: z.string().min(1),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type CommandMeta = z.infer<typeof commandMetaSchema>;

export const moneySchema = z.object({
  amountPaise: z.number().int().nonnegative(),
  currency: z.literal("INR"),
});
export type Money = z.infer<typeof moneySchema>;

/** Human-readable references (APP-2026-0424, INV-2026-0103) are display/search
 * references, never authorization credentials. Alias of the shared schema. */
export type PublicReference = z.infer<typeof publicReferenceSchema>;

/* ------------------------------------------------------------------ */
/* Events, outbox, and audit                                           */
/* ------------------------------------------------------------------ */

export const domainEventSchema = z.object({
  id: opaqueIdSchema,
  type: z.string().min(1),
  correlationId: z.string().min(1),
  atIso: z.string().datetime(),
  payload: z.record(z.unknown()),
});
export type DomainEvent = z.infer<typeof domainEventSchema>;

export const OUTBOX_STATUSES = ["pending", "delivered"] as const;
export const outboxRecordSchema = z.object({
  id: opaqueIdSchema,
  eventId: opaqueIdSchema,
  status: z.enum(OUTBOX_STATUSES),
  attempts: z.number().int().nonnegative(),
  nextAttemptAtIso: z.string().datetime().nullable(),
  createdAtIso: z.string().datetime(),
});
export type OutboxRecord = z.infer<typeof outboxRecordSchema>;

export const auditEventSchema = z.object({
  id: opaqueIdSchema,
  atIso: z.string().datetime(),
  actorAccountId: opaqueIdSchema,
  action: z.string().min(1),
  targetKind: z.string().min(1),
  targetRef: publicReferenceSchema,
  reason: z.string().optional(),
  beforeVersion: z.number().int().nonnegative().optional(),
  afterVersion: z.number().int().nonnegative().optional(),
  correlationId: z.string().optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

/* ------------------------------------------------------------------ */
/* Paging                                                              */
/* ------------------------------------------------------------------ */

export function pagedResultSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  });
}
export type PagedResult<T> = { items: T[]; page: number; pageSize: number; total: number };
