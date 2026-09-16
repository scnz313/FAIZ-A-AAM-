import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { staffPortalLabel } from "@/lib/metadata/staff-title";

export async function generateMetadata(): Promise<Metadata> {
  const pathname = (await headers()).get("x-fass-pathname") ?? "/staff/content";
  const portal = staffPortalLabel(pathname);
  return {
    title: {
      default: "Content",
      template: `%s · Content · ${portal} · Faiz E Aam Secondary School`,
    },
    description: "Public pages and notice publishing states with review status.",
  };
}

export default function StaffContentLayout({ children }: { children: ReactNode }) {
  return children;
}
