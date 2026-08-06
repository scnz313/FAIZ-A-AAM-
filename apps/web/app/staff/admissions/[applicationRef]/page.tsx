import type { Metadata } from "next";

import { ApplicationReview } from "@/components/staff/ApplicationReview";
import { staffApplications } from "@/modules/admissions/demo";
import { admissionsService } from "@/modules/services/admissions";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Application review · Staff",
};

export default async function StaffApplicationReviewPage({ params }: { params: Promise<{ applicationRef: string }> }) {
  const { applicationRef } = await params;

  /* Server-side the demo session is empty, so this resolves fixture rows
     through the same fixtureApplicationRecord derivation the client uses.
     Records submitted earlier in the browser session are not readable
     server-side; the shell below lets the client load those, and unknown
     references land on the not-found state after the client resolves. */
  const initial = await admissionsService.getApplication(applicationRef);
  const reviewer = staffApplications.find((application) => application.ref === applicationRef)?.reviewer ?? "—";

  if (!initial) {
    return (
      <div className={styles.page}>
        <a className="link-arrow" href="/staff/admissions">
          ← Admissions
        </a>
        <header className={`workspace-header ${styles.header}`}>
          <p className="eyebrow">Staff · Admissions</p>
          <h1 className="workspace-title">Application review</h1>
          <p className="workspace-intro">
            <span className="num">{applicationRef}</span> · loading the record from the demo session…
          </p>
        </header>
        <ApplicationReview applicationRef={applicationRef} initial={null} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <a className="link-arrow" href="/staff/admissions">
        ← Admissions
      </a>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Admissions</p>
        <h1 className="workspace-title">{initial.studentName}</h1>
        <p className="workspace-intro">
          <span className="num">{initial.ref}</span> · {initial.grade} · session {initial.session} · reviewer {reviewer}
        </p>
      </header>

      <ApplicationReview applicationRef={applicationRef} initial={initial} />
    </div>
  );
}
