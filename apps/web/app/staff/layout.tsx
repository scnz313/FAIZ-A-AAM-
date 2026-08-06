import type { Metadata } from "next";

import { StaffContextProvider } from "@/components/staff/StaffContextProvider";
import { StaffRouteGuard } from "@/components/staff/StaffRouteGuard";
import { StaffShell } from "@/components/layouts/StaffShell";

/* Indexing protection — staff workspaces contain private operational
   records. This is not authentication; server authorization arrives with
   the backend. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffContextProvider>
      <StaffShell>
        <StaffRouteGuard>{children}</StaffRouteGuard>
      </StaffShell>
    </StaffContextProvider>
  );
}
