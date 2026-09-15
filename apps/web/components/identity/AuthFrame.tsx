import Link from "next/link";
import type { ReactNode } from "react";

import { Crest } from "@/components/ui/Crest";
import styles from "./AuthFrame.module.css";

/**
 * V14 AuthFrame — a minimal brand-only header (no full public navigation or
 * footer) with a centered identity card. Used by all auth pages: sign-in,
 * verify, recovery, register, staff sign-in, totp, invite, reset-password.
 *
 * Preserves the editorial paper/ink visual language while keeping the auth
 * surface focused and uncluttered, matching the V14 reference exactly.
 */
export type AuthFrameProps = {
  title: string;
  sub?: string;
  foot?: ReactNode;
  wide?: boolean;
  children: ReactNode;
};

export function AuthFrame({ title, sub, foot, wide, children }: AuthFrameProps) {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headWrap}>
          <Link href="/" className={styles.brandLock} aria-label="Faiz Aam Secondary School, home">
            <Crest size="sm" />
            <span>
              <span className={styles.brandName}>Faiz Aam Secondary School</span>
              <span className={styles.brandSub}>Bandipora, Kashmir</span>
            </span>
          </Link>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        <div className={wide ? `${styles.frame} ${styles.frameWide}` : styles.frame}>
          <h1 className={styles.title}>{title}</h1>
          {sub ? <p className={styles.sub}>{sub}</p> : null}
          <div className={styles.card}>
            {children}
          </div>
          {foot ? <div className={styles.foot}>{foot}</div> : null}
        </div>
      </main>
    </div>
  );
}

export default AuthFrame;
