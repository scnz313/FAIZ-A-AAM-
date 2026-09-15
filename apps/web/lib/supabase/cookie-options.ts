/**
 * Shared auth-cookie options for the Supabase SSR clients.
 *
 * `@supabase/ssr` defaults to a 400-day, non-Secure cookie. The browser
 * client must be able to read the session cookie, so `httpOnly` stays false
 * until the server-mediated refresh design is adopted; `secure` is enforced
 * everywhere except local development over plain HTTP. Blueprint deviation
 * (HttpOnly) is recorded in PROJECT-STATUS.md.
 */
export const AUTH_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
} as const;
