"use client";

import { useEffect, useRef, useState } from "react";

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
  /** Test seam. Production replaces the current history entry. */
  navigate?: (href: string) => void;
};

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
export default function AuthHashHandler({ next = null, navigate }: AuthHashHandlerProps) {
  const [failed, setFailed] = useState(false);
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    const tokens = readAuthHashTokens(window.location.hash);
    if (tokens === null) return;
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
        setFailed(true);
        return;
      }
      const requested = safeAuthRedirect(next, null);
      const destination = requested ?? (tokens.type === "invite" ? "/sign-in/invite" : DEFAULT_STAFF_PORTAL);
      if (navigate !== undefined) navigate(destination);
      else window.location.replace(destination);
    })();
  }, [next, navigate]);

  if (!failed) return null;
  return (
    <p className="alert-strip alert-strip--warning" role="alert" style={{ marginBottom: 16 }}>
      This link could not start a sign-in session. It may have expired or already been used. Reopen the newest
      email from the school, or request a fresh link below.
    </p>
  );
}
