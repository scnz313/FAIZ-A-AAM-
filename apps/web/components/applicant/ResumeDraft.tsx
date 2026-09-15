"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import { formatKolkata } from "@/modules/iot/domain";
import { sessionKey } from "@/modules/services/session";

import styles from "./ResumeDraft.module.css";

/** Must match the key used by ApplicationForm's autosave. */
const STORAGE_KEY = sessionKey("application-draft");

type DraftSummary = {
  grade: string;
  savedAtIso?: string;
};

/** Non-sensitive fields the student form may persist; the rest of the
 * application is never written to browser storage. */
const DRAFT_FIELDS = [
  "session",
  "grade",
  "studentName",
  "priorSchoolName",
  "lastClassAttended",
  "leavingCertificate",
] as const;

/** Read the browser draft; tolerate absent storage and corrupt JSON. */
function readDraft(): DraftSummary | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const hasContent =
      typeof record.savedAtIso === "string" ||
      DRAFT_FIELDS.some((key) => typeof record[key] === "string" && (record[key] as string).trim() !== "");
    if (!hasContent) return null;
    return {
      grade: typeof record.grade === "string" ? record.grade.trim() : "",
      savedAtIso: typeof record.savedAtIso === "string" ? record.savedAtIso : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resume-draft island on the admissions landing page. On mount it reads the
 * student form's tab-session draft (non-sensitive fields only) and offers
 * to continue or discard it; it renders nothing when no draft exists.
 * Demo-only — the real draft store arrives with the application backend.
 */
export default function ResumeDraft() {
  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    setDraft(readDraft());
  }, []);

  function handleStartOver() {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable (private mode, blocked cookies) — the
      // panel hides either way; the next visit simply starts fresh.
    }
    setDraft(null);
    setCleared(true);
  }

  const gradeLabel = draft?.grade ? draft.grade : "your application";
  const savedTime = draft?.savedAtIso ? ` · saved ${formatKolkata(draft.savedAtIso, { format: "time" })}` : "";

  return (
    <>
      {/* Always-mounted live region so the clear announcement is delivered. */}
      <p className="sr-only" role="status" aria-live="polite">
        {cleared ? "Draft cleared" : ""}
      </p>
      {draft ? (
        <section className={styles.panel} aria-labelledby="resume-draft-title">
          <div className={styles.head}>
            <p className="section-label">Saved application</p>
            <span className="demo-badge">Demo</span>
          </div>
          <h3 className={styles.title} id="resume-draft-title">
            Draft in progress · {gradeLabel}
            {savedTime}
          </h3>
          <p className={styles.line}>
            This browser holds a draft from the student application form. Continue to pick up exactly where you left
            off.
          </p>
          <div className={styles.actions}>
            <Button href="/apply/student" variant="primary">
              Continue application →
            </Button>
            <Button variant="quiet" onClick={handleStartOver}>
              Start over
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
