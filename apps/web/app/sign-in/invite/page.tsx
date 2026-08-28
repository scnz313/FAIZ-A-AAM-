import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import StaffInvitationForm from "@/components/identity/StaffInvitationForm";
import PageIntro from "@/components/public/PageIntro";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Accept staff invitation",
  description: "Accept a Faiz Aam staff invitation and finish account setup.",
};

export default async function StaffInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string | string[] }>;
}) {
  const params = await searchParams;
  const invitation = Array.isArray(params.invitation) ? params.invitation[0] : params.invitation;
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={styles.frame}>
          <PageIntro
            eyebrow="Staff sign-in"
            title="Accept your invitation"
            deck="Use the private references from the school office to create your staff workspace access."
          />
          <section className={styles.section} aria-label="Accept staff invitation">
            <div className={`panel ${styles.card}`}>
              <StaffInvitationForm initialInvitationRef={invitation ?? ""} />
            </div>
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
