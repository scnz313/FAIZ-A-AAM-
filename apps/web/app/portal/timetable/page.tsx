import type { Metadata } from "next";

import { TimetablePageClient } from "@/components/portal/TimetablePageClient";
import { dataAdapter } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Timetable · Portal" };

export default async function PortalTimetablePage() {
  /* The client island resolves the active-child projection itself; passing the
     server instant lets "Today" be the real Kolkata weekday without an SSR /
     hydration mismatch. Demo mode keeps its injected demo clock. */
  if (dataAdapter() !== "supabase") return <TimetablePageClient />;
  return <TimetablePageClient todayIso={new Date().toISOString()} />;
}
