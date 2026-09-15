/**
 * Anonymous publishable-key Supabase client for deliberately public
 * projections (published vacancies, the public register).
 *
 * The request-aware server client carries the caller session, which makes a
 * signed-in applicant an `authenticated` role; public RLS policies written
 * `to anon` then no longer match. This client never carries the session, so
 * RLS evaluates exactly as it does for an anonymous visitor. It must never be
 * used for protected reads or writes.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { requireSupabasePublicEnv } from "@/lib/supabase/env";

export function createSupabasePublicClient(): SupabaseClient<Database> {
  const { url, publishableKey } = requireSupabasePublicEnv();
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
