import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import PageIntro from "@/components/public/PageIntro";
import TotpForm from "@/components/identity/TotpForm";
import { dataAdapter } from "@/lib/supabase/env";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Two-step verification",
  description:
    "Finish staff sign-in with your authenticator app — first-time setup or the usual six-digit verification code.",
};

/**
 * Staff second-factor gate. Reached after a verified first factor when the
 * account holds staff grants; demo-mode sign-ins never route here.
 */
export default function TotpPage() {
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Staff sign-in"
            title="Two-step verification"
            deck="Staff access requires an authenticator app. First time here? Scan the setup key once — after that it asks for a fresh six-digit code at every sign-in."
          />
          <section className={styles.section} aria-label="Two-step verification">
            <div className={`panel ${styles.card}`}>
              <TotpForm adapter={dataAdapter()} />
            </div>
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
