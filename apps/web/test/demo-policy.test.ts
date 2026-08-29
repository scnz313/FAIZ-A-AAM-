// @vitest-environment node
/**
 * Contract tests for the explicit fictional demo policy
 * (modules/services/demo-policy.ts): deterministic defaults, session
 * persistence, unknown-key rejection, and reset.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEMO_POLICY_META,
  DEMO_POLICY_SESSION_KEY_EXPORT,
  getDemoPolicy,
  resetDemoPolicy,
  setDemoPolicy,
} from "@/modules/services/demo-policy";
import { sessionRemove } from "@/modules/services/session";

beforeEach(() => {
  sessionRemove(DEMO_POLICY_SESSION_KEY_EXPORT);
});

afterEach(() => {
  sessionRemove(DEMO_POLICY_SESSION_KEY_EXPORT);
});

describe("demo policy defaults", () => {
  it("enables the core fictional workflows by default", () => {
    const policy = getDemoPolicy();
    expect(policy["admission.withdrawal"]).toBe(true);
    expect(policy["finance.adjustments"]).toBe(true);
    expect(policy["finance.refunds"]).toBe(true);
    expect(policy["finance.reconciliation"]).toBe(true);
    expect(policy["careers.scorecards"]).toBe(true);
    expect(policy["support.assignment"]).toBe(true);
  });

  it("keeps delivery failure simulation off by default", () => {
    expect(getDemoPolicy()["delivery.failures"]).toBe(false);
  });

  it("exposes a label and help for every key", () => {
    const keys = Object.keys(getDemoPolicy());
    expect(DEMO_POLICY_META.map((meta) => meta.key).sort()).toEqual(keys.sort());
    for (const meta of DEMO_POLICY_META) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.help.length).toBeGreaterThan(0);
    }
  });
});

describe("demo policy updates", () => {
  it("persists a flipped rule in the session", () => {
    setDemoPolicy("delivery.failures", true);
    expect(getDemoPolicy()["delivery.failures"]).toBe(true);
    /* Other rules stay at their defaults. */
    expect(getDemoPolicy()["admission.withdrawal"]).toBe(true);
  });

  it("returns a copy — mutating the result never mutates the store", () => {
    const first = getDemoPolicy();
    first["finance.refunds"] = false;
    expect(getDemoPolicy()["finance.refunds"]).toBe(true);
  });

  it("throws for an unknown key", () => {
    expect(() => setDemoPolicy("nope" as never, true)).toThrow(/Unknown demo policy key/);
  });

  it("resetDemoPolicy restores the fictional defaults", () => {
    setDemoPolicy("delivery.failures", true);
    setDemoPolicy("support.assignment", false);
    resetDemoPolicy();
    const policy = getDemoPolicy();
    expect(policy["delivery.failures"]).toBe(false);
    expect(policy["support.assignment"]).toBe(true);
  });
});
