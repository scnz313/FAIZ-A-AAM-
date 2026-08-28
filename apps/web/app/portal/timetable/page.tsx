import type { Metadata } from "next";

import { TimetablePageClient } from "@/components/portal/TimetablePageClient";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerFamilyContext, loadServerTimetable } from "@/lib/supabase/server-loaders";
import { classKeyForGradeSection } from "@/modules/services/timetable";

export const metadata: Metadata = { title: "Timetable · Portal" };

export default async function PortalTimetablePage() {
  if (dataAdapter() === "supabase") {
    const context = await loadServerFamilyContext();
    const active = context.contexts.find((candidate) => candidate.student.id === context.activeStudentId);
    if (active !== undefined) {
      await loadServerTimetable(classKeyForGradeSection(active.gradeSection));
    }
  }
  return <TimetablePageClient />;
}
