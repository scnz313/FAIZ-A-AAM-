import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import PageIntro from "@/components/public/PageIntro";
import TotpForm from "@/components/identity/TotpForm";
import { getServerActor } from "@/lib/auth/actor";
import { safeAuthRedirect } from "@/lib/auth/redirect";
import { dataAdapter, totpRequired } from "@/lib/supabase/env";

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
export default async function TotpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const adapter = dataAdapter();
  const mfaRequired = totpRequired();
  const params = await searchParams;
  const requested = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeAuthRedirect(requested, "/staff");
  if (adapter === "supabase") {
    const actor = await getServerActor();
    if (actor === null) redirect(`/sign-in/staff?next=${encodeURIComponent(next)}`);
    if (!actor.roles.some((role) => !["guardian", "student"].includes(role))) redirect("/access-denied");
    if (actor.aal === "aal2") redirect(next);
  }
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Staff sign-in"
            title={mfaRequired ? "Two-step verification" : "Preparing your staff session"}
            deck={mfaRequired ? "Staff access requires an authenticator app. First time here? Scan the setup key once — after that it asks for a fresh six-digit code at every sign-in." : "Local development is creating the required staff session automatically. No QR code is needed."}
          />
          <section className={styles.section} aria-label={mfaRequired ? "Two-step verification" : "Preparing staff session"}>
            <div className={`panel ${styles.card}`}>
              <TotpForm adapter={adapter} totpRequired={mfaRequired} />
            </div>
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
