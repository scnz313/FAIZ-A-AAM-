import type { Metadata } from "next";

import StateGallery from "@/app/ui-states/StateGallery";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "UI state review",
  description: "Reviewable loading, empty, error, permission, stale, processing, retry, and success states for the frontend demo.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function UiStatesPage() {
  return (
    <main id="main" tabIndex={-1} className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <p className="eyebrow">Frontend review · internal demo</p>
          <h1 className={styles.title}>UI states, made visible.</h1>
          <p className={styles.intro}>
            A small review surface for the states users need when school records are loading, unavailable, restricted, or
            ready for the next step. This route is not part of the public school navigation.
          </p>
          <p className={styles.notice}>
            <span className="demo-badge">UI demo</span> These examples contain no real records and do not change application state.
          </p>
        </header>

        <StateGallery />

        <nav className={styles.links} aria-label="State examples in the product">
          <p className="section-label">Open related screens</p>
          <div className={styles.linkList}>
            <a className="link-arrow" href="/sign-in">
              Sign-in and recovery →
            </a>
            <a className="link-arrow" href="/access-denied">
              Access denied →
            </a>
            <a className="link-arrow" href="/session-expired">
              Session expired →
            </a>
            <a className="link-arrow" href="/portal/documents">
              Document states →
            </a>
            <a className="link-arrow" href="/portal/fees">
              Fee ledger states →
            </a>
          </div>
        </nav>
      </div>
    </main>
  );
}
