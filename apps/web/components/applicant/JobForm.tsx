"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChinarMark } from "@/components/ui/ChinarMark";
import Button from "@/components/ui/Button";
import type { Vacancy } from "@/modules/content/demo";
import { demoNowIso } from "@/modules/demo/clock";
import { formatKolkata } from "@/modules/iot/domain";
import { careersService } from "@/modules/services/careers";
import { sessionKey } from "@/modules/services/session";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { uploadDocumentFile } from "@/modules/services/document-upload";

import styles from "./JobForm.module.css";

/* ------------------------------------------------------------------ */
/* Step definitions and option lists                                   */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    key: "personal",
    title: "Personal details",
    note: "How the school may reach you about this application.",
  },
  {
    key: "qualifications",
    title: "Qualifications",
    note: "The qualification most relevant to this position.",
  },
  {
    key: "experience",
    title: "Experience & documents",
    note: "Your experience, and the documents required for this vacancy.",
  },
  {
    key: "review",
    title: "Review & consent",
    note: "Check your details, then agree to the declaration and submit.",
  },
] as const;

const QUALIFICATIONS = [
  "Master of Arts (M.A.)",
  "Master of Science (M.Sc.)",
  "Bachelor of Arts (B.A.)",
  "Bachelor of Science (B.Sc.)",
  "Bachelor of Education (B.Ed.)",
  "Diploma",
  "Other",
] as const;

const EXPERIENCE_OPTIONS = [
  "Less than 1 year",
  "1–2 years",
  "3–5 years",
  "6–10 years",
  "More than 10 years",
] as const;

const YEARS = Array.from({ length: 2026 - 1996 + 1 }, (_, i) => 2026 - i);

type Values = {
  fullName: string;
  phone: string;
  email: string;
  qualification: string;
  subject: string;
  year: string;
  institution: string;
  experience: string;
  currentRole: string;
  documents: Record<string, string>;
  consent: boolean;
};

const EMPTY_VALUES: Values = {
  fullName: "",
  phone: "",
  email: "",
  qualification: "",
  subject: "",
  year: "",
  institution: "",
  experience: "",
  currentRole: "",
  documents: {},
  consent: false,
};

/* A draft older than seven demo days needs an explicit review choice. This
   uses demoNowIso rather than the browser clock so the prototype stays
   deterministic in tests and across the concept experience. */
const STALE_DRAFT_DAYS = 7;
const DEMO_DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DRAFT_WINDOW_MS = STALE_DRAFT_DAYS * DEMO_DAY_MS;

/** String fields kept in the tab-session draft. Contact details (phone,
 * email) and document upload details are sensitive and stay in component
 * memory only — a reload re-asks for them. */
const DRAFT_STRING_KEYS = [
  "fullName",
  "qualification",
  "subject",
  "year",
  "institution",
  "experience",
  "currentRole",
] as const satisfies readonly (keyof Values)[];

type DraftEnvelope = {
  step: number;
  values: Values;
  savedAtIso?: string;
};

type AutosaveStatus = "restored" | "current" | "stale" | "unavailable" | "saved";
type DraftRecovery = "stale" | "legacy";
type StorageIssue = "malformed" | "unavailable" | "write" | "remove";

