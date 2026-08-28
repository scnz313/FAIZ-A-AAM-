import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getServerActor } from "@/lib/auth/actor";
import { dataAdapter } from "@/lib/supabase/env";

/* Applicant journeys carry private application data (identity, contact,
   documents). Indexing protection only — real authentication arrives with
   the backend. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ApplyLayout({ children }: { children: React.ReactNode }) {
  if (dataAdapter() === "supabase" && (await getServerActor()) === null) {
    redirect(`/sign-in?next=${encodeURIComponent("/apply/student")}`);
  }
  return children;
}
