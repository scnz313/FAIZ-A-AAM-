import type { Metadata } from "next";

import LinkChildForm from "@/components/identity/LinkChildForm";
import { dataAdapter } from "@/lib/supabase/env";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Link another child",
  description:
    "Request to link another child to your Faiz Aam family portal account. The school office verifies the request.",
};

/**
 * Link-another-child request, inside the portal route group (PortalShell
 * frame). Uses the portal header pattern — the shell already renders its own
 * folio, so PageIntro's masthead is not repeated here. The request is
 * recorded by the identity service and verified by the school office.
 */
export default function LinkChildPage() {
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Portal · Profile</p>
        <h1 className={styles.title}>Link another child</h1>
        <p className={styles.intro}>
          Linking requires the school to verify the request — a second child appears in the portal only after the
          office approves the link.
        </p>
      </header>

      <LinkChildForm />

      {dataAdapter() !== "supabase" ? (
        <p className={styles.demoNote}>
          <span className="demo-badge">Demo data</span>
          <span>Linking is not real yet — requests are recorded in this browser session only.</span>
        </p>
      ) : null}
    </div>
  );
}
