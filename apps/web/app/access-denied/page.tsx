import type { Metadata } from "next";
import Link from "next/link";

import DevelopmentAccountSwitcher from "@/components/identity/DevelopmentAccountSwitcher";
import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import { getServerActor } from "@/lib/auth/actor";
import { dataAdapter, developmentAuthEnabled } from "@/lib/supabase/env";

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
export default async function AccessDeniedPage() {
  const adapter = dataAdapter();
  const demo = adapter === "demo";
  const quickSignIn = developmentAuthEnabled();
  const actor = adapter === "supabase" ? await getServerActor() : null;
  const hasStaffWorkspace = actor?.roles.some((role) => !["guardian", "student"].includes(role)) ?? false;
  const hasFamilyWorkspace = actor?.roles.includes("guardian") ?? false;
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
          {hasStaffWorkspace ? (
            <Link className="link-arrow" href="/staff">
              Open staff workspace →
            </Link>
          ) : null}
          {hasFamilyWorkspace ? (
            <Link className="link-arrow" href="/portal">
              Open family portal →
            </Link>
          ) : null}
          {quickSignIn ? <DevelopmentAccountSwitcher audience="all" /> : null}
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
