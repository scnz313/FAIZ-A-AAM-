import { describe, expect, it } from "vitest";

import { statusForServiceResult, withCorrelation } from "@/app/api/adapter/registry";

describe("authenticated adapter boundary", () => {
  it("maps service failures to canonical HTTP statuses", () => {
    expect(statusForServiceResult({ ok: false, errors: [{ code: "unauthenticated", message: "Sign in", field: null }] })).toBe(401);
    expect(statusForServiceResult({ ok: false, errors: [{ code: "forbidden", message: "Denied", field: null }] })).toBe(403);
    expect(statusForServiceResult({ ok: false, errors: [{ code: "not-found", message: "Missing", field: null }] })).toBe(404);
    expect(statusForServiceResult({ ok: false, errors: [{ code: "stale-version", message: "version mismatch (expected 1, found 2)", field: null }] })).toBe(409);
    expect(statusForServiceResult({ ok: false, errors: [{ code: "unavailable", message: "Unavailable", field: null }] })).toBe(503);
  });

  it("adds a correlation reference and current version without changing the value contract", () => {
    const success = withCorrelation({ ok: true, value: { reference: "INV-2026-X", version: 4 } }, "req-123");
    expect(success).toEqual({ ok: true, value: { reference: "INV-2026-X", version: 4 }, correlationRef: "req-123", httpStatus: 200, retryable: false, currentVersion: 4 });

    const failure = withCorrelation({ ok: false, errors: [{ code: "stale-version", message: "version mismatch (expected 1, found 2)", field: null }] }, "req-124");
    expect(failure).toMatchObject({ ok: false, correlationRef: "req-124", httpStatus: 409, retryable: false, currentVersion: 2 });
  });

  it("returns an actionable duplicate message instead of hiding a unique conflict", () => {
    const duplicate = withCorrelation(
      { ok: false, errors: [{ code: "duplicate", message: 'duplicate key value violates unique constraint "content_items_slug_key"', field: null }] },
      "req-127",
    );
    expect(duplicate).toMatchObject({ ok: false, httpStatus: 409 });
    if (duplicate.ok) return;
    expect(duplicate.errors[0]?.message).toMatch(/same unique details already exists/i);
    expect(duplicate.errors[0]?.message).not.toMatch(/constraint|content_items_slug_key/i);
  });

  it("leaves a safe domain duplicate message unchanged", () => {
    const duplicate = withCorrelation(
      { ok: false, errors: [{ code: "duplicate", message: "You have already responded to this offer.", field: null }] },
      "req-128",
    );
    if (duplicate.ok) return;
    expect(duplicate.errors[0]?.message).toBe("You have already responded to this offer.");
  });

  it("exposes authoritative state and marks service-unavailable failures retryable", () => {
    expect(withCorrelation({ ok: true, value: { status: "processing", version: 2 } }, "req-125")).toMatchObject({
      httpStatus: 200,
      retryable: false,
      currentVersion: 2,
      currentState: "processing",
    });
    expect(withCorrelation({ ok: false, errors: [{ code: "unavailable", message: "Temporary service failure", field: null }] }, "req-126")).toMatchObject({
      httpStatus: 503,
      retryable: true,
      correlationRef: "req-126",
    });
  });
});
