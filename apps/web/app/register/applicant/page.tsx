import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import ApplicantRegistrationForm from "@/components/identity/ApplicantRegistrationForm";
import PageIntro from "@/components/public/PageIntro";
import { safeAuthRedirect } from "@/lib/auth/redirect";
import { dataAdapter } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Create applicant account",
  description: "Create an applicant account and verify your email for a Faiz Aam admission application.",
  robots: { index: false, follow: false },
};

export default async function ApplicantRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ purpose?: string | string[]; next?: string | string[] }>;
}) {
  const active = dataAdapter() === "supabase";
  const params = await searchParams;
  const purposeValue = Array.isArray(params.purpose) ? params.purpose[0] : params.purpose;
  const purpose = purposeValue === "job_application" ? "job_application" : "student_admission";
  const requestedNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeAuthRedirect(requestedNext, "/apply/student");
  return (
    <div>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className="page-frame">
        <PageIntro eyebrow={purpose === "job_application" ? "Careers" : "Admissions"} title="Create an applicant account" deck={`Use an email you can verify to save and resume your ${purpose === "job_application" ? "job" : "student"} application across devices.`} />
        <section className="panel" aria-label="Create applicant account">
          {active ? <ApplicantRegistrationForm purpose={purpose} next={next} /> : <p className="demo-note">Applicant registration is available when the Supabase adapter is enabled.</p>}
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
