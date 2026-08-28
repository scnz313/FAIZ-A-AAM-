import "server-only";

import { cookies, headers } from "next/headers";

import type { ServiceError, ServiceResult } from "@fass/contracts";

function requestOrigin(headerStore: Headers): string {
  const forwardedHost = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (forwardedHost !== null && forwardedHost.length > 0) {
    const forwardedProto = headerStore.get("x-forwarded-proto") ?? "http";
    return `${forwardedProto.split(",")[0]?.trim() ?? "http"}://${forwardedHost.split(",")[0]?.trim()}`.replace(/\/$/, "");
  }
  const configured = process.env.APP_URL?.trim();
  if (configured !== undefined && configured.length > 0) return configured.replace(/\/$/, "");
  throw new Error("APP_URL is required for server adapter calls.");
}

/**
 * Request-aware server adapter call. Server Components cannot rely on a
 * relative fetch carrying the incoming Auth cookie, so this boundary forwards
 * only the current request cookie and never accepts caller-supplied identity.
 */
export async function serverAdapterCall<T>(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<ServiceResult<T>> {
  try {
    const cookieStore = await cookies();
    const headerStore = await headers();
    const origin = requestOrigin(headerStore);
    const correlationId = headerStore.get("x-correlation-id") ?? crypto.randomUUID();
    const response = await fetch(`${origin}/api/adapter`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieStore.toString(),
        Origin: origin,
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({ op, payload }),
      cache: "no-store",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { errors?: Array<{ code: string; message: string; retryable?: boolean }>; correlationRef?: string; httpStatus?: number; retryable?: boolean; currentVersion?: number; currentState?: unknown } | null;
      const error: ServiceError = {
        code: (body?.errors?.[0]?.code ?? (response.status === 401 ? "unauthenticated" : "unavailable")) as ServiceError["code"],
        message: body?.errors?.[0]?.message ?? `Adapter request failed (${response.status}).`,
        field: null,
        retryable: body?.errors?.[0]?.retryable,
      };
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
    return (await response.json()) as ServiceResult<T>;
  } catch {
    return { ok: false, errors: [{ code: "unavailable", message: "Adapter unreachable.", field: null }], httpStatus: 503, retryable: true };
  }
}
