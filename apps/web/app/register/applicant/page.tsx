import type { Metadata } from "next";
import Link from "next/link";

import { AuthFrame } from "@/components/identity/AuthFrame";
import ApplicantRegistrationForm from "@/components/identity/ApplicantRegistrationForm";
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
    <AuthFrame
      wide
      title="Create applicant account"
      sub="One account handles admission applications, job applications and (after enrolment) your guardian portal."
      foot={
        <span>Already registered? <Link className="underline-link" href="/sign-in">Sign in</Link></span>
      }
    >
      {active ? (
        <ApplicantRegistrationForm purpose={purpose} next={next} />
      ) : (
        <p className="demo-note">Applicant registration is available when the Supabase adapter is enabled.</p>
      )}
    </AuthFrame>
  );
}
