import "server-only";

/**
 * Bounded JSON body reader for public (unauthenticated) intake routes.
 *
 * Next.js route handlers have no default request-body size limit, and the
 * public intake routes previously called `request.json()` before their rate
 * limits, so an attacker could force unbounded buffering and JSON parsing
 * without ever touching the limiter. This helper streams the body, aborts as
 * soon as it exceeds the caller's cap, and only then parses strict UTF-8
 * JSON. Oversized bodies are reported separately from malformed ones so the
 * route can answer 413 instead of a misleading 400.
 */
export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid" };

export async function readJsonBounded(request: Request, maxBytes: number): Promise<BoundedJsonResult> {
  const body = request.body;
  if (body === null) return { ok: false, reason: "invalid" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Plain JSON payloads (application, support concern): a generous cap. */
export const PUBLIC_JSON_MAX_BYTES = 64 * 1024;

/** Small identifier/declaration payloads (auth, photo intent/finalize). */
export const SMALL_JSON_MAX_BYTES = 8 * 1024;
