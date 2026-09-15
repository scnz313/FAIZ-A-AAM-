import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerActor } from "@/lib/auth/actor";
import { safeAuthRedirect } from "@/lib/auth/redirect";
import { dataAdapter } from "@/lib/supabase/env";

/* Private journey: titled for the browser and never indexed (the /apply
   layout already carries the robots rule). */
export const metadata: Metadata = {
  title: "Admission application",
};

/* The student admission journey is account-bound: it carries private
   application data (identity, contact, documents), so an anonymous visitor
   is sent to sign in. The public job application under /apply/job is
   deliberately not covered by this guard (owner requirement, 15 September
   2026). */
export default async function StudentApplyLayout({ children }: { children: React.ReactNode }) {
  if (dataAdapter() === "supabase" && (await getServerActor()) === null) {
    const pathname = (await headers()).get("x-fass-pathname");
    const next = safeAuthRedirect(pathname, "/apply/student");
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }
  return children;
}
