import type { Metadata } from "next";
import Link from "next/link";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import { dataAdapter } from "@/lib/supabase/env";

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
  const demo = dataAdapter() === "demo";
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
          <Link className="link-arrow" href="/">
            Return home →
          </Link>
          {demo ? (
            <p className={styles.demoNote}>
              <span className="demo-badge">UI demo</span>
              <span>Authorization is previewed locally in this adapter.</span>
            </p>
          ) : (
            <p className={styles.demoNote}>Access was denied by the current account, role, or record scope. No protected record was disclosed.</p>
          )}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
