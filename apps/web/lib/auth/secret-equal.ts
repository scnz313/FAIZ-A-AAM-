import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for server-issued bearer secrets. Avoids the
 * timing side channel of `===` on high-entropy secrets while keeping the
 * same length-check semantics.
 */
export function secretsMatch(candidate: string | null | undefined, expected: string): boolean {
  if (candidate === null || candidate === undefined || expected.length === 0) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
