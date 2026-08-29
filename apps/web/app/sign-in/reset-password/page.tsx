import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import PasswordResetForm from "@/components/identity/PasswordResetForm";
import PageIntro from "@/components/public/PageIntro";
import { getServerActor } from "@/lib/auth/actor";
import { dataAdapter } from "@/lib/supabase/env";

import styles from "../recovery/page.module.css";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password after opening a verified recovery email.",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage() {
  if (dataAdapter() !== "supabase") redirect("/sign-in/recovery");
  if ((await getServerActor()) === null) redirect("/sign-in/recovery?error=expired");
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Account security"
            title="Set a new password"
            deck="Choose a strong password for staff access. The recovery session is closed after the change."
          />
          <section className={styles.section} aria-label="Set a new password">
            <div className={`panel ${styles.card}`}>
              <PasswordResetForm />
            </div>
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
