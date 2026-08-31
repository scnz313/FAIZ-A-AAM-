/**
 * Server actor resolver (plan.md §4): the authorized identity for a server
 * request, resolved from the Supabase session AND the database.
 *
 * Rules enforced here:
 * - Identity is validated with verified `getClaims()` — never `getSession()`
 *   alone.
 * - Roles, account status, and the access-revalidation security version are
 *   read from database tables on every call; `user_metadata` is never
 *   authorization.
 * - A revoked grant, suspended account, or bumped security version changes
 *   the actor on the next request even while the JWT is still valid.
 * - Demo mode returns null (the demo identity service owns that path).
 */

import { cache } from "react";

import { dataAdapter } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ServerActor = {
  /** auth.users.id */
  userId: string;
  /** user_accounts.id (= auth.users.id) */
  accountId: string;
  personId: string;
  displayName: string;
  accountStatus: "invited" | "active" | "suspended" | "closed";
  /** Active canonical role codes (from role_grants, effective now). */
  roles: string[];
  /** access_revalidation.security_version — invalidated access is visible here. */
  securityVersion: number;
  /** Verified Supabase Authenticator Assurance Level for this request. */
  aal: "aal1" | "aal2" | null;
};

/**
 * Resolve the authorized actor for the current request, or null when there
 * is no valid session, no provisioned account, or the account is not active.
 */
const resolveServerActor = async (): Promise<ServerActor | null> => {
  if (dataAdapter() !== "supabase") return null;

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError !== null || claimsData === null) return null;
  const userId = claimsData.claims.sub;
  if (typeof userId !== "string" || userId.length === 0) return null;

  const nowIso = new Date().toISOString();
  const [{ data: account }, { data: grants }, { data: revalidation }] = await Promise.all([
    supabase
      .from("user_accounts")
      .select("id, person_id, status, people(id, display_name)")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("role_grants")
      .select("role_code")
      .eq("account_id", userId)
      .eq("status", "active")
      .lte("effective_from", nowIso)
      .or(`effective_to.is.null,effective_to.gt.${nowIso}`),
    supabase
      .from("access_revalidation")
      .select("security_version")
      .eq("account_id", userId)
      .maybeSingle(),
  ]);

  if (account === null || account.people === null) return null;
  if (account.status !== "active") return null;

  return {
    userId,
    accountId: account.id,
    personId: account.person_id,
    displayName: account.people.display_name,
    accountStatus: account.status,
    roles: (grants ?? []).map((grant) => grant.role_code),
    securityVersion: revalidation?.security_version ?? 0,
    aal: claimsData.claims.aal === "aal2" ? "aal2" : claimsData.claims.aal === "aal1" ? "aal1" : null,
  };
};

export const getServerActor = cache(resolveServerActor);

/** Convenience: does the current actor hold an active role code? */
export async function actorHasRole(role: string): Promise<boolean> {
  const actor = await getServerActor();
  return actor !== null && actor.roles.includes(role);
}
