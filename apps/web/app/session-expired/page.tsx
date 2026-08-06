import type { Metadata } from "next";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import Button from "@/components/ui/Button";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Session expired",
  description: "Your Faiz Aam session ended after inactivity. Sign in again to continue.",
};

/**
 * Session-expired state, mirroring the not-found pattern: a centred block on
 * the paper page with one primary action. UI demo — sessions are not real
 * yet, so this page previews the state the backend will produce.
 */
export default function SessionExpiredPage() {
  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className="not-found">
          <p className="eyebrow">Family portal · Security</p>
          <h1>Session expired</h1>
          <p>For your safety, the session ended after inactivity. Sign in again to continue.</p>
          <div className={styles.actions}>
            <Button href="/sign-in" variant="primary">
              Sign in again →
            </Button>
            <a className="link-arrow" href="/">
              Back to the school home →
            </a>
          </div>
          <p className={styles.demoNote}>
            <span className="demo-badge">UI demo</span>
            <span>Sessions are not real yet — nothing was actually protected or lost.</span>
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
