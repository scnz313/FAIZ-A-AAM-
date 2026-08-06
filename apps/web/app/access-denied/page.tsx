import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Access denied",
  description:
    "This area requires a role your account does not have. Contact the school office if this is wrong.",
};

/**
 * Access-denied state: the wrong-role page, mirroring the not-found pattern.
 * UI demo — authorization is enforced server-side once the backend exists, so
 * today every route is reachable; this page previews the denied state.
 */
export default function AccessDeniedPage() {
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className="not-found">
          <p className="eyebrow">Access control</p>
          <h1>Access denied</h1>
          <p>
            This area requires a role your account does not have. If this is wrong, contact the school office.
          </p>
          <a className="link-arrow" href="/">
            Return home →
          </a>
          <p className={styles.demoNote}>
            <span className="demo-badge">UI demo</span>
            <span>Authorization is enforced server-side once the backend exists — no route is protected yet.</span>
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
