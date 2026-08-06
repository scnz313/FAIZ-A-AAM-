import "@testing-library/jest-dom/vitest";

/*
 * jsdom does not implement window.matchMedia, which the portal/staff
 * shells use to detect the mobile drawer breakpoint. Any test that
 * renders a shell gets this minimal stub instead of a "not implemented"
 * throw. Component tests that render shells also stub next/navigation
 * (useRouter/usePathname/useSearchParams) in the test file itself.
 */
if (typeof window !== "undefined") {
  window.matchMedia =
    window.matchMedia ||
    ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
}
