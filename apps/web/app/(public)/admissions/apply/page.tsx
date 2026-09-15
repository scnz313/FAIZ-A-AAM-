import type { Metadata } from "next";
import Link from "next/link";

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
  description: "Start a student admission application at Faiz Aam Secondary School · what you need, and how the application works.",
  alternates: { canonical: "/admissions/apply" },
};

/** Public labels for the configured upload types; an unmapped MIME type
 *  keeps its own name rather than inventing a friendly one. */
const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
};

const mimeLabel = (type: string): string => MIME_LABELS[type] ?? type;

const NEXT_STEPS = [
  { num: "01", title: "Complete the form", line: "Eight short sections · academic, student, guardian, address, prior school, medical, documents, and the declaration." },
  { num: "02", title: "Submit & receive a reference", line: "A reference number is issued at submission. It is how you track the application at every stage." },
  { num: "03", title: "Wait for review", line: "The admissions office verifies and reviews, then the family is invited for the assessment." },
];

export default async function AdmissionsApplyPage() {
  const configuration: AdmissionConfiguration = dataAdapter() === "supabase"
    ? await loadServerPublicAdmissionConfiguration()
    : DEMO_ADMISSION_CONFIGURATION;
  const currentYear = configuration.academicYears.find((year) => year.status === "current") ?? configuration.academicYears[0];
  /* The same requirement code is configured per admission window; this public
     list is grade-independent, so show each requirement once. */
  const documents = [...new Map(
    configuration.documentRequirements
      .filter((requirement) => requirement.required && requirement.status === "active")
      .map((requirement) => [requirement.code, requirement] as const),
  ).values()];
  const openWindows = configuration.windows.filter((window) => window.status === "open" && window.academicYearId === currentYear?.id);
  const gradeLabels = configuration.grades.filter((grade) => openWindows.some((window) => window.gradeId === grade.id)).map((grade) => grade.label);
  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="Admissions"
        title="Apply for admission"
        deck="A short, careful application · completed in your own time, saved as you go."
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
                <span>{doc.allowedMimeTypes.map(mimeLabel).join(" or ")} · up to {Math.round(doc.maxBytes / (1024 * 1024))} MB</span>
              </li>
            ))}
          </ul>
        </div>
        {documents.length > 0 ? (
          <p className={styles.docNote}>
            {[...new Set(documents.flatMap((doc) => doc.allowedMimeTypes))].map(mimeLabel).join(" or ")} · up to{" "}
            {Math.round(Math.max(...documents.map((doc) => doc.maxBytes)) / (1024 * 1024))} MB each
          </p>
        ) : (
          <p className={styles.docNote}>The document checklist follows the school’s confirmed admission policy.</p>
        )}
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
            {dataAdapter() === "supabase"
              ? "Sign in to start or resume an application. Drafts are saved to your account, not this browser."
              : "Your draft autosaves in this browser as you go, and a reference number is issued when you submit · keep it safe."}
          </p>
        </div>
        {dataAdapter() === "supabase" ? (
          <p className={styles.startNote}>
            Already started?{" "}
            <Link className="link-arrow" href="/sign-in">
              Sign in to resume your application →
            </Link>
          </p>
        ) : (
          <ResumeDraft />
        )}
      </section>

      {(() => {
        const firstOpen = openWindows[0];
        const formatDay = (iso: string) =>
          new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));
        const dates: ReadonlyArray<readonly [string, string]> = [
          ["Applications open", firstOpen ? `${formatDay(firstOpen.opensAtIso)} · online through this website` : "The board posts the date with the admission notice"],
          ["Window closes", firstOpen ? `${formatDay(firstOpen.closesAtIso)} · or when seats are filled` : "When seats are filled; the board posts the date"],
          ["Session begins", currentYear ? `${currentYear.label} · orientation the week before` : "April to March session"],
          ["Questions", "The office answers on working days at +91 90000 00000"],
        ];
        return (
          <section className={styles.datesSection} aria-label="Key dates">
            <div className="facts-ledger">
              {dates.map(([k, v]) => (
                <div className="fl-row" key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      <p className={styles.conceptNote}>
        <span className="demo-badge">Demo data</span>
        <span className={styles.conceptNoteText}>{CONTENT_DEMO_NOTE}</span>
      </p>
    </div>
  );
}
