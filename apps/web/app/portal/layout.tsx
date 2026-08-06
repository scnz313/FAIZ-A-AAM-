import type { Metadata } from "next";

import { FamilyContextProvider } from "@/components/portal/FamilyContextProvider";
import { PortalShell } from "@/components/layouts/PortalShell";

/* Indexing protection — the portal contains private family records. This is
   not authentication; server authorization arrives with the backend. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <FamilyContextProvider>
      <PortalShell>{children}</PortalShell>
    </FamilyContextProvider>
  );
}
