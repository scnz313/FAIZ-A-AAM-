import type { Metadata } from "next";

import Button from "@/components/ui/Button";
import PageIntro from "@/components/public/PageIntro";
import ResumeDraft from "@/components/applicant/ResumeDraft";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicAdmissionConfiguration } from "@/lib/supabase/server-loaders";
import { DEMO_ADMISSION_CONFIGURATION, type AdmissionConfiguration } from "@/modules/services/school-config";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Apply for admission",
  description: "Start a student admission application at Faiz Aam Secondary School — what you need, and how the application works.",
};

const NEXT_STEPS = [
  { num: "01", title: "Complete the form", line: "Eight short sections — academic, student, guardian, address, prior school, medical, documents, and the declaration." },
  { num: "02", title: "Submit & receive a reference", line: "A reference number is issued at submission. It is how you track the application at every stage." },
  { num: "03", title: "Wait for review", line: "The admissions office verifies and reviews, then the family is invited for the assessment." },
];

export default async function AdmissionsApplyPage() {
  const configuration: AdmissionConfiguration = dataAdapter() === "supabase"
    ? await loadServerPublicAdmissionConfiguration()
    : DEMO_ADMISSION_CONFIGURATION;
  const currentYear = configuration.academicYears.find((year) => year.status === "current") ?? configuration.academicYears[0];
  const documents = configuration.documentRequirements.filter((requirement) => requirement.required && requirement.status === "active");
  const openWindows = configuration.windows.filter((window) => window.status === "open" && window.academicYearId === currentYear?.id);
  const gradeLabels = configuration.grades.filter((grade) => openWindows.some((window) => window.gradeId === grade.id)).map((grade) => grade.label);
  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="Admissions"
        title="Apply for admission"
        deck="A short, careful application — completed in your own time, saved as you go."
      />

      <section className={styles.section} aria-labelledby="overview-heading">
        <p className="section-label">Before you begin</p>
        <h2 className={styles.sectionHeading} id="overview-heading">
          Eligibility &amp; documents
        </h2>
        <div className={styles.overviewGrid}>
          <div>
            <p className={styles.bodyLine}>
              {currentYear && openWindows.length > 0 ? `Applications are open for ${gradeLabels.join(", ") || "configured grades"} for ${currentYear.label}.` : "Applications follow the current school admission window."} The child must meet the age rule for
              the class applied to; grade capacity and the full eligibility rules follow the school’s confirmed
              admission policy, published with the admission notice.
            </p>
          </div>
          <ul className={styles.docList}>
            {documents.map((doc) => (
              <li key={doc.code}>
                <strong>{doc.label}</strong>
                <span>Configured requirement · {doc.allowedMimeTypes.join(", ")} · up to {Math.round(doc.maxBytes / (1024 * 1024))} MB</span>
              </li>
            ))}
          </ul>
        </div>
        <p className={styles.docNote}>PDF, JPG or PNG · up to 5 MB each</p>
      </section>

      <section className={`${styles.section} ${styles.band}`} aria-labelledby="steps-heading">
        <p className="section-label">The application</p>
        <h2 className={styles.sectionHeading} id="steps-heading">
          What happens once you begin
        </h2>
        <ol className={styles.stepList}>
          {NEXT_STEPS.map((step) => (
            <li key={step.num} className={styles.stepRow}>
              <p className={styles.stepNum}>{step.num}</p>
              <div>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepLine}>{step.line}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className={styles.startRow}>
          <Button href="/apply/student" variant="primary">
            Start application →
          </Button>
          <p className={styles.startNote}>
            Your draft autosaves in this browser as you go, and a reference number is issued when you submit —
            keep it safe.
          </p>
        </div>
        <ResumeDraft />
      </section>

      <p className={styles.conceptNote}>
        <span className="demo-badge">Demo data</span>
        <span className={styles.conceptNoteText}>{CONTENT_DEMO_NOTE}</span>
      </p>
    </div>
  );
}
