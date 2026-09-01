import type { Metadata } from "next";
import Link from "next/link";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import DevelopmentAccountSwitcher from "@/components/identity/DevelopmentAccountSwitcher";
import SignInForm from "@/components/identity/SignInForm";
import PageIntro from "@/components/public/PageIntro";
import { dataAdapter, developmentAuthEnabled, totpRequired } from "@/lib/supabase/env";

import styles from "../page.module.css";

export const metadata: Metadata = {
  title: "Staff sign in",
  description: "Staff sign in with an invited school account and two-step verification.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function StaffSignInPage() {
  const adapter = dataAdapter();
  const active = adapter === "supabase";
  const quickSignIn = developmentAuthEnabled();
  const mfaRequired = totpRequired();
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <p className={`alert-strip ${active ? "alert-strip--notice" : "alert-strip--warning"} ${styles.alertStrip}`}>
          {active
            ? quickSignIn
              ? "Local development — real Supabase staff data with one-click sign-in; QR verification remains on for production."
              : "Staff access uses an invited account, password, and authenticator verification."
            : "UI demo — use the staff workspace identity picker; no real staff session is created."}
        </p>
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Staff workspace"
            title="Staff sign in"
            deck={quickSignIn ? "Choose Administrator or Principal to open the matching real Supabase workspace." : "Use the email from your school invitation. Privileged access requires a password and a current authenticator code."}
          />
          <section className={styles.section} aria-label="Staff sign in">
            <div className={`panel ${styles.card}`}>
              {active ? (
                <>
                  {quickSignIn ? <DevelopmentAccountSwitcher audience="staff" /> : null}
                  <SignInForm
                    adapter={adapter}
                    audience="staff"
                    totpRequired={mfaRequired}
                    developmentPasswordAuth={quickSignIn}
                  />
                </>
              ) : (
                <div>
                  <p className="demo-note">Staff authentication is available when the Supabase adapter is enabled.</p>
                  <Link className="button button--primary" href="/staff" prefetch={false}>Open the demo staff workspace</Link>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
