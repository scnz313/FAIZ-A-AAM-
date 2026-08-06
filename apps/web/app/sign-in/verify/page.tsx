import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import VerifyForm from "@/components/identity/VerifyForm";
import PageIntro from "@/components/public/PageIntro";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Verify sign-in",
  description:
    "Enter the 6-digit verification code to finish signing in to the Faiz Aam family portal. UI demo — the code is shown on screen.",
};

/**
 * Sign-in verification step — the code screen after a successful sign-in.
 * Composes the public frame like the other plain identity routes.
 */
export default function VerifyPage() {
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Family portal"
            title="Verify sign-in"
            deck="Enter the 6-digit code sent to the phone or email you signed in with."
          />
          <section className={styles.section} aria-label="Verify sign-in">
            <div className={`panel ${styles.card}`}>
              <VerifyForm />
            </div>
            <p className={styles.demoNote}>
              <span className="demo-badge">UI demo</span>
              <span>The code is shown on this screen — a real backend sends it by SMS.</span>
            </p>
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
