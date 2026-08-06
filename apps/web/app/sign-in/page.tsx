import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import SignInForm from "@/components/identity/SignInForm";
import PageIntro from "@/components/public/PageIntro";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to the Faiz Aam family portal. Guardian and student accounts, once verified by the school. UI demo — authentication arrives with the backend.",
};

/**
 * Family-portal sign-in. A plain app/ route outside the (public) group, so it
 * composes its own public frame (light header + footer) around the editorial
 * PageIntro and the sign-in card. UI demo: the slim warning strip says plainly
 * that nothing is protected yet.
 */
export default function SignInPage() {
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <p className={`alert-strip alert-strip--warning ${styles.alertStrip}`}>
          UI demo — authentication arrives with the backend. No data is protected.
        </p>
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Family portal"
            title="Sign in"
            deck="Guardian and student accounts, once verified by the school."
          />
          <section className={styles.section} aria-label="Sign in">
            <div className={`panel ${styles.card}`}>
              <SignInForm />
            </div>
            <p className={styles.demoNote}>
              <span className="demo-badge">UI demo</span>
              <span>This screen previews the sign-in flow — it is not real authentication.</span>
            </p>
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
