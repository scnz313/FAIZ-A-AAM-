"use client";

import { useState } from "react";

import { PublicFooter } from "@/components/layouts/PublicFooter";
import { PublicHeader } from "@/components/layouts/PublicHeader";
import ApplicationForm, { APPLICATION_STEPS } from "@/components/applicant/ApplicationForm";
import ProgressRail from "@/components/applicant/ProgressRail";

import styles from "./page.module.css";

/**
 * Student admission application — the multi-step form. Applicant routes
 * live outside the (public) group, so this page composes its own
 * public-style frame (light header + footer) around the application shell.
 */
export default function ApplyStudentPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [context, setContext] = useState({ grade: "", session: "" });

  return (
    <div className={styles.page}>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1}>
        <div className={styles.shell}>
          <aside className={styles.railCol}>
            <ProgressRail
              steps={APPLICATION_STEPS}
              current={currentStep}
              contextTitle={context.grade || "New application"}
              contextSubtitle={context.session || "Configured admission session"}
            />
          </aside>

          <ApplicationForm onStepChange={setCurrentStep} onContextChange={setContext} />

          <aside className={styles.context} aria-label="Application context">
            <div className={styles.contextBlock}>
              <p className="section-label">Application status</p>
              <strong className={styles.contextTitle}>Draft</strong>
              <small className={styles.contextSmall}>Saved automatically in this browser.</small>
            </div>

            <div className={styles.contextBlock}>
              <p className="section-label">Admissions window</p>
              <strong className={styles.contextTitle}>Session 2026-27</strong>
              <small className={styles.contextSmall}>Applications are reviewed after submission.</small>
            </div>

            <div className={styles.contextBlock}>
              <p className="section-label">What happens next</p>
              <ol className={styles.nextList}>
                <li>Verification &amp; review of documents</li>
                <li>Assessment with the student &amp; guardian</li>
                <li>Offer, waitlist, or decline</li>
              </ol>
              <small className={styles.contextSmall}>Every step is recorded on your application timeline.</small>
            </div>

            <div className={styles.privacyNote}>
              <span aria-hidden="true">◈</span>
              <p>
                Your draft is private to this browser and nothing is sent until you submit. Documents are stored
                securely and are visible only to authorised admissions staff.
              </p>
            </div>
          </aside>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
