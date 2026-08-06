/**
 * Browser Supabase client (plan.md §10): used ONLY for authentication/session
 * interaction when necessary. Protected business data is loaded through server
 * components and domain services, never through this client.
 *
 * Uses the new-format publishable key (browser-visible by design) — never the
 * secret key, and never legacy anon/service_role JWTs (plan.md §3).
 */

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/database.types";
import { requireSupabasePublicEnv } from "@/lib/supabase/env";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** Lazily create (and reuse) the browser client for the current page. */
export function createSupabaseBrowserClient() {
  if (client !== null) return client;
  const { url, publishableKey } = requireSupabasePublicEnv();
  client = createBrowserClient<Database>(url, publishableKey);
  return client;
}
