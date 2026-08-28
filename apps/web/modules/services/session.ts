/**
 * Demo-session store shared by the service demo adapters.
 *
 * Client-side demo persistence: submitted applications, payments, and
 * responses survive route changes within the browser session, and the
 * pages read them back through the same adapter — so a submitted state is
 * always returned by the demo service, never implied by a local click.
 * Nothing here persists across browser sessions, and nothing is secure:
 * the real backend replaces these adapters wholesale.
 */

const memory = new Map<string, unknown>();

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

export function sessionGet<T>(key: string): T | null {
  if (hasStorage()) {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* fall through to the in-memory copy */
    }
  }
  return (memory.get(key) as T | undefined) ?? null;
}

export function sessionSet(key: string, value: unknown): void {
  memory.set(key, value);
  if (hasStorage()) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage may be full or blocked — the in-memory copy still works */
    }
  }
}

export function sessionRemove(key: string): void {
  memory.delete(key);
  if (hasStorage()) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** Namespace prefix so demo keys never collide with real storage later. */
export function sessionKey(domain: string): string {
  return `fass-demo:${domain}`;
}

/** Clear client-side protected/demo context after a server denial. Supabase
 * authorization is never based on these values; this prevents revoked family
 * or staff rows from lingering in an already-mounted shell. */
export function clearProtectedClientState(): void {
  const keys = [
    sessionKey("identity"),
    sessionKey("relationships"),
    sessionKey("staff-identity"),
    sessionKey("active-child"),
    sessionKey("active-workspace"),
  ];
  for (const key of keys) sessionRemove(key);
}
