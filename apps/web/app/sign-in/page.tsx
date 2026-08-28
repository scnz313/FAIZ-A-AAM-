import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import SignInForm from "@/components/identity/SignInForm";
import PageIntro from "@/components/public/PageIntro";
import { dataAdapter } from "@/lib/supabase/env";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to the Faiz Aam family portal. Guardian and student accounts, once verified by the school. Email OTP when the Supabase adapter is active; UI demo otherwise.",
};

/**
 * Family-portal sign-in. A plain app/ route outside the (public) group, so it
 * composes its own public frame (light header + footer) around the editorial
 * PageIntro and the sign-in card. With the Supabase adapter active the card
 * runs the real email-OTP flow; in demo mode it keeps the honest prototype
 * flow (nothing is protected yet). `?error=auth` comes back from the auth
 * callback when an email link has expired or was already used — the page
 * says so honestly and points at the restart path below.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const adapter = dataAdapter();
  const supabaseLive = adapter === "supabase";
  const authLinkExpired = params.error === "auth";
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        {supabaseLive ? (
          <p className={`alert-strip alert-strip--notice ${styles.alertStrip}`}>
            Email-OTP sign-in is live for this environment — codes are sent by the school.
          </p>
        ) : (
          <p className={`alert-strip alert-strip--warning ${styles.alertStrip}`}>
            UI demo — authentication arrives with the backend. No data is protected.
          </p>
        )}
        {authLinkExpired ? (
          <p className={`alert-strip alert-strip--warning ${styles.alertStrip}`} role="alert">
            That sign-in link has expired or was already used. Start again below — enter your email and request a
            fresh code. Your account is safe; nothing needs to be fixed first.
          </p>
        ) : null}
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Family portal"
            title="Sign in"
            deck="Guardian and student accounts, once verified by the school."
          />
          <section className={styles.section} aria-label="Sign in">
            <div className={`panel ${styles.card}`}>
              <SignInForm adapter={adapter} />
            </div>
            {supabaseLive ? null : (
              <p className={styles.demoNote}>
                <span className="demo-badge">UI demo</span>
                <span>This screen previews the sign-in flow — it is not real authentication.</span>
              </p>
            )}
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
