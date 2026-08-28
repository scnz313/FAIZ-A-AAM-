// @vitest-environment node
/**
 * Contract tests for the demo-session store (modules/services/session.ts).
 * Verifies get/set/remove semantics, namespaced key generation, overwrite
 * behavior, complex object round-tripping, and no-throw guarantees. Keys
 * are cleared between tests to isolate state.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sessionGet, sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";

const TEST_KEY = "fass-test:session-service";

beforeEach(() => {
  sessionRemove(TEST_KEY);
});

afterEach(() => {
  sessionRemove(TEST_KEY);
});

describe("sessionSet / sessionGet", () => {
  it("returns the same value that was set", () => {
    sessionSet(TEST_KEY, { hello: "world" });
    expect(sessionGet<{ hello: string }>(TEST_KEY)).toEqual({ hello: "world" });
  });

  it("returns null for a key that was never set", () => {
    expect(sessionGet("fass-test:never-set")).toBeNull();
  });

  it("overwrites a previous value for the same key", () => {
    sessionSet(TEST_KEY, "first");
    sessionSet(TEST_KEY, "second");
    expect(sessionGet<string>(TEST_KEY)).toBe("second");
  });

  it("handles complex objects (arrays and nested objects)", () => {
    const value = {
      list: [1, 2, 3],
      nested: { a: { b: { c: 42 } } },
      mixed: [{ x: true }, null, "end"],
    };
    sessionSet(TEST_KEY, value);
    expect(sessionGet<typeof value>(TEST_KEY)).toEqual(value);
  });
});

describe("sessionRemove", () => {
  it("clears a previously set key", () => {
    sessionSet(TEST_KEY, "to-remove");
    sessionRemove(TEST_KEY);
    expect(sessionGet(TEST_KEY)).toBeNull();
  });

  it("does not throw when removing a non-existent key", () => {
    expect(() => sessionRemove("fass-test:absent")).not.toThrow();
  });
});

describe("sessionKey", () => {
  it("generates a namespaced prefix for a custom domain", () => {
    expect(sessionKey("custom-key")).toBe("fass-demo:custom-key");
  });
});
