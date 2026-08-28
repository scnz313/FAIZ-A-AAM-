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
    z.object({
      ok: z.literal(true),
      value: valueSchema,
      /** Safe request correlation reference for support/log lookup. */
      correlationRef: z.string().min(1).optional(),
      /** Canonical HTTP status for transport-aware callers. */
      httpStatus: z.number().int().min(100).max(599).optional(),
      /** Aggregate retry hint for the operation, not a provider detail. */
      retryable: z.boolean().optional(),
      /** Returned when a mutable command exposes its authoritative revision. */
      currentVersion: z.number().int().nonnegative().optional(),
      /** Authoritative state/status returned by a command when available. */
      currentState: z.unknown().optional(),
    }),
    z.object({
      ok: z.literal(false),
      errors: z.array(serviceErrorSchema),
      /** Safe request correlation reference; never a provider/SQL detail. */
      correlationRef: z.string().min(1).optional(),
      /** Canonical HTTP status for transport-aware callers. */
      httpStatus: z.number().int().min(100).max(599).optional(),
      /** Aggregate retry hint for the operation, not a provider detail. */
      retryable: z.boolean().optional(),
      /** Current revision when the failure is a stale/concurrency conflict. */
      currentVersion: z.number().int().nonnegative().optional(),
      /** Authoritative state/status returned by a command when available. */
      currentState: z.unknown().optional(),
    }),
  ]);
}
export type ServiceResult<T> =
  | { ok: true; value: T; correlationRef?: string; httpStatus?: number; retryable?: boolean; currentVersion?: number; currentState?: unknown }
  | { ok: false; errors: ServiceError[]; correlationRef?: string; httpStatus?: number; retryable?: boolean; currentVersion?: number; currentState?: unknown };

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
