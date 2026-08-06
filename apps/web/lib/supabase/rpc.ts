/**
 * Typed transactional RPC surface (plan.md §10: "Transactional RPC wrappers").
 *
 * The transactional commands live in the private `app` schema (plan.md §7)
 * and are exposed to PostgREST via `pgrst.db_schemas = "public, app"`
 * (supabase/config.toml `[api] schemas`). The generated `Database` type now
 * carries the `app` schema; this helper routes calls through the
 * schema-scoped client and keeps the per-call generic result type. Callers
 * in `lib/supabase/domain.ts` never use a raw `any`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type RpcError = {
  message: string;
  hint?: string;
  details?: string;
  code?: string;
};

export type RpcResult<T> = { data: T | null; error: RpcError | null };

type ScopedRpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult<unknown>>;

/** Call a function in the private `app` schema with typed result `T`. */
export async function callAppRpc<T>(
  client: SupabaseClient<Database>,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const scoped = client.schema("app") as unknown as { rpc: ScopedRpc };
  const result = await scoped.rpc(fn, args);
  return result as RpcResult<T>;
}
