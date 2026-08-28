import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import ApplicantRegistrationForm from "@/components/identity/ApplicantRegistrationForm";
import PageIntro from "@/components/public/PageIntro";
import { dataAdapter } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Create applicant account",
  description: "Create an applicant account and verify your email for a Faiz Aam admission application.",
  robots: { index: false, follow: false },
};

export default function ApplicantRegistrationPage() {
  const active = dataAdapter() === "supabase";
  return (
    <div>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className="page-frame">
        <PageIntro eyebrow="Admissions" title="Create an applicant account" deck="Use an email you can verify to save and resume a student application across devices." />
        <section className="panel" aria-label="Create applicant account">
          {active ? <ApplicantRegistrationForm /> : <p className="demo-note">Applicant registration is available when the Supabase adapter is enabled.</p>}
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
