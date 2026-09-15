import Link from "next/link";
import type { ReactNode } from "react";

import { Crest } from "@/components/ui/Crest";
import styles from "./ApplicantShell.module.css";

/**
 * V14 ApplicantShell — brand-only header with "Applicant area" chip and
 * quick links to the admissions guide and school website. Used by all
 * `/apply/*` routes (student wizard, status, job wizard, job status).
 *
 * Matches V14 reference lines 3417-3428.
 */
export function ApplicantShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <div className={styles.headWrap}>
          <Link href="/" className={styles.brandLock} aria-label="Faiz E Aam Secondary School, home">
            <Crest size="sm" />
            <span>
              <span className={styles.brandName}>Faiz E Aam Secondary School</span>
              <span className={styles.brandSub}>Bandipora, Kashmir</span>
            </span>
          </Link>
          <span className={styles.chip}>Applicant area</span>
          <div className={styles.quickLinks}>
            <Link className="underline-link small" href="/admissions" prefetch={false}>
              Admissions guide
            </Link>
            <Link className="underline-link small" href="/" prefetch={false}>
              School website
            </Link>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </div>
  );
}

export default ApplicantShell;
