import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import ApplicationStatusView from "@/components/applicant/ApplicationStatusView";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Application status",
  description: "Track the progress of a student admission application at Faiz Aam Secondary School.",
  robots: { index: false },
};

export default async function ApplicationStatusPage({
  params,
}: {
  params: Promise<{ applicationRef: string }>;
}) {
  const { applicationRef } = await params;

  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1}>
        <ApplicationStatusView applicationRef={applicationRef} />
      </main>
      <PublicFooter />
    </div>
  );
}
