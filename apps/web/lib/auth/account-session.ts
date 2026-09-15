import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Account suspension/reactivation companion: a suspended account must not
 * keep a provider refresh token. `user_accounts.id` is the Auth user id, so
 * the ban is applied directly. Best-effort: the database predicates already
 * deny every read for a suspended account, and this helper never throws.
 */
export async function setAccountProviderBan(accountId: string, banned: boolean): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.updateUserById(accountId, {
      ban_duration: banned ? "876000h" : "none",
    });
    return error === null;
  } catch {
    return false;
  }
}
