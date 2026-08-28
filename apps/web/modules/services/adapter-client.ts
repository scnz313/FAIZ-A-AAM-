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
import { clearProtectedClientState } from "@/modules/services/session";

export function clientAdapterMode(): "demo" | "supabase" {
  const publicAdapter = process.env.NEXT_PUBLIC_FASS_DATA_ADAPTER;
  if (publicAdapter !== undefined && publicAdapter !== "demo" && publicAdapter !== "supabase") {
    throw new Error("NEXT_PUBLIC_FASS_DATA_ADAPTER must be demo or supabase.");
  }
  return publicAdapter === "supabase" ? "supabase" : "demo";
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
      httpStatus: 503,
      retryable: true,
    };
  }
  /* Server Components must use the server-only loader directly so the
     incoming Auth cookie can be forwarded safely. This browser gateway
     intentionally refuses to make an unauthenticated relative server fetch. */
  if (typeof window === "undefined") {
    return { ok: false, errors: [{ code: "unavailable", message: "Use the server adapter boundary for server-rendered data.", field: null }], httpStatus: 503, retryable: true };
  }
  try {
    const response = await fetch("/api/adapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, payload }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { errors?: Array<{ code: string; message: string; retryable?: boolean }>; correlationRef?: string; httpStatus?: number; retryable?: boolean; currentVersion?: number; currentState?: unknown } | null;
      const error: ServiceError = {
        code: (body?.errors?.[0]?.code ??
          (response.status === 401 ? "unauthenticated" : "unavailable")) as ServiceError["code"],
        message: body?.errors?.[0]?.message ?? `Adapter request failed (${response.status}).`,
        field: null,
        retryable: body?.errors?.[0]?.retryable,
      };
      if (response.status === 401 || response.status === 403 || error.code === "unauthenticated" || error.code === "forbidden") {
        clearProtectedClientState();
      }
      return {
        ok: false,
        errors: [error],
        correlationRef: body?.correlationRef ?? response.headers.get("X-Correlation-Id") ?? undefined,
        httpStatus: body?.httpStatus ?? response.status,
        retryable: body?.retryable ?? response.status >= 500,
        currentVersion: body?.currentVersion,
        currentState: body?.currentState,
      };
    }
    const result = (await response.json()) as ServiceResult<T>;
    if (!result.ok && (result.errors[0]?.code === "unauthenticated" || result.errors[0]?.code === "forbidden")) {
      clearProtectedClientState();
    }
    return result;
  } catch {
    return { ok: false, errors: [{ code: "unavailable", message: "Adapter unreachable.", field: null }], httpStatus: 503, retryable: true };
  }
}
