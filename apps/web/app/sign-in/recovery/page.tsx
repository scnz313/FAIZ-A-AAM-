import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import RecoveryForm from "@/components/identity/RecoveryForm";
import PageIntro from "@/components/public/PageIntro";
import { dataAdapter } from "@/lib/supabase/env";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Account recovery",
  description: "Request secure account recovery instructions using the verified contact on a Faiz Aam account.",
  robots: { index: false, follow: false },
};

/**
 * Account recovery — the first step of the forgot-password flow. Composes the
 * public frame like the other plain identity routes.
 */
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const adapter = dataAdapter();
  const params = await searchParams;
  const expired = params.error === "expired";
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        {expired ? (
          <p className="alert-strip alert-strip--warning" role="alert">
            That recovery link has expired or was already used. Request a fresh email below.
          </p>
        ) : null}
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Family portal"
            title="Account recovery"
            deck={adapter === "supabase" ? "Enter the verified email on the account. If it matches, a secure password-reset link is sent without revealing whether the account exists." : "Start with the phone or email on the account — a reset code comes next."}
          />
          <section className={styles.section} aria-label="Account recovery">
            <div className={`panel ${styles.card}`}>
              <RecoveryForm adapter={adapter} />
            </div>
            {adapter === "supabase" ? (
              <p className={styles.demoNote}>Recovery messages are sent through the Auth email provider; account existence is never disclosed.</p>
            ) : (
              <p className={styles.demoNote}>
                <span className="demo-badge">UI demo</span>
                <span>Recovery is a local demo — the reference and code are shown on screen.</span>
              </p>
            )}
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