function emptyValues(): Values {
  return { ...EMPTY_VALUES, documents: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep only the known non-sensitive draft fields; malformed storage must
 * not be written back. Phone, email, and document upload details are never
 * restored from browser storage. */
function sanitizeValues(raw: unknown): Values | null {
  if (!isRecord(raw)) return null;

  const next = emptyValues();
  for (const key of DRAFT_STRING_KEYS) {
    const value = raw[key];
    if (value !== undefined && typeof value !== "string") return null;
    if (typeof value === "string") next[key] = value;
  }

  if (raw.consent !== undefined) {
    if (typeof raw.consent !== "boolean") return null;
    next.consent = raw.consent;
  }

  return next;
}

function parseDraftEnvelope(raw: string): DraftEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const values = sanitizeValues(parsed.values);
  if (!values) return null;

  let step = 0;
  if (parsed.step !== undefined) {
    if (typeof parsed.step !== "number" || !Number.isFinite(parsed.step)) return null;
    step = Math.min(Math.max(Math.trunc(parsed.step), 0), STEPS.length - 1);
  }

  let savedAtIso: string | undefined;
  if (parsed.savedAtIso !== undefined) {
    if (typeof parsed.savedAtIso !== "string" || !Number.isFinite(Date.parse(parsed.savedAtIso))) return null;
    savedAtIso = parsed.savedAtIso;
  }

  return { step, values, savedAtIso };
}

function isStaleDraft(savedAtIso: string): boolean {
  const savedAtMs = Date.parse(savedAtIso);
  const demoNowMs = Date.parse(demoNowIso());
  return Number.isFinite(savedAtMs) && Number.isFinite(demoNowMs) && demoNowMs - savedAtMs > STALE_DRAFT_WINDOW_MS;
}

function writeDraftEnvelope(draftKey: string, step: number, values: Values): string | null {
  if (clientAdapterMode() === "supabase") return null;
  const savedAtIso = demoNowIso();
  try {
    window.sessionStorage.setItem(draftKey, JSON.stringify({ step, values: toDraftValues(values), savedAtIso }));
    return savedAtIso;
  } catch {
    return null;
  }
}

/** Only non-sensitive recoverable fields are persisted: phone, email, and
 * document upload details stay in component memory and are re-entered after
 * a reload. */
function toDraftValues(values: Values): Values {
  return { ...values, phone: "", email: "", documents: {} };
}

const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateStep(step: number, values: Values, documents: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 0) {
    if (values.fullName.trim().length < 2) errors.fullName = "Enter your full name.";
    if (!PHONE_RE.test(values.phone.trim())) errors.phone = "Enter a valid 10-digit mobile number.";
    if (!EMAIL_RE.test(values.email.trim())) errors.email = "Enter a valid email address.";
  }
  if (step === 1) {
    if (!values.qualification) errors.qualification = "Choose your highest qualification.";
    if (!values.subject.trim()) errors.subject = "Enter your subject or specialisation.";
    if (!values.year) errors.year = "Choose the year you completed.";
    if (!values.institution.trim()) errors.institution = "Enter the institution.";
  }
  if (step === 2) {
    if (!values.experience) errors.experience = "Choose your years of experience.";
    if (!values.currentRole.trim()) errors.currentRole = "Enter your current role.";
    for (const doc of documents) {
      if (!values.documents[doc]?.trim()) errors[`doc:${doc}`] = `${doc} is required.`;
    }
  }
  if (step === 3) {
    if (!values.consent) errors.consent = "You must agree to the declaration before submitting.";
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Field shell — label, control, help and error with a shared id       */
/* ------------------------------------------------------------------ */

type FieldShellProps = {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  full?: boolean;
  help?: string;
  children: ReactNode;
};

function FieldShell({ id, label, required, error, full, help, children }: FieldShellProps) {
  return (
    <div className={`field ${full ? styles.full : ""} ${error ? "field--invalid" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children}
      {help && !error ? <p className="field-help">{help}</p> : null}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The application                                                     */
/* ------------------------------------------------------------------ */

export default function JobForm({ vacancy }: { vacancy: Vacancy }) {
  const router = useRouter();
  const supabaseMode = clientAdapterMode() === "supabase";
  const draftKey = supabaseMode ? "" : sessionKey(`job-draft:${vacancy.slug}`);

  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastSavedIso, setLastSavedIso] = useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("current");
  const [draftRecovery, setDraftRecovery] = useState<DraftRecovery | null>(null);
  const [storageIssue, setStorageIssue] = useState<StorageIssue | null>(null);
  const [autosavePaused, setAutosavePaused] = useState(false);
  const [restored, setRestored] = useState(false);
  const [focusIntro, setFocusIntro] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [applicationRef, setApplicationRef] = useState<string | null>(null);
  const [uploadStates, setUploadStates] = useState<Record<string, "uploading" | "ready" | "failed">>({});

  const introRef = useRef<HTMLHeadingElement>(null);
  const recoveryRef = useRef<HTMLElement>(null);
  const prevStepRef = useRef(step);
  const skipInitialAutosaveRef = useRef(true);

  /* Restore the autosaved draft, if any. Invalid or unreadable storage is
     reported and left untouched so it cannot be silently overwritten. */
  useEffect(() => {
    skipInitialAutosaveRef.current = true;
    setDraftRecovery(null);
    setStorageIssue(null);
    setAutosavePaused(false);

    if (supabaseMode) {
      void careersService.getDraft(vacancy.slug).then((saved) => {
        if (saved) {
          setApplicationRef(saved.ref);
          setValues(saved.draft);
          setLastSavedIso(saved.savedAtIso);
          setAutosaveStatus("restored");
        }
        setRestored(true);
      }).catch(() => {
        setAutosaveStatus("unavailable");
        setStorageIssue("unavailable");
        setAutosavePaused(true);
        setRestored(true);
      });
      return;
    }

    try {
      const raw = window.sessionStorage.getItem(draftKey);
      if (!raw) {
        setLastSavedIso(null);
        setAutosaveStatus("current");
      } else {
        const parsed = parseDraftEnvelope(raw);
        if (!parsed) {
          setLastSavedIso(null);
          setAutosaveStatus("unavailable");
          setStorageIssue("malformed");
          setAutosavePaused(true);
        } else {
          setStep(parsed.step);
          setValues(parsed.values);
          if (!parsed.savedAtIso) {
            setLastSavedIso(null);
            setAutosaveStatus("current");
            setDraftRecovery("legacy");
            setAutosavePaused(true);
          } else if (isStaleDraft(parsed.savedAtIso)) {
            setLastSavedIso(parsed.savedAtIso);
            setAutosaveStatus("stale");
            setDraftRecovery("stale");
            setAutosavePaused(true);
          } else {
            setLastSavedIso(parsed.savedAtIso);
            setAutosaveStatus("restored");
          }
        }
      }
    } catch {
      setLastSavedIso(null);
      setAutosaveStatus("unavailable");
      setStorageIssue("unavailable");
      setAutosavePaused(true);
    }
    setRestored(true);
  }, [draftKey, supabaseMode, vacancy.slug]);

  /* Autosave the draft on every change, debounced. A restored stale/legacy
     draft stays paused until the applicant chooses a recovery action. */
  useEffect(() => {
    if (!restored || supabaseMode) return;
    if (skipInitialAutosaveRef.current) {
      skipInitialAutosaveRef.current = false;
      return;
    }
    if (autosavePaused) return;

    const t = window.setTimeout(() => {
      const savedAtIso = writeDraftEnvelope(draftKey, step, values);
      if (savedAtIso) {
        setLastSavedIso(savedAtIso);
        setAutosaveStatus("saved");
        setStorageIssue(null);
      } else {
        /* Storage may be unavailable (for example, private mode). Say so
           honestly so the applicant never believes it survived a route change. */
        setAutosaveStatus("unavailable");
        setStorageIssue("write");
        setAutosavePaused(true);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [step, values, restored, draftKey, autosavePaused, supabaseMode]);

  /* Move keyboard and screen-reader focus to the step heading. */
  useEffect(() => {
    if (prevStepRef.current !== step) {
      prevStepRef.current = step;
      introRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (draftRecovery) recoveryRef.current?.focus();
  }, [draftRecovery]);

  useEffect(() => {
    if (focusIntro) {
      introRef.current?.focus();
      setFocusIntro(false);
    }
  }, [focusIntro]);

  function setField<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function setDocument(doc: string, fileName: string) {
    setValues((v) => ({ ...v, documents: { ...v.documents, [doc]: fileName } }));
    const errorKey = `doc:${doc}`;
    setErrors((e) => {
      if (!(errorKey in e)) return e;
      const next = { ...e };
      delete next[errorKey];
      return next;
    });
  }

  async function handleDocumentFile(doc: string, file: File | undefined) {
    if (!file) return;
    if (!supabaseMode) {
      setDocument(doc, file.name);
      return;
    }
    setUploadStates((current) => ({ ...current, [doc]: "uploading" }));
    try {
      const saved = await careersService.saveDraft(vacancy.slug, values, applicationRef ?? undefined);
      const ownerRef = saved.draftRef ?? applicationRef;
      if (!ownerRef) throw new Error("Save the application draft before uploading a document.");
      setApplicationRef(ownerRef);
      const uploaded = await uploadDocumentFile({ ownerDomain: "job_application", ownerRecordRef: ownerRef, attachmentCode: doc, file });
      setDocument(doc, uploaded.documentRef);
      setUploadStates((current) => ({ ...current, [doc]: uploaded.status === "ready" ? "ready" : "uploading" }));
    } catch {
      setUploadStates((current) => ({ ...current, [doc]: "failed" }));
    }
  }

  function reviewDraft() {
    setErrors({});
    setStep(STEPS.length - 1);
    setFocusIntro(true);
  }

  function keepDraft() {
    /* Keep the stored envelope untouched until the applicant changes a value;
       Save now is the explicit action that refreshes its timestamp. */
    const keptRecovery = draftRecovery;
    skipInitialAutosaveRef.current = true;
    setDraftRecovery(null);
    setStorageIssue(null);
    setAutosaveStatus(keptRecovery === "stale" ? "stale" : "current");
    setAutosavePaused(false);
    setFocusIntro(true);
  }

  function saveNow() {
    if (supabaseMode) {
      void careersService.saveDraft(vacancy.slug, values, applicationRef ?? undefined).then((saved) => {
        if (saved.draftRef) setApplicationRef(saved.draftRef);
        setLastSavedIso(saved.savedAtIso);
        setAutosaveStatus("saved");
        setDraftRecovery(null);
      }).catch(() => {
        setAutosaveStatus("unavailable");
        setStorageIssue("write");
      });
      return;
    }
    const savedAtIso = writeDraftEnvelope(draftKey, step, values);
    if (!savedAtIso) {
      setAutosaveStatus("unavailable");
      setStorageIssue("write");
      setAutosavePaused(true);
      return;
    }
    setLastSavedIso(savedAtIso);
    setAutosaveStatus("saved");
    setStorageIssue(null);
    skipInitialAutosaveRef.current = true;
    setAutosavePaused(false);
    setDraftRecovery(null);
    setFocusIntro(true);
  }

  function startOver() {
    let cleared = true;
    if (!supabaseMode) {
      try {
        window.sessionStorage.removeItem(draftKey);
      } catch {
        cleared = false;
      }
    }

    skipInitialAutosaveRef.current = true;
    setStep(0);
    setValues(emptyValues());
    setErrors({});
    setSubmitError(null);
    setDraftRecovery(null);
    setFocusIntro(true);
    setLastSavedIso(null);

    if (cleared) {
      setAutosaveStatus("current");
      setStorageIssue(null);
      setAutosavePaused(false);
    } else {
      setAutosaveStatus("unavailable");
      setStorageIssue("remove");
      setAutosavePaused(true);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const errs = validateStep(step, values, vacancy.documents);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (step < STEPS.length - 1) {
      setErrors({});
      setStep(step + 1);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const saved = await careersService.saveDraft(vacancy.slug, values, applicationRef ?? undefined);
      const { ref } = await careersService.submitApplication(vacancy.slug, values, saved.draftRef ?? applicationRef ?? undefined);
      if (!supabaseMode) {
        try {
          window.sessionStorage.removeItem(draftKey);
        } catch {
          /* Ignore storage failures on submit. */
        }
      }
      router.push(`/apply/job/${ref}/status`);
    } catch {
      setSubmitting(false);
      setSubmitError(
        "We could not submit your application right now. Your details are still here — please try again.",
      );
    }
  }

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;
  /* Error-summary entries resolve each error key to its field id so every
     line is an anchor link that moves focus to the invalid control. */
  const errorEntries = Object.entries(errors).map(([key, message]) => ({
    key,
    message,
    target: key.startsWith("doc:") ? `doc-${vacancy.documents.indexOf(key.slice(4))}` : key,
  }));
  const autosaveCopy =
    autosaveStatus === "unavailable"
      ? "Autosave unavailable — changes stay on this page only"
      : autosaveStatus === "stale"
        ? "Draft stale — review before submitting"
        : autosaveStatus === "restored"
          ? "Draft restored — autosave on"
          : autosaveStatus === "saved"
            ? "Draft saved — autosave on"
            : lastSavedIso
              ? "Draft current — autosave on"
              : "Draft current — not saved yet";
  const storageIssueCopy =
    storageIssue === "malformed"
      ? "The saved browser draft could not be read. We did not replace it; this form stays available only until you leave the page."
      : storageIssue === "unavailable"
        ? "This browser did not allow the saved draft to be read. Changes stay on this page only."
        : storageIssue === "remove"
          ? "We could not clear the older browser draft. This new form stays on this page only."
          : storageIssue === "write"
            ? "We could not save the latest change. Changes stay on this page only."
            : null;

  return (
    <div className={styles.shell}>
      {/* The rail title is hidden on small screens, so the page carries a
          visually hidden h1 for heading structure. The rail h1 is aria-
          hidden to avoid duplicate announcements. */}
      <h1 className="sr-only">
        {vacancy.title} — {vacancy.department}, {vacancy.type}
      </h1>
      <aside className={styles.rail} aria-label="Application progress">
        <p className={styles.railLabel}>Vacancy application</p>
        <h1 className={styles.railTitle} aria-hidden="true">
          {vacancy.title}
          <em>
            {vacancy.department} · {vacancy.type}
          </em>
        </h1>
        <ol className={styles.railList}>
          {STEPS.map((s, i) => {
            const state = i < step ? "done" : i === step ? "current" : "todo";
            return (
              <li
                key={s.key}
                className={`${styles.railItem} ${state === "done" ? styles.railItemDone : ""} ${
                  state === "current" ? styles.railItemCurrent : ""
                }`}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span aria-hidden="true">{state === "done" ? "✓" : String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{s.title}</strong>
                  <small>{state === "done" ? "Complete" : state === "current" ? "In progress" : "Not started"}</small>
                </div>
              </li>
            );
          })}
        </ol>
        <div className={styles.railHelp}>
          <strong>Application closes</strong>
          <p>{formatKolkata(vacancy.deadlineIso, { format: "full" })}</p>
          <Link href={`/careers/${vacancy.slug}`}>View vacancy details →</Link>
        </div>
      </aside>

      {/* Form workspace ------------------------------------------------ */}
      <section className={styles.workspace} aria-label="Application form">
        {errorEntries.length > 0 ? (
          <div className={styles.errorSummary} role="alert">
            <p>Please correct the following before continuing.</p>
            <ul>
              {errorEntries.map(({ key, message, target }) => (
                <li key={key}>
                  <a href={`#${target}`} aria-label={message}>
                    Review this answer
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {submitError ? (
          <p className={styles.submitError} role="alert">
            {submitError}
          </p>
        ) : null}

        {draftRecovery ? (
          <section
            ref={recoveryRef}
            tabIndex={-1}
            className={`panel ${styles.draftRecovery} ${
              draftRecovery === "stale" ? styles.draftRecoveryStale : styles.draftRecoveryLegacy
            }`}
            role={draftRecovery === "stale" ? "alert" : "status"}
            aria-labelledby="draft-recovery-title"
          >
            <p className="section-label">Draft recovery</p>
            <h3 id="draft-recovery-title" className={styles.draftRecoveryTitle}>
              {draftRecovery === "stale" ? "This draft may be out of date" : "Older draft format — review before submitting"}
            </h3>
            <p className={styles.recoveryCopy}>
              {draftRecovery === "stale"
                ? `This draft was saved more than ${STALE_DRAFT_DAYS} demo days ago. We kept all of its values and paused autosave until you choose what to do.`
                : "This draft has no saved timestamp. We kept all of its values and will not discard them."}
            </p>
            <div className={styles.recoveryActions}>
              <Button variant="primary" onClick={reviewDraft}>
                Review draft
              </Button>
              <Button variant="danger" onClick={startOver}>
                Start over
              </Button>
              <Button variant="quiet" onClick={keepDraft}>
                Keep draft
              </Button>
              <Button variant="quiet" onClick={saveNow}>
                Save now
              </Button>
            </div>
          </section>
        ) : null}

        {storageIssueCopy ? (
          <div className={`panel ${styles.storageNotice}`} role="alert">
            <p className={styles.storageNoticeTitle}>Autosave unavailable</p>
            <p>{storageIssueCopy}</p>
          </div>
        ) : null}

        <div className={styles.formIntro}>
          <p className="eyebrow">
            Step {step + 1} of {STEPS.length}
          </p>
          <h2 ref={introRef} tabIndex={-1} className={styles.formTitle}>
            {current.title}
          </h2>
          <p>{current.note}</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {step === 0 ? (
            <>
              <FieldShell id="fullName" label="Full name" required error={errors.fullName}>
                <input
                  id="fullName"
                  className="input"
                  autoComplete="name"
                  value={values.fullName}
                  onChange={(e) => setField("fullName", e.target.value)}
                  aria-describedby={errors.fullName ? "fullName-error" : undefined}
                />
              </FieldShell>
              <FieldShell id="phone" label="Phone" required error={errors.phone}>
                <input
                  id="phone"
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="10-digit mobile number"
                  value={values.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                />
              </FieldShell>
              <FieldShell id="email" label="Email" required error={errors.email} full>
                <input
                  id="email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={(e) => setField("email", e.target.value)}
                  aria-describedby={errors.email ? "email-error" : undefined}
                />
              </FieldShell>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <FieldShell id="qualification" label="Highest qualification" required error={errors.qualification}>
                <select
                  id="qualification"
                  className="select"
                  value={values.qualification}
                  onChange={(e) => setField("qualification", e.target.value)}
                  aria-describedby={errors.qualification ? "qualification-error" : undefined}
                >
                  <option value="">Choose…</option>
                  {QUALIFICATIONS.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </FieldShell>
              <FieldShell id="subject" label="Subject / specialisation" required error={errors.subject}>
                <input
                  id="subject"
                  className="input"
                  value={values.subject}
                  onChange={(e) => setField("subject", e.target.value)}
                  aria-describedby={errors.subject ? "subject-error" : undefined}
                />
              </FieldShell>
              <FieldShell id="institution" label="Institution" required error={errors.institution}>
                <input
                  id="institution"
                  className="input"
                  autoComplete="organization"
                  value={values.institution}
                  onChange={(e) => setField("institution", e.target.value)}
                  aria-describedby={errors.institution ? "institution-error" : undefined}
                />
              </FieldShell>
              <FieldShell id="year" label="Year completed" required error={errors.year}>
                <select
                  id="year"
                  className="select"
                  value={values.year}
                  onChange={(e) => setField("year", e.target.value)}
                  aria-describedby={errors.year ? "year-error" : undefined}
                >
                  <option value="">Choose…</option>
                  {YEARS.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </FieldShell>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <FieldShell id="experience" label="Years of experience" required error={errors.experience}>
                <select
                  id="experience"
                  className="select"
                  value={values.experience}
                  onChange={(e) => setField("experience", e.target.value)}
                  aria-describedby={errors.experience ? "experience-error" : undefined}
                >
                  <option value="">Choose…</option>
                  {EXPERIENCE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </FieldShell>
              <FieldShell id="currentRole" label="Current role" required error={errors.currentRole}>
                <input
                  id="currentRole"
                  className="input"
                  autoComplete="organization-title"
                  value={values.currentRole}
                  onChange={(e) => setField("currentRole", e.target.value)}
                  aria-describedby={errors.currentRole ? "currentRole-error" : undefined}
                />
              </FieldShell>
              <div className={`field ${styles.full}`}>
                <p className={styles.docHeading}>
                  Documents required <span aria-hidden="true">*</span>
                </p>
                <p className="field-help">
                  {supabaseMode ? "Select each file. Files upload to private storage and remain pending scan until the scanner marks them ready." : "Select each file. Only the file name is recorded in this demo; nothing leaves your device."}
                </p>
              </div>
              {vacancy.documents.map((doc, i) => {
                const error = errors[`doc:${doc}`];
                const fieldId = `doc-${i}`;
                return (
                  <div
                    className={`field ${styles.full} ${error ? "field--invalid" : ""}`}
                    key={doc}
                  >
                    <label htmlFor={fieldId}>{doc}</label>
                    <input
                      id={fieldId}
                      className={`input ${styles.fileInput}`}
                      type="file"
                      onChange={(e) => void handleDocumentFile(doc, e.target.files?.[0])}
                      aria-describedby={error ? `${fieldId}-error` : values.documents[doc] ? `${fieldId}-help` : undefined}
                    />
                    {values.documents[doc] ? (
                      <p className="field-help" id={`${fieldId}-help`}>
                        {uploadStates[doc] === "uploading" ? "Uploading…" : uploadStates[doc] === "failed" ? "Upload failed — choose the file again." : `Selected: ${values.documents[doc]}`}
                      </p>
                    ) : null}
                    {error ? (
                      <p className="field-error" id={`${fieldId}-error`}>
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className={`field ${styles.full}`}>
                <p className={styles.docHeading}>Your application</p>
                <div className="table--scroll">
                  <table className="table">
                    <tbody>
                      <tr>
                        <th scope="row">Full name</th>
                        <td>{values.fullName}</td>
                      </tr>
                      <tr>
                        <th scope="row">Phone</th>
                        <td>{values.phone}</td>
                      </tr>
                      <tr>
                        <th scope="row">Email</th>
                        <td>{values.email}</td>
                      </tr>
                      <tr>
                        <th scope="row">Highest qualification</th>
                        <td>{values.qualification}</td>
                      </tr>
                      <tr>
                        <th scope="row">Subject / specialisation</th>
                        <td>{values.subject}</td>
                      </tr>
                      <tr>
                        <th scope="row">Institution</th>
                        <td>
                          {values.institution} · {values.year}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Years of experience</th>
                        <td>{values.experience}</td>
                      </tr>
                      <tr>
                        <th scope="row">Current role</th>
                        <td>{values.currentRole}</td>
                      </tr>
                      <tr>
                        <th scope="row">Documents</th>
                        <td>
                          {vacancy.documents.map((doc) => {
                            const fileName = values.documents[doc];
                            return fileName ? `${doc} — ${fileName}` : `${doc} — not attached`;
                          }).join(" · ")}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div className={`field ${styles.full} ${errors.consent ? "field--invalid" : ""}`}>
                <label className={styles.consent} htmlFor="consent">
                  <input
                    id="consent"
                    type="checkbox"
                    checked={values.consent}
                    onChange={(e) => setField("consent", e.target.checked)}
                    aria-describedby={errors.consent ? "consent-error" : undefined}
                  />
                  <span>
                    I confirm that the information I have provided is accurate, and I understand that applications are
                    retained for the period stated in the vacancy, then deleted or anonymised.
                  </span>
                </label>
                <p className="field-help">The submit button activates once you tick this declaration.</p>
                {errors.consent ? (
                  <p className="field-error" id="consent-error">
                    {errors.consent}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          <div className={styles.actions}>
            {step > 0 ? (
              <Button
                variant="quiet"
                disabled={submitting}
                onClick={() => {
                  setErrors({});
                  setStep(step - 1);
                }}
              >
                ← Back
              </Button>
            ) : (
              <span />
            )}
            <div className={styles.actionsRight}>
              <p className={styles.savedNote} aria-live="polite">
                {autosaveStatus === "saved" ? "✓ " : ""}
                {autosaveCopy}
              </p>
              <Button variant="primary" type="submit" disabled={submitting || (isLast && !values.consent)}>
                {isLast ? (submitting ? "Submitting…" : "Submit application →") : "Save & continue →"}
              </Button>
            </div>
          </div>
        </form>
      </section>

      {/* Application context -------------------------------------------- */}
      <aside className={styles.context} aria-label="Application context">
        <div className={styles.contextBlock}>
          <p className="section-label">Application status</p>
          <p className={styles.contextTitle}>Draft</p>
          <p className={styles.contextSmall}>{supabaseMode ? "Saved to your application record across devices." : "Saved in this browser. A reference is issued on submission."}</p>
        </div>
        <div className={styles.contextBlock}>
          <p className="section-label">Vacancy</p>
          <p className={styles.contextTitle}>{vacancy.title}</p>
          <p className={styles.contextSmall}>
            {vacancy.department} · {vacancy.location} · {vacancy.type}
            <br />
            Closes {formatKolkata(vacancy.deadlineIso, { format: "full" })}
          </p>
        </div>
        <div className={styles.contextBlock}>
          <p className="section-label">Documents required</p>
          <ul className={styles.docList}>
            {vacancy.documents.map((doc) => (
              <li key={doc}>{doc}</li>
            ))}
          </ul>
        </div>
        <div className={styles.privacyNote}>
          <ChinarMark size={14} tone="saffron" />
          <p>
            Your application is visible only to authorised HR and recruitment panel members. Internal review notes are
            not shared.
          </p>
        </div>
      </aside>
    </div>
  );
}
