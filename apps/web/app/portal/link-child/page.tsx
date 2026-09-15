import type { Metadata } from "next";

import LinkChildForm from "@/components/identity/LinkChildForm";
import PendingLinkRequests from "@/components/identity/PendingLinkRequests";
import { dataAdapter } from "@/lib/supabase/env";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Link another child",
  description:
    "Request to link another child to your Faiz E Aam family portal account. The school office verifies the request.",
};

/**
 * Link-another-child request — V14 PLinkChild pattern with page-head,
 * warning callout, and titled panel. The request is recorded by the
 * identity service and verified by the school office.
 */
export default function LinkChildPage() {
  return (
    <div className={styles.page}>
      <div className="page-head">
        <h1>Link another child</h1>
        <p className="ph-sub">
          The school office verifies each request before a child appears in your portal. Enter the student reference the office gives you; a reference alone never activates access.
        </p>
      </div>

      <div className={styles.body}>
        <div className="callout">
          <span className="msym" aria-hidden="true">gpp_good</span>
          <div>
            <strong>How linking works</strong>
            <p className="small">
              1. Ask the office to verify you as a guardian of the child. &nbsp;2. The office gives you the student reference on the child&apos;s record. &nbsp;3. Enter it here with your relation. &nbsp;4. The school approves the link, and the child appears in your portal. Nothing activates automatically.
            </p>
          </div>
        </div>

        <section className="panel">
          <div className="pn-head">
            <h2>Enter the student reference</h2>
          </div>
          <div className="pn-body">
            <LinkChildForm />
          </div>
        </section>

        <section className="panel">
          <div className="pn-head">
            <h2>Your pending requests</h2>
          </div>
          <div className="pn-body">
            <PendingLinkRequests />
          </div>
        </section>

        {dataAdapter() !== "supabase" ? (
          <p className={styles.demoNote}>
            <span className="demo-badge">Demo data</span>
            <span>Linking is not real yet · requests are recorded in this browser session only.</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
