/**
 * Server-user Supabase client (plan.md §4, §10): per-request SSR client using
 * the Next.js 15 cookie convention (`cookies()` is async in this version —
 * do not copy a Next.js 16 `proxy.ts` example without adapting it).
 *
 * Authorization rules:
 * - Validate identity with `getUser()` (or `getClaims()`); never authorize
 *   from `getSession()` alone.
 * - Roles, scopes, assignments, account status, and guardian links are read
 *   from database tables on every protected operation — never from
 *   `user_metadata` (plan.md §4).
 */

import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/supabase/database.types";
import { requireSupabasePublicEnv } from "@/lib/supabase/env";

export const createSupabaseServerClient = cache(async () => {
  const { url, publishableKey } = requireSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — safe to ignore when middleware
          // or a Route Handler refreshes the session instead.
        }
      },
    },
  });
});
