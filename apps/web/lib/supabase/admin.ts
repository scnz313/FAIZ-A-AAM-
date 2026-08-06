/**
 * Server-admin Supabase client (plan.md §7, §10): uses the secret key, which
 * BYPASSES RLS. Restricted to webhooks, outbox processing, Auth
 * administration, and controlled maintenance — never used for ordinary
 * application reads/writes, which must go through RLS-aware repositories and
 * domain services.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { requireSupabasePublicEnv, requireSupabaseSecretEnv } from "@/lib/supabase/env";

let admin: SupabaseClient<Database> | null = null;

/** Lazily create (and reuse) the admin client on the server. */
export function createSupabaseAdminClient() {
  if (admin !== null) return admin;
  const { url } = requireSupabasePublicEnv();
  const { secretKey } = requireSupabaseSecretEnv();
  admin = createClient<Database>(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return admin;
}
