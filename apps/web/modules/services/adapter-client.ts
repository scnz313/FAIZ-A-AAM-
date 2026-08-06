/**
 * Client-side adapter gateway (plan.md §10).
 *
 * When the runtime is `FASS_DATA_ADAPTER=supabase`, the browser calls the
 * session-protected `/api/adapter` endpoint, which re-authorizes every
 * operation server-side and returns the canonical `ServiceResult<T>`
 * envelope. In demo mode this module is inert — the demo services own the
 * page state and this function returns `unavailable` so callers fall back.
 *
 * `NEXT_PUBLIC_FASS_DATA_ADAPTER` mirrors the server adapter for client
 * rendering decisions (e.g. showing the sign-in card instead of the demo
 * identity picker); the server env var remains the authority.
 */

import type { ServiceError, ServiceResult } from "@fass/contracts";

export function clientAdapterMode(): "demo" | "supabase" {
  return process.env.NEXT_PUBLIC_FASS_DATA_ADAPTER === "supabase" ? "supabase" : "demo";
}

/** Call one adapter operation; returns the canonical service envelope. */
export async function adapterCall<T>(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<ServiceResult<T>> {
  if (clientAdapterMode() !== "supabase") {
    return {
      ok: false,
      errors: [{ code: "unavailable", message: "The Supabase adapter is not active.", field: null }],
    };
  }
  try {
    const response = await fetch("/api/adapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, payload }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { errors?: Array<{ code: string; message: string }> } | null;
      const error: ServiceError = {
        code: (body?.errors?.[0]?.code ??
          (response.status === 401 ? "unauthenticated" : "unavailable")) as ServiceError["code"],
        message: body?.errors?.[0]?.message ?? `Adapter request failed (${response.status}).`,
        field: null,
      };
      return { ok: false, errors: [error] };
    }
    return (await response.json()) as ServiceResult<T>;
  } catch {
    return { ok: false, errors: [{ code: "unavailable", message: "Adapter unreachable.", field: null }] };
  }
}
