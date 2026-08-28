import "server-only";

/**
 * CAPTCHA is a boundary, not a provider dependency.  Slice 5's local
 * sandbox verifier records that the boundary was crossed; production must
 * supply a real verifier before public intake is enabled.
 */
export type CaptchaVerification = {
  ok: boolean;
  provider: string;
  verifiedAt: string | null;
};

export interface CaptchaAdapter {
  verify(input: { token: string | null; ipAddress: string }): Promise<CaptchaVerification>;
}

export const localCaptchaAdapter: CaptchaAdapter = {
  async verify({ token }) {
    const production = process.env.NODE_ENV === "production";
    if (production) {
      return { ok: false, provider: "unconfigured", verifiedAt: null };
    }
    if (!token || token.trim() === "") {
      return { ok: true, provider: "local-sandbox", verifiedAt: new Date().toISOString() };
    }
    return { ok: true, provider: "local-sandbox", verifiedAt: new Date().toISOString() };
  },
};

let injectedAdapter: CaptchaAdapter | null = null;

/** Tests/local hosts may inject a real deterministic verifier. Production
 * never accepts the local adapter merely because a token was supplied. */
export function setCaptchaAdapter(adapter: CaptchaAdapter | null): void {
  injectedAdapter = adapter;
}

export function captchaAdapter(): CaptchaAdapter {
  return injectedAdapter ?? localCaptchaAdapter;
}
