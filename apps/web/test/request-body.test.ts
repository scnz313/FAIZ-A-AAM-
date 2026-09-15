// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readJsonBounded } from "@/lib/http/request-body";

function jsonRequest(body: string | Blob): Request {
  return new Request("http://localhost/test", { method: "POST", headers: { "content-type": "application/json" }, body });
}

describe("readJsonBounded", () => {
  it("parses a valid JSON body within the cap", async () => {
    const result = await readJsonBounded(jsonRequest('{"a":1}'), 64);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("reports too_large as soon as the byte cap is crossed", async () => {
    const result = await readJsonBounded(jsonRequest(JSON.stringify({ message: "x".repeat(200) })), 64);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("reports malformed JSON and non-UTF-8 bytes as invalid", async () => {
    expect(await readJsonBounded(jsonRequest("{"), 64)).toEqual({ ok: false, reason: "invalid" });
    expect(await readJsonBounded(jsonRequest(new Blob([new Uint8Array([0xff, 0xfe, 0xfd])])), 64)).toEqual({ ok: false, reason: "invalid" });
    expect(await readJsonBounded(new Request("http://localhost/test", { method: "POST" }), 64)).toEqual({ ok: false, reason: "invalid" });
  });
});
