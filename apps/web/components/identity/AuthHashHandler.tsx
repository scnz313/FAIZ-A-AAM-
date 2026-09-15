"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { DEFAULT_STAFF_PORTAL } from "@/lib/auth/portal-routes";
import { safeAuthRedirect } from "@/lib/auth/redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type AuthHashTokens = {
  accessToken: string;
  refreshToken: string;
  type: string | null;
};

type AuthHashHandlerProps = {
  /** Raw `next` from the sign-in URL; re-validated here before use. */
  next?: string | null;
  required?: boolean;
  exchangeError?: boolean;
  /** Test seam. Production replaces the current history entry. */
  navigate?: (href: string) => void;
};

const EXPIRED_LINK_MESSAGE = "This link has expired or was already used. Ask the administrator to resend the invitation, or use recovery if you already set a password.";
const REJECTED_LINK_MESSAGE = "The sign-in provider rejected this link.";

export function readAuthHashError(hash: string): { error: string | null; errorCode: string | null } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return null;
  const params = new URLSearchParams(raw);
  const errorCode = params.get("error_code");
  const error = params.get("error");
  return errorCode === null && error === null ? null : { error, errorCode };
}

/**
 * Read the implicit-flow session tokens a provider invite link appends to the
 * redirect URL hash (`#access_token=…&refresh_token=…&type=invite`). Returns
 * null for anything that is not a complete session, so PKCE `?code=` links
 * and ordinary visits are never touched.
 */
export function readAuthHashTokens(hash: string): AuthHashTokens | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return null;
  const params = new URLSearchParams(raw);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken === null || refreshToken === null || accessToken === "" || refreshToken === "") return null;
  return { accessToken, refreshToken, type: params.get("type") };
}

/**
 * Consume provider invite links that carry the session in the URL hash. The
 * server callback can never see a hash, so this component establishes the
 * session through the browser client (which persists the auth cookies),
 * strips the tokens from the address bar, and continues to a safe in-app
 * destination. Failures render an honest, recoverable message instead of a
 * silent dead end. PKCE `?code=` links never take this path.
 */
export default function AuthHashHandler({ next = null, required = false, exchangeError = false, navigate }: AuthHashHandlerProps) {
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    const hashError = readAuthHashError(window.location.hash);
    if (hashError !== null) {
      consumed.current = true;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setFailureMessage(hashError.errorCode === "otp_expired" ? EXPIRED_LINK_MESSAGE : REJECTED_LINK_MESSAGE);
      return;
    }
    const tokens = readAuthHashTokens(window.location.hash);
    if (tokens === null) {
      if (required || exchangeError) setFailureMessage(EXPIRED_LINK_MESSAGE);
      return;
    }
    consumed.current = true;
    /* Remove the tokens from the visible URL and history before the async
       exchange so a refresh or back navigation cannot replay them. */
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    void (async () => {
      let failedSession = false;
      try {
        const { error } = await createSupabaseBrowserClient().auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });
        failedSession = error !== null;
      } catch {
        failedSession = true;
      }
      if (failedSession) {
        setFailureMessage(EXPIRED_LINK_MESSAGE);
        return;
      }
      const requested = safeAuthRedirect(next, null);
      const destination = requested ?? (tokens.type === "invite" ? "/sign-in/invite" : DEFAULT_STAFF_PORTAL);
      if (navigate !== undefined) navigate(destination);
      else window.location.replace(destination);
    })();
  }, [exchangeError, next, navigate, required]);

  if (failureMessage === null) {
    return required ? (
      <div role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Completing sign-in…</span>
        <span className="skeleton-rule" aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "76%" }} aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "58%" }} aria-hidden="true" />
      </div>
    ) : null;
  }
  return (
    <div className="alert-strip alert-strip--warning" role="alert" style={{ marginBottom: 16 }}>
      <p style={{ margin: 0 }}>{failureMessage}</p>
      <div className="row" style={{ flexWrap: "wrap", marginTop: 12 }}>
        <Link className="underline-link" href="/sign-in">Back to sign in</Link>
        <Link className="underline-link" href="/sign-in/recovery">Account recovery</Link>
      </div>
    </div>
  );
}
