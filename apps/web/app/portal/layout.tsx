import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FamilyContextProvider } from "@/components/portal/FamilyContextProvider";
import { PortalShell } from "@/components/layouts/PortalShell";
import { getServerActor } from "@/lib/auth/actor";
import { dataAdapter } from "@/lib/supabase/env";
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
  if (dataAdapter() === "supabase") {
    if ((await getServerActor()) === null) {
      redirect(`/sign-in?next=${encodeURIComponent("/portal")}`);
    }
    try {
      const contextPromise = loadServerFamilyContext().then(mapServerFamilyContext);
      const documentPromise = contextPromise.then((serverContext) => serverContext.context.activeStudentId === null
        ? []
        : loadServerDocuments("student", serverContext.context.activeStudentId));
      const [serverContext, documentMetadata, notifications] = await Promise.all([
        contextPromise,
        documentPromise,
        loadServerNotifications(),
      ]);
      initialState = { ...serverContext, documentMetadata };
      initialNotifications = notifications;
    } catch {
      redirect("/access-denied");
    }
  }
  return (
    <FamilyContextProvider initialState={initialState}>
      <PortalShell initialNotifications={initialNotifications}>{children}</PortalShell>
    </FamilyContextProvider>
  );
}
