import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StaffContextProvider } from "@/components/staff/StaffContextProvider";
import { StaffRouteGuard } from "@/components/staff/StaffRouteGuard";
import { StaffShell } from "@/components/layouts/StaffShell";
import { getServerActor } from "@/lib/auth/actor";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerStaffContext } from "@/lib/supabase/server-loaders";
import { loadServerNotifications } from "@/lib/supabase/server-loaders";
import { mapServerStaffContext } from "@/modules/services/staff-context";

/* Indexing protection — staff workspaces contain private operational
   records. This is not authentication; server authorization arrives with
   the backend. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  let initialState;
  let initialNotifications;
  if (dataAdapter() === "supabase") {
    const actor = await getServerActor();
    if (actor === null) redirect(`/sign-in?next=${encodeURIComponent("/staff")}`);
    if (actor.aal !== "aal2") redirect(`/sign-in/totp?next=${encodeURIComponent("/staff")}`);
    if (!actor.roles.some((role) => !["guardian", "student"].includes(role))) redirect("/access-denied");
    try {
      initialState = mapServerStaffContext(await loadServerStaffContext());
      initialNotifications = await loadServerNotifications();
    } catch {
      redirect("/access-denied");
    }
  }
  return (
    <StaffContextProvider initialState={initialState}>
      <StaffShell initialNotifications={initialNotifications}>
        <StaffRouteGuard>{children}</StaffRouteGuard>
      </StaffShell>
    </StaffContextProvider>
  );
}
