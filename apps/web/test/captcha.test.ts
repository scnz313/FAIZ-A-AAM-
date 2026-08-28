// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { captchaAdapter, localCaptchaAdapter, setCaptchaAdapter } from "@/lib/support/captcha";

afterEach(() => {
  setCaptchaAdapter(null);
  vi.unstubAllEnvs();
});

describe("CAPTCHA adapter boundary", () => {
  it("fails closed in production even when a token is supplied to the local adapter", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = await captchaAdapter().verify({ token: "looks-real", ipAddress: "127.0.0.1" });
    expect(result.ok).toBe(false);
    expect(result.provider).toBe("unconfigured");
  });

  it("allows local tests to inject a deterministic verifier", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setCaptchaAdapter({ verify: async () => ({ ok: true, provider: "test", verifiedAt: "2026-08-24T00:00:00Z" }) });
    await expect(captchaAdapter().verify({ token: "test", ipAddress: "127.0.0.1" })).resolves.toMatchObject({ ok: true, provider: "test" });
    expect(localCaptchaAdapter).toBeDefined();
  });
});
