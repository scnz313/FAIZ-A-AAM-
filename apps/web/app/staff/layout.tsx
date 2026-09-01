import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { StaffContextProvider } from "@/components/staff/StaffContextProvider";
import { StaffRouteGuard } from "@/components/staff/StaffRouteGuard";
import { StaffShell } from "@/components/layouts/StaffShell";
import { getServerActor } from "@/lib/auth/actor";
import { dataAdapter, developmentAuthEnabled } from "@/lib/supabase/env";
import { loadServerStaffContext } from "@/lib/supabase/server-loaders";
import { loadServerNotifications } from "@/lib/supabase/server-loaders";
import { mapServerStaffContext } from "@/modules/services/staff-context";
import { isStaffPortalPath, isLegacyStaffPath, portalPrefixForProfile, staffSubPathForPathname } from "@/lib/auth/portal-routes";

/* Indexing protection — staff workspaces contain private operational
   records. This is not authentication; server authorization arrives with
   the backend. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Split the middleware-preserved "pathname?search" header value into the
 * pathname and the safe query string for redirect construction.
 */
function splitPathname(rawPathname: string): { pathname: string; search: string } {
  const queryIndex = rawPathname.indexOf("?");
  if (queryIndex === -1) return { pathname: rawPathname, search: "" };
  return { pathname: rawPathname.slice(0, queryIndex), search: rawPathname.slice(queryIndex) };
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  let initialState;
  let initialNotifications;
  const quickSignIn = developmentAuthEnabled();
  /* The middleware preserves the original canonical path AND query in
     x-fass-pathname; sign-in/TOTP redirects must return the user to that
     exact URL, not collapse it to /staff. */
  const headerList = await headers();
  const rawPathname = headerList.get("x-fass-pathname") ?? "/staff";
  const { pathname, search } = splitPathname(rawPathname);
  const returnTo = `${pathname}${search}`;

  if (dataAdapter() === "supabase") {
    const actor = await getServerActor();
    if (actor === null) redirect(`/sign-in/staff?next=${encodeURIComponent(returnTo)}`);
    if (!actor.roles.some((role) => !["guardian", "student"].includes(role))) {
      if (quickSignIn) redirect(`/sign-in/staff?next=${encodeURIComponent(returnTo)}&switch=staff`);
      redirect("/access-denied");
    }
    if (actor.aal !== "aal2") redirect(`/sign-in/totp?next=${encodeURIComponent(returnTo)}`);
    try {
      const [serverContext, notifications] = await Promise.all([
        loadServerStaffContext(),
        loadServerNotifications(),
      ]);
      initialState = mapServerStaffContext(serverContext);
      initialNotifications = notifications;
    } catch {
      redirect("/access-denied");
    }
  }

  /* Canonical portal redirect: if the request came in on a non-canonical
     prefix (e.g. /staff/* or the wrong portal), redirect to the profile's
     canonical prefix with the safe suffix AND query string preserved. */
  if (initialState?.summary?.profileCode) {
    const expectedPrefix = portalPrefixForProfile(initialState.summary.profileCode);
    if (expectedPrefix !== null) {
      /* A profile account must never render under the wrong prefix or the
         legacy /staff tree: redirect to the canonical prefix with the
         sub-path and query string preserved. */
      if (isLegacyStaffPath(pathname) || (isStaffPortalPath(pathname) && !pathname.startsWith(expectedPrefix))) {
        const currentSubPath = staffSubPathForPathname(pathname);
        redirect(`${expectedPrefix}${currentSubPath}${search}`);
      }
    }
  }

  return (
    <StaffContextProvider initialState={initialState}>
      <StaffShell initialNotifications={initialNotifications} developmentAuth={quickSignIn}>
        <StaffRouteGuard>{children}</StaffRouteGuard>
      </StaffShell>
    </StaffContextProvider>
  );
}
