import { describe, expect, it } from "vitest";

import {
  actorContextSchema,
  auditEventSchema,
  commandMetaSchema,
  domainEventSchema,
  errorCodeSchema,
  moneySchema,
  outboxRecordSchema,
  pagedResultSchema,
  recordScopeSchema,
  serviceErrorSchema,
  serviceResultSchema,
} from "./core";
import { publicReferenceSchema } from "./relationships";

const UUID = "3f8b0b1e-2c7a-4f4d-9e1e-6a2c1f9d4b0a";
const OTHER_UUID = "9c2f7e3a-1b4d-4e6f-8a9b-0c1d2e3f4a5b";

describe("errorCodeSchema", () => {
  it("accepts every documented error code", () => {
    for (const code of [
      "unauthenticated",
      "forbidden",
      "not-found",
      "validation",
      "stale-version",
      "conflict",
      "duplicate",
      "retryable",
      "unavailable",
    ]) {
      expect(errorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects an unknown error code", () => {
    expect(errorCodeSchema.safeParse("server-exploded").success).toBe(false);
  });
});

describe("actorContextSchema", () => {
  const valid = {
    accountId: UUID,
    grantId: OTHER_UUID,
    role: "admissions_officer",
    scopes: { academicYearIds: [UUID], gradeSectionIds: [], subjectIds: [] },
    correlationId: "corr-1",
  };

  it("parses a valid actor context", () => {
    expect(actorContextSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a non-uuid account id", () => {
    expect(actorContextSchema.safeParse({ ...valid, accountId: "account-1" }).success).toBe(false);
  });

  it("rejects a non-uuid scope id", () => {
    expect(
      actorContextSchema.safeParse({
        ...valid,
        scopes: { academicYearIds: ["2026-27"], gradeSectionIds: [], subjectIds: [] },
      }).success,
    ).toBe(false);
  });

  it("rejects an empty correlation id", () => {
    expect(actorContextSchema.safeParse({ ...valid, correlationId: "" }).success).toBe(false);
  });
});

describe("recordScopeSchema", () => {
  it("parses an empty scope (every filter optional)", () => {
    expect(recordScopeSchema.parse({})).toEqual({});
  });

  it("parses a fully populated scope", () => {
    const scope = {
      academicYearId: UUID,
      gradeSectionId: OTHER_UUID,
      subjectId: UUID,
      studentId: OTHER_UUID,
      enrollmentId: UUID,
    };
    expect(recordScopeSchema.parse(scope)).toEqual(scope);
  });

  it("rejects a non-uuid student id", () => {
    expect(recordScopeSchema.safeParse({ studentId: "STU-1" }).success).toBe(false);
  });
});

describe("commandMetaSchema", () => {
  it("parses an idempotency key with no version", () => {
    expect(commandMetaSchema.parse({ idempotencyKey: "app-submit-2026-0424" })).toEqual({
      idempotencyKey: "app-submit-2026-0424",
    });
  });

  it("parses an idempotency key with an expected version", () => {
    expect(commandMetaSchema.parse({ idempotencyKey: "pay-1", expectedVersion: 3 })).toEqual({
      idempotencyKey: "pay-1",
      expectedVersion: 3,
    });
  });

  it("rejects a missing idempotency key", () => {
    expect(commandMetaSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a negative expected version", () => {
    expect(commandMetaSchema.safeParse({ idempotencyKey: "k", expectedVersion: -1 }).success).toBe(false);
  });
});

describe("moneySchema", () => {
  it("parses a zero amount (waiver)", () => {
    expect(moneySchema.parse({ amountPaise: 0, currency: "INR" })).toEqual({ amountPaise: 0, currency: "INR" });
  });

  it("parses a positive amount in paise", () => {
    expect(moneySchema.parse({ amountPaise: 920000, currency: "INR" }).amountPaise).toBe(920000);
  });

  it("rejects a negative amount", () => {
    expect(moneySchema.safeParse({ amountPaise: -100, currency: "INR" }).success).toBe(false);
  });

  it("rejects a non-INR currency", () => {
    expect(moneySchema.safeParse({ amountPaise: 100, currency: "USD" }).success).toBe(false);
  });
});

describe("publicReferenceSchema", () => {
  it("parses a human-readable reference", () => {
    expect(publicReferenceSchema.parse("APP-2026-0424")).toBe("APP-2026-0424");
  });

  it("rejects an empty reference", () => {
    expect(publicReferenceSchema.safeParse("").success).toBe(false);
  });
});

describe("serviceErrorSchema", () => {
  it("parses a minimal error", () => {
    expect(serviceErrorSchema.parse({ code: "validation", message: "Enter a valid email address." })).toEqual({
      code: "validation",
      message: "Enter a valid email address.",
    });
  });

  it("parses an error with field and retryable flags", () => {
    const err = { code: "stale-version", message: "Another user changed this record.", field: "version", retryable: false };
    expect(serviceErrorSchema.parse(err)).toEqual(err);
  });

  it("rejects an unknown error code", () => {
    expect(serviceErrorSchema.safeParse({ code: "timeout", message: "x" }).success).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(serviceErrorSchema.safeParse({ code: "not-found", message: "" }).success).toBe(false);
  });
});

describe("serviceResultSchema", () => {
  const schema = serviceResultSchema(moneySchema);

  it("parses the ok branch and returns the value", () => {
    const parsed = schema.parse({ ok: true, value: { amountPaise: 920000, currency: "INR" } });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual({ amountPaise: 920000, currency: "INR" });
  });

  it("parses the error branch with typed errors", () => {
    const parsed = schema.parse({
      ok: false,
      errors: [{ code: "duplicate", message: "An application for this session already exists." }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors[0]?.code).toBe("duplicate");
      expect(parsed.errors[0]?.message).toMatch(/already exists/);
    }
  });

  it("rejects a success branch whose value fails the value schema", () => {
    expect(schema.safeParse({ ok: true, value: { amountPaise: -5, currency: "INR" } }).success).toBe(false);
  });

  it("rejects an ok branch carrying errors", () => {
    expect(schema.safeParse({ ok: true, errors: [] }).success).toBe(false);
  });

  it("rejects an error branch without errors", () => {
    expect(schema.safeParse({ ok: false, value: {} }).success).toBe(false);
  });
});

describe("domainEventSchema", () => {
  const valid = {
    id: UUID,
    type: "application.submitted",
    correlationId: "corr-1",
    atIso: "2026-08-06T10:00:00.000Z",
    payload: { ref: "APP-2026-0424" },
  };

  it("parses a valid domain event", () => {
    expect(domainEventSchema.parse(valid)).toEqual(valid);
  });

  it("accepts an empty payload record", () => {
    expect(domainEventSchema.parse({ ...valid, payload: {} }).payload).toEqual({});
  });

  it("rejects a non-uuid event id", () => {
    expect(domainEventSchema.safeParse({ ...valid, id: "evt-1" }).success).toBe(false);
  });

  it("rejects a stale/non-datetime timestamp", () => {
    expect(domainEventSchema.safeParse({ ...valid, atIso: "2026-08-06" }).success).toBe(false);
    expect(domainEventSchema.safeParse({ ...valid, atIso: "yesterday" }).success).toBe(false);
  });
});

describe("outboxRecordSchema", () => {
  const valid = {
    id: UUID,
    eventId: OTHER_UUID,
    status: "pending",
    attempts: 0,
    nextAttemptAtIso: "2026-08-06T10:01:00.000Z",
    createdAtIso: "2026-08-06T10:00:00.000Z",
  };

  it("parses a pending outbox record", () => {
    expect(outboxRecordSchema.parse(valid)).toEqual(valid);
  });

  it("parses a delivered record with no next attempt", () => {
    expect(outboxRecordSchema.parse({ ...valid, status: "delivered", nextAttemptAtIso: null }).status).toBe("delivered");
  });

  it("rejects an unknown outbox status", () => {
    expect(outboxRecordSchema.safeParse({ ...valid, status: "failed" }).success).toBe(false);
  });

  it("rejects negative attempt counts", () => {
    expect(outboxRecordSchema.safeParse({ ...valid, attempts: -1 }).success).toBe(false);
  });

  it("rejects a stale/non-datetime createdAt", () => {
    expect(outboxRecordSchema.safeParse({ ...valid, createdAtIso: "10:00" }).success).toBe(false);
  });
});

describe("auditEventSchema", () => {
  const valid = {
    id: UUID,
    atIso: "2026-08-06T10:00:00.000Z",
    actorAccountId: OTHER_UUID,
    action: "application.submitted",
    targetKind: "application",
    targetRef: "APP-2026-0424",
  };

  it("parses a minimal audit event", () => {
    expect(auditEventSchema.parse(valid)).toEqual(valid);
  });

  it("parses an audit event with reason and version bounds", () => {
    const full = {
      ...valid,
      reason: "Requested change to prior-school details.",
      beforeVersion: 2,
      afterVersion: 3,
      correlationId: "corr-1",
    };
    expect(auditEventSchema.parse(full)).toEqual(full);
  });

  it("rejects a non-uuid actor account id", () => {
    expect(auditEventSchema.safeParse({ ...valid, actorAccountId: "sana" }).success).toBe(false);
  });

  it("rejects a negative version bound", () => {
    expect(auditEventSchema.safeParse({ ...valid, afterVersion: -1 }).success).toBe(false);
  });
});

describe("pagedResultSchema", () => {
  const schema = pagedResultSchema(publicReferenceSchema);

  it("parses a page and preserves totals", () => {
    const parsed = schema.parse({
      items: ["APP-2026-0424", "APP-2026-0425"],
      page: 2,
      pageSize: 10,
      total: 34,
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toBe("APP-2026-0424");
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(10);
    expect(parsed.total).toBe(34);
  });

  it("parses an empty page", () => {
    expect(schema.parse({ items: [], page: 1, pageSize: 25, total: 0 }).items).toEqual([]);
  });

  it("rejects page numbers below 1", () => {
    expect(schema.safeParse({ items: [], page: 0, pageSize: 25, total: 0 }).success).toBe(false);
  });

  it("rejects a zero page size", () => {
    expect(schema.safeParse({ items: [], page: 1, pageSize: 0, total: 0 }).success).toBe(false);
  });

  it("rejects a negative total", () => {
    expect(schema.safeParse({ items: [], page: 1, pageSize: 25, total: -3 }).success).toBe(false);
  });

  it("validates items against the item schema", () => {
    expect(schema.safeParse({ items: [""], page: 1, pageSize: 25, total: 1 }).success).toBe(false);
  });
});
