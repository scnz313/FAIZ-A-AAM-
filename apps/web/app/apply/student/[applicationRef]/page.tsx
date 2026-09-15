import type { Metadata } from "next";

import { ApplicantShell } from "@/components/layouts/ApplicantShell";
import ApplicationStatusView from "@/components/applicant/ApplicationStatusView";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerAdmissionByRef } from "@/lib/supabase/server-loaders";

export const metadata: Metadata = {
  title: "Application status",
  description: "Track the progress of a student admission application at Faiz E Aam Secondary School.",
  robots: { index: false },
};

export default async function ApplicationStatusPage({
  params,
}: {
  params: Promise<{ applicationRef: string }>;
}) {
  const { applicationRef } = await params;
  const initial = dataAdapter() === "supabase" ? await loadServerAdmissionByRef(applicationRef) : undefined;

  return (
    <ApplicantShell>
      <ApplicationStatusView applicationRef={applicationRef} initial={initial} />
    </ApplicantShell>
  );
}
