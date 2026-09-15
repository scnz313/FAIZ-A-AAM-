import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { FamilyContextProvider } from "@/components/portal/FamilyContextProvider";
import { PortalShell } from "@/components/layouts/PortalShell";
import { getServerActor } from "@/lib/auth/actor";
import { dataAdapter, developmentAuthEnabled } from "@/lib/supabase/env";
import { loadServerFamilyContext } from "@/lib/supabase/server-loaders";
import { loadServerDocuments, loadServerNotifications } from "@/lib/supabase/server-loaders";
import { mapServerFamilyContext } from "@/modules/services/family-context";

/* Indexing protection — the portal contains private family records. This is
   not authentication; server authorization arrives with the backend. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  let initialState;
  let initialNotifications;
  const quickSignIn = developmentAuthEnabled();
  /* The middleware preserves the original pathname AND query in
     x-fass-pathname; sign-in redirects must return the user to that exact
     URL, not collapse it to /portal. */
  const headerList = await headers();
  const returnTo = headerList.get("x-fass-pathname") ?? "/portal";
  if (dataAdapter() === "supabase") {
    const actor = await getServerActor();
    if (actor === null) {
      redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
    }
    if (!actor.roles.includes("guardian")) {
      if (quickSignIn) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}&switch=family`);
      redirect("/access-denied");
    }
    try {
      const serverContext = mapServerFamilyContext(await loadServerFamilyContext());
      /* Notifications and document metadata are conveniences, not access
         gates: a transient failure must not deny the whole family portal.
         Each page surfaces its own error-with-retry state instead. */
      const [documentMetadata, notifications] = await Promise.all([
        serverContext.context.activeStudentId === null
          ? Promise.resolve([])
          : loadServerDocuments("student", serverContext.context.activeStudentId).catch(() => []),
        loadServerNotifications().catch(() => []),
      ]);
      initialState = { ...serverContext, documentMetadata };
      initialNotifications = notifications;
    } catch {
      redirect("/access-denied");
    }
  }
  return (
    <FamilyContextProvider initialState={initialState}>
      <PortalShell initialNotifications={initialNotifications} developmentAuth={quickSignIn}>{children}</PortalShell>
    </FamilyContextProvider>
  );
}
