import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import RecoveryForm from "@/components/identity/RecoveryForm";
import PageIntro from "@/components/public/PageIntro";
import { dataAdapter } from "@/lib/supabase/env";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Account recovery",
  description:
    "Start account recovery for the Faiz Aam family portal with the phone or email on file. UI demo — the reset code is shown on screen.",
};

/**
 * Account recovery — the first step of the forgot-password flow. Composes the
 * public frame like the other plain identity routes.
 */
export default function RecoveryPage() {
  const adapter = dataAdapter();
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Family portal"
            title="Account recovery"
            deck="Start with the phone or email on the account — a reset code comes next."
          />
          <section className={styles.section} aria-label="Account recovery">
            <div className={`panel ${styles.card}`}>
              <RecoveryForm adapter={adapter} />
            </div>
            <p className={styles.demoNote}>
              <span className="demo-badge">UI demo</span>
              <span>{adapter === "supabase" ? "Recovery messages are sent through the server provider boundary; account existence is never disclosed." : "Recovery is a local demo — the reference and code are shown on screen."}</span>
            </p>
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
