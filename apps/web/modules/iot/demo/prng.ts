/**
 * Deterministic pseudo-random number helpers for the demo data layer.
 *
 * Everything here is pure: given the same seed stream you always get the same
 * sequence, so demo data is reproducible across server and client.
 */

export type Rng = () => number;

/**
 * mulberry32 — a small, fast, deterministic 32-bit PRNG.
 * Returns a function that yields floats in [0, 1).
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic string hash (FNV-1a) used to derive stream seeds. */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Uniform float in [min, max) drawn from the given stream. */
export function rand(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Uniform pick from a non-empty array, drawn from the given stream. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick() from an empty array");
  const item = arr[Math.floor(rng() * arr.length)];
  if (item === undefined) throw new Error("pick() index out of range");
  return item;
}

/** Approximately-normal value via Box–Muller, drawn from the given stream. */
export function gauss(rng: Rng, mean: number, sd: number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
