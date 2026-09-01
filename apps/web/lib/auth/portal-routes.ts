/**
 * Canonical portal URL helpers for the three-portal consolidation.
 *
 * The signed-in product exposes exactly three portal experiences:
 * - Administrator → `/administrator/*`
 * - Principal → `/principal/*`
 * - Guardian → `/portal/*`
 *
 * The legacy `/staff/*` tree remains the shared implementation root for both
 * staff portals; the staff layout redirects to the canonical portal prefix
 * based on the active access profile. These helpers keep route construction
 * consistent across server components, client components, and audit logging.
 */

import type { StaffProfileCode } from "@fass/contracts";

export type PortalPrefix = "/administrator" | "/principal" | "/portal";

export const STAFF_PORTAL_PREFIXES: ReadonlyArray<PortalPrefix> = ["/administrator", "/principal"];

const PREFIX_FOR_PROFILE: Readonly<Record<StaffProfileCode, Exclude<PortalPrefix, "/portal">>> = {
  administrator: "/administrator",
  principal: "/principal",
};

/**
 * The canonical portal prefix for a staff access profile. Returns null for
 * accounts without an active profile (legacy/custom staff) so the caller can
 * route them to the shared `/staff` root for reconciliation.
 */
export function portalPrefixForProfile(profileCode: StaffProfileCode | null | undefined): PortalPrefix | null {
  if (profileCode === null || profileCode === undefined) return null;
  return PREFIX_FOR_PROFILE[profileCode] ?? null;
}

/**
 * Resolve a canonical staff portal URL for a profile (or an already-resolved
 * portal prefix) and a sub-path. The sub-path is expressed relative to the
 * shared `/staff` root (e.g. `/users`, `/finance`) so the same call site works
 * during and after the consolidation.
 *
 * Returns the legacy `/staff<subPath>` URL when the profile is unknown so the
 * staff layout can reconcile the account. The root sub-path ("/" or "") maps
 * to the exact portal root with no trailing slash.
 */
export function canonicalStaffUrl(profile: PortalPrefix | StaffProfileCode | null | undefined, subPath: string): string {
  /* Accept either a profile code or an already-resolved prefix; both map to
     the same canonical prefix without falling back to /staff. */
  const prefix = profile === "/administrator" || profile === "/principal" || profile === "/portal"
    ? (profile as PortalPrefix)
    : portalPrefixForProfile(profile as StaffProfileCode | null | undefined);
  const trimmed = subPath.replace(/\/+$/, "");
  const normalized = trimmed === "" ? "" : trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (prefix === null) return `/staff${normalized}`;
  return `${prefix}${normalized}`;
}

/**
 * The shared `/staff` root sub-path for a canonical or legacy staff portal
 * URL. Used by the staff layout and route guard to map an incoming
 * `/administrator/users` request back to the shared `/staff/users`
 * implementation. Returns "" for any non-staff pathname.
 */
export function staffSubPathForPathname(pathname: string): string {
  for (const prefix of STAFF_PORTAL_PREFIXES) {
    if (pathname === prefix) return "";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  if (pathname === "/staff") return "";
  if (pathname.startsWith("/staff/")) return pathname.slice("/staff".length);
  return "";
}

/** True when the pathname targets a canonical staff portal prefix. */
export function isStaffPortalPath(pathname: string): boolean {
  return STAFF_PORTAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** True when the pathname targets the shared legacy staff implementation. */
export function isLegacyStaffPath(pathname: string): boolean {
  return pathname === "/staff" || pathname.startsWith("/staff/");
}

/** True when the pathname belongs to any staff surface (canonical or legacy). */
export function isStaffPath(pathname: string): boolean {
  return isStaffPortalPath(pathname) || isLegacyStaffPath(pathname);
}
