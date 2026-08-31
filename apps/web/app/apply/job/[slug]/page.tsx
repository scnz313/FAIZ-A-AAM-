import type { Metadata } from "next";
import Link from "next/link";

import JobForm from "@/components/applicant/JobForm";
import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import { careersService } from "@/modules/services/careers";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerVacancies } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

type Props = {
  params: Promise<{ slug: string }>;
};

export const metadata: Metadata = {
  title: "Apply for a vacancy",
  description: "Job application form for a vacancy at Faiz Aam Secondary School, Bandipora.",
  robots: { index: false, follow: false },
};

export default async function ApplyJobPage({ params }: Props) {
  const { slug } = await params;
  const vacancy = dataAdapter() === "supabase"
    ? (await loadServerVacancies()).find((candidate) => candidate.slug === slug) ?? null
    : await careersService.getVacancy(slug);
  const open = vacancy?.status === "open";

  return (
    <div className={styles.frame}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1}>
        {vacancy && open ? (
          <JobForm vacancy={vacancy} />
        ) : (
          <div className={styles.closed}>
            <p className="eyebrow">Careers · Application</p>
            <h1 className={styles.closedTitle}>This vacancy is not open</h1>
            <p className={styles.closedDeck}>
              Applications are accepted only for vacancies that are open. The position may have been filled, or the
              address may be incorrect.
            </p>
            <Link className="link-arrow" href="/careers">
              See current vacancies →
            </Link>
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
