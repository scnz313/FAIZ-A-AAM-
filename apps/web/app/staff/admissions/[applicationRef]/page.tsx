import type { Metadata } from "next";
import Link from "next/link";

import { ApplicationReview } from "@/components/staff/ApplicationReview";
import { admissionsService } from "@/modules/services/admissions";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerAdmissionByRef, loadServerProfileCode } from "@/lib/supabase/server-loaders";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Application review · Staff",
};

export default async function StaffApplicationReviewPage({ params }: { params: Promise<{ applicationRef: string }> }) {
  const { applicationRef } = await params;
  const supabaseMode = dataAdapter() === "supabase";

  const [initial, profileCode] = await Promise.all([
    supabaseMode ? loadServerAdmissionByRef(applicationRef) : admissionsService.getApplication(applicationRef),
    loadServerProfileCode(),
  ]);
  const reviewer = initial?.reviewer ?? initial?.reviewedByAccountId ?? "—";

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
        <ApplicationReview applicationRef={applicationRef} initial={null} />
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
          <span className="num">{initial.ref}</span> · {initial.grade} · session {initial.session} · reviewer {reviewer}
        </p>
      </header>

      <ApplicationReview applicationRef={applicationRef} initial={initial} />
    </div>
  );
}
