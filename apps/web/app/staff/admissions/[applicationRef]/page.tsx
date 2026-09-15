import type { Metadata } from "next";
import Link from "next/link";

import { ApplicationReview } from "@/components/staff/ApplicationReview";
import { admissionsService } from "@/modules/services/admissions";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerAdmissionByRef, loadServerProfileCode, loadServerPublicAdmissionConfiguration } from "@/lib/supabase/server-loaders";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Application review · Staff",
};

export default async function StaffApplicationReviewPage({ params }: { params: Promise<{ applicationRef: string }> }) {
  const { applicationRef } = await params;
  const supabaseMode = dataAdapter() === "supabase";

  const [initial, profileCode, admissionConfiguration] = await Promise.all([
    supabaseMode ? loadServerAdmissionByRef(applicationRef) : admissionsService.getApplication(applicationRef),
    loadServerProfileCode(),
    /* The applicant already receives this configuration; the staff detail
       page reads the public-safe projection once to label documents with the
       school's configured requirement labels instead of raw codes. A failed
       read leaves the labels absent and the record falls back to its derived
       labels rather than failing the page. */
    supabaseMode ? loadServerPublicAdmissionConfiguration().catch(() => null) : Promise.resolve(null),
  ]);
  const documentLabels = admissionConfiguration === null
    ? undefined
    : Object.fromEntries(admissionConfiguration.documentRequirements.map((requirement) => [requirement.code, requirement.label]));

  if (!initial) {
    return (
      <div className={styles.page}>
        <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/admissions")}>
          ← Admissions
        </Link>
        <header className={`workspace-header ${styles.header}`}>
          <p className="eyebrow">Staff · Admissions</p>
          <h1 className="workspace-title">Application review</h1>
          <p className={styles.workspaceIntro}>
            <span className="num">{applicationRef}</span> · loading the record{!supabaseMode ? " from the demo session" : ""}…
          </p>
        </header>
        <ApplicationReview applicationRef={applicationRef} initial={null} documentLabels={documentLabels} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/admissions")}>
        ← Admissions
      </Link>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Admissions</p>
        <h1 className="workspace-title">{initial.studentName}</h1>
        <p className="workspace-intro">
          <span className="num">{initial.ref}</span> · {initial.grade} · session {initial.session} · v{initial.version ?? 1}
        </p>
      </header>

      <ApplicationReview applicationRef={applicationRef} initial={initial} documentLabels={documentLabels} />
    </div>
  );
}
