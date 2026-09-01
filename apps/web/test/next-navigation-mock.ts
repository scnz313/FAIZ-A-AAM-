/**
 * Global mock for next/navigation used in vitest. Individual test files
 * that need more specific behavior can still call vi.mock("next/navigation")
 * to override this.
 */
export function useRouter() {
  return {
    refresh: () => {},
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  };
}

export function usePathname() {
  return "/";
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function redirect() {}
