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
      const serverContext = mapServerFamilyContext(await loadServerFamilyContext());
      const documentMetadata = serverContext.context.activeStudentId === null
        ? []
        : await loadServerDocuments("student", serverContext.context.activeStudentId);
      initialState = { ...serverContext, documentMetadata };
      initialNotifications = await loadServerNotifications();
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
