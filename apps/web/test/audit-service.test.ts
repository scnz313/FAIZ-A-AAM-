// @vitest-environment node
/**
 * Contract tests for the audit service demo adapter (modules/services/audit.ts).
 * Verifies append-only recording, deterministic id/timestamp generation,
 * session persistence, and merge ordering (newest first). The clock is
 * pinned and the audit session key is cleared between tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { AUDIT_SESSION_KEY_EXPORT, auditService, demoAuditEvents } from "@/modules/services/audit";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T12:00:00Z");

beforeEach(() => {
  setDemoNow(PINNED);
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
});

afterEach(() => {
  setDemoNow(null);
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
});

describe("auditService.listEvents", () => {
  it("returns seeded demo events sorted newest first", async () => {
    const events = await auditService.listEvents();
    expect(events.length).toBeGreaterThanOrEqual(demoAuditEvents.length);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]?.timestampIso.localeCompare(events[i]?.timestampIso ?? "") ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns copies — mutating the result does not affect subsequent reads", async () => {
    const first = await auditService.listEvents();
    if (first[0] !== undefined) first[0].actor = "MUTATED";
    const second = await auditService.listEvents();
    expect(second[0]?.actor).not.toBe("MUTATED");
  });
});

describe("auditService.record", () => {
  it("appends a new event with a deterministic id and pinned timestamp", async () => {
    const recorded = await auditService.record({
      actor: "Test Actor",
      action: "Setting changed",
      target: "test-target",
      outcome: "Success",
      reason: "Test reason",
    });

    expect(recorded.id).toBe(`AUD-2026-${String(demoAuditEvents.length + 1).padStart(3, "0")}`);
    expect(recorded.timestampIso).toBe(PINNED.toISOString());
    expect(recorded.actor).toBe("Test Actor");
    expect(recorded.action).toBe("Setting changed");
    expect(recorded.target).toBe("test-target");
    expect(recorded.outcome).toBe("Success");
    expect(recorded.reason).toBe("Test reason");
  });

  it("is NOT idempotent — calling twice creates two distinct events", async () => {
    const first = await auditService.record({
      actor: "A",
      action: "Login",
      target: "—",
      outcome: "Success",
    });
    const second = await auditService.record({
      actor: "A",
      action: "Login",
      target: "—",
      outcome: "Success",
    });

    expect(first.id).not.toBe(second.id);
    expect(second.id).toBe(`AUD-2026-${String(demoAuditEvents.length + 2).padStart(3, "0")}`);
  });

  it("recorded events appear in listEvents merged with seeded events, newest first", async () => {
    await auditService.record({
      actor: "New",
      action: "Login",
      target: "—",
      outcome: "Success",
    });

    const events = await auditService.listEvents();
    expect(events[0]?.actor).toBe("New");
    expect(events[0]?.timestampIso).toBe(PINNED.toISOString());
  });

  it("persists across reads within the same session", async () => {
    await auditService.record({
      actor: "Persistent",
      action: "Login",
      target: "—",
      outcome: "Success",
    });

    const first = await auditService.listEvents();
    const second = await auditService.listEvents();
    expect(second.some((e) => e.actor === "Persistent")).toBe(true);
    expect(first.length).toBe(second.length);
  });

  it("increments the id counter based on session events, not just seeded count", async () => {
    await auditService.record({ actor: "A", action: "Login", target: "—", outcome: "Success" });
    await auditService.record({ actor: "B", action: "Login", target: "—", outcome: "Success" });
    const third = await auditService.record({ actor: "C", action: "Login", target: "—", outcome: "Success" });

    expect(third.id).toBe(`AUD-2026-${String(demoAuditEvents.length + 3).padStart(3, "0")}`);
  });
});
