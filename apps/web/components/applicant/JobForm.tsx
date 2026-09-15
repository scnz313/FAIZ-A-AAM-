"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";

import { ChinarMark } from "@/components/ui/ChinarMark";
import Button from "@/components/ui/Button";
import type { Vacancy } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { careersService } from "@/modules/services/careers";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  PUBLIC_PHOTO_MAX_BYTES,
  PUBLIC_PHOTO_MIME_TYPES,
  PublicIntakeError,
  submitPublicJobApplication,
  uploadPublicApplicationPhoto,
} from "@/modules/services/public-careers";

import styles from "./JobForm.module.css";

/* ------------------------------------------------------------------ */
/* Public application flow (owner requirement, 15 September 2026)      */
/*                                                                     */
/* The applicant never signs in and never uploads a document. The one  */
/* optional profile photo is attached after submission through the     */
/* same-origin intake routes; every other field is a text value.       */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    key: "contact",
    title: "Your details",
    note: "How the school may reach you about this application.",
  },
  {
    key: "experience",
    title: "Experience & qualification",
    note: "The qualification and experience most relevant to this position.",
  },
  {
    key: "review",
    title: "Review & consent",
    note: "Check your details, add an optional photo, then agree to the declaration.",
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
  email: string;
  phone: string;
  location: string;
  qualification: string;
  subject: string;
  year: string;
  institution: string;
  experience: string;
  currentRole: string;
  message: string;
  consent: boolean;
  /** Honeypot: hidden from people, filled only by automated probes. */
  website: string;
};

const EMPTY_VALUES: Values = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  qualification: "",
  subject: "",
  year: "",
  institution: "",
  experience: "",
  currentRole: "",
  message: "",
  consent: false,
  website: "",
};

type PhotoState =
  | { kind: "idle" }
  | { kind: "ready"; file: File }
  | { kind: "uploading" }
  | { kind: "failed"; message: string };

type Submitted = {
  reference: string | null;
  email: string;
  photo: "none" | "attached" | "failed" | "demo";
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s]{0,24}$/;

function validateStep(step: number, values: Values): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 0) {
    if (values.fullName.trim().length < 2) errors.fullName = "Enter your full name.";
    if (!EMAIL_RE.test(values.email.trim())) errors.email = "Enter a valid email address.";
    if (values.phone.trim().length > 0 && !PHONE_RE.test(values.phone.trim())) errors.phone = "Enter a valid phone number, or leave it blank.";
    if (values.location.trim().length > 160) errors.location = "Keep the location to 160 characters or fewer.";
  }
  if (step === 1) {
    if (!values.qualification) errors.qualification = "Choose your highest qualification.";
    if (!values.experience) errors.experience = "Choose your years of experience.";
    if (values.message.trim().length > 2000) errors.message = "Keep your note to 2,000 characters or fewer.";
  }
  if (step === 2) {
    if (!values.consent) errors.consent = "You must agree to the declaration before submitting.";
  }
  return errors;
}

function photoTypeError(file: File): string | null {
  if (!PUBLIC_PHOTO_MIME_TYPES.includes(file.type as (typeof PUBLIC_PHOTO_MIME_TYPES)[number])) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size <= 0) return "The chosen image is empty. Choose another file.";
  if (file.size > PUBLIC_PHOTO_MAX_BYTES) return "The photo must be 2 MB or smaller.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Field shell · label, control, help and error with a shared id       */
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
  const supabaseMode = clientAdapterMode() === "supabase";
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoState>({ kind: "idle" });
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  const introRef = useRef<HTMLHeadingElement>(null);
  const prevStepRef = useRef(step);

  useEffect(() => {
    if (prevStepRef.current !== step) {
      prevStepRef.current = step;
      introRef.current?.focus();
    }
  }, [step]);

  function setField<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function focusFirstError(nextErrors: Record<string, string>) {
    const firstId = Object.keys(nextErrors)[0];
    if (!firstId) return;
    window.setTimeout(() => document.getElementById(firstId)?.focus(), 0);
  }

  function choosePhoto(file: File | undefined) {
    if (file === undefined) {
      setPhoto({ kind: "idle" });
      return;
    }
    const typeError = photoTypeError(file);
    if (typeError !== null) {
      setPhoto({ kind: "failed", message: typeError });
      return;
    }
    setPhoto({ kind: "ready", file });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const errs = validateStep(step, values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      focusFirstError(errs);
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
      let reference: string | null;
      if (supabaseMode) {
        if (vacancy.reference === undefined || vacancy.version === undefined) {
          throw new PublicIntakeError("unavailable", "This vacancy is not accepting online applications right now · please contact the school office.");
        }
        const result = await submitPublicJobApplication(
          {
            vacancyRef: vacancy.reference,
            vacancyVersion: vacancy.version,
            fullName: values.fullName.trim(),
            email: values.email.trim(),
            phone: values.phone.trim(),
            location: values.location.trim(),
            qualification: values.qualification,
            subject: values.subject.trim(),
            year: values.year,
            institution: values.institution.trim(),
            experience: values.experience,
            currentRole: values.currentRole.trim(),
            message: values.message.trim(),
            consent: true,
          },
          values.website,
        );
        reference = result.reference;

        let photoOutcome: Submitted["photo"] = "none";
        if (photo.kind === "ready" && reference !== null) {
          setPhoto({ kind: "uploading" });
          try {
            await uploadPublicApplicationPhoto({ reference, file: photo.file });
            photoOutcome = "attached";
            setPhoto({ kind: "idle" });
          } catch {
            photoOutcome = "failed";
            setPhoto({ kind: "failed", message: "The photo could not be attached. Your application is not affected." });
          }
        }
        setSubmitted({ reference, email: values.email.trim(), photo: photoOutcome });
      } else {
        const { ref } = await careersService.submitApplication(vacancy.slug, {
          fullName: values.fullName.trim(),
          phone: values.phone.trim(),
          email: values.email.trim(),
          location: values.location.trim(),
          qualification: values.qualification,
          subject: values.subject.trim(),
          year: values.year,
          institution: values.institution.trim(),
          experience: values.experience,
          currentRole: values.currentRole.trim(),
          message: values.message.trim(),
          consent: true,
        });
        setSubmitted({ reference: ref, email: values.email.trim(), photo: photo.kind === "ready" ? "demo" : "none" });
      }
      setSubmitting(false);
    } catch (error) {
      setSubmitting(false);
      if (photo.kind === "uploading") setPhoto({ kind: "idle" });
      setSubmitError(
        error instanceof PublicIntakeError
          ? error.message
          : "We could not submit your application right now. Your details are still on this page · please try again.",
      );
    }
  }

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;
  const errorEntries = Object.entries(errors).map(([key, message]) => ({ key, message, target: key }));
  const photoCopy =
    photo.kind === "ready"
      ? `Selected: ${photo.file.name}`
      : photo.kind === "uploading"
        ? "Uploading the photo…"
        : photo.kind === "failed"
          ? photo.message
          : `Optional · JPEG, PNG, or WebP, up to 2 MB. Attached privately to your application.`;

  return (
    <div className={styles.shell}>
      <h1 className="sr-only">
        {vacancy.title} · {vacancy.department}, {vacancy.type}
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
                <span aria-hidden="true">{state === "done" ? <span className="msym">check</span> : String(i + 1).padStart(2, "0")}</span>
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
        {submitted !== null ? (
          <div className="panel" role="status">
            <div className="pn-body">
              <p className="section-label">Application submitted</p>
              <h2>Thank you · your application is with the school.</h2>
              {submitted.reference !== null ? (
                <p>
                  Keep this reference: <span className="num">{submitted.reference}</span>.
                </p>
              ) : null}
              <p>
                Every update arrives by email at <strong>{submitted.email}</strong>. There is no portal to check; the
                school&rsquo;s HR office emails you whenever the status changes or a decision is recorded. If you are
                shortlisted, they will contact you to arrange an interview.
              </p>
              {submitted.photo === "attached" ? (
                <p>Your profile photo was attached to the application and is awaiting the school&rsquo;s safety scan.</p>
              ) : null}
              {submitted.photo === "failed" ? (
                <p>
                  Your application was received, but the profile photo could not be attached. Reply to your
                  confirmation email if you would like the office to add one.
                </p>
              ) : null}
              {submitted.photo === "demo" ? (
                <p>Demo mode: the chosen photo stayed on this device and was not uploaded.</p>
              ) : null}
              <p>
                <Link className="btn btn-primary" href="/careers">
                  Back to vacancies
                </Link>
              </p>
            </div>
          </div>
        ) : (
          <>
            {errorEntries.length > 0 ? (
              <div className={styles.errorSummary} role="alert">
                <p>Please correct the following before continuing.</p>
                <ul>
                  {errorEntries.map(({ key, message, target }) => (
                    <li key={key}>
                      <a href={`#${target}`} aria-label={`${message} Review this answer`}>
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
                  <FieldShell id="email" label="Email" required error={errors.email} help="Every update, including the decision, arrives at this address.">
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
                  <FieldShell id="phone" label="Phone" error={errors.phone} help="Optional · used only to arrange an interview.">
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
                  <FieldShell id="location" label="Where you are based" error={errors.location} help="Optional · town or district.">
                    <input
                      id="location"
                      className="input"
                      autoComplete="address-level2"
                      value={values.location}
                      onChange={(e) => setField("location", e.target.value)}
                      aria-describedby={errors.location ? "location-error" : undefined}
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
                  <FieldShell id="subject" label="Subject / specialisation">
                    <input
                      id="subject"
                      className="input"
                      value={values.subject}
                      onChange={(e) => setField("subject", e.target.value)}
                    />
                  </FieldShell>
                  <FieldShell id="institution" label="Institution">
                    <input
                      id="institution"
                      className="input"
                      autoComplete="organization"
                      value={values.institution}
                      onChange={(e) => setField("institution", e.target.value)}
                    />
                  </FieldShell>
                  <FieldShell id="year" label="Year completed">
                    <select
                      id="year"
                      className="select"
                      value={values.year}
                      onChange={(e) => setField("year", e.target.value)}
                    >
                      <option value="">Choose…</option>
                      {YEARS.map((y) => (
                        <option key={y} value={String(y)}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </FieldShell>
                  <FieldShell id="currentRole" label="Current role">
                    <input
                      id="currentRole"
                      className="input"
                      autoComplete="organization-title"
                      value={values.currentRole}
                      onChange={(e) => setField("currentRole", e.target.value)}
                    />
                  </FieldShell>
                  <FieldShell id="message" label="Anything else for the panel" error={errors.message} full help="Optional · up to 2,000 characters. Please do not include sensitive identity numbers.">
                    <textarea
                      id="message"
                      className="textarea"
                      rows={5}
                      value={values.message}
                      onChange={(e) => setField("message", e.target.value)}
                      aria-describedby={errors.message ? "message-error" : undefined}
                    />
                  </FieldShell>
                </>
              ) : null}

              {step === 2 ? (
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
                            <th scope="row">Email</th>
                            <td>{values.email}</td>
                          </tr>
                          {values.phone.trim().length > 0 ? (
                            <tr>
                              <th scope="row">Phone</th>
                              <td>{values.phone}</td>
                            </tr>
                          ) : null}
                          {values.location.trim().length > 0 ? (
                            <tr>
                              <th scope="row">Based in</th>
                              <td>{values.location}</td>
                            </tr>
                          ) : null}
                          <tr>
                            <th scope="row">Highest qualification</th>
                            <td>
                              {values.qualification}
                              {values.subject.trim().length > 0 ? ` · ${values.subject}` : ""}
                              {values.institution.trim().length > 0 ? ` · ${values.institution}` : ""}
                              {values.year !== "" ? ` · ${values.year}` : ""}
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Experience</th>
                            <td>
                              {values.experience}
                              {values.currentRole.trim().length > 0 ? ` · ${values.currentRole}` : ""}
                            </td>
                          </tr>
                          {values.message.trim().length > 0 ? (
                            <tr>
                              <th scope="row">Note to the panel</th>
                              <td>{values.message}</td>
                            </tr>
                          ) : null}
                          <tr>
                            <th scope="row">Documents</th>
                            <td>None required · the school requests certificates only from shortlisted candidates</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className={`field ${styles.full} ${photo.kind === "failed" ? "field--invalid" : ""}`}>
                    <label htmlFor="photo">Profile photo</label>
                    <input
                      id="photo"
                      className={`input ${styles.fileInput}`}
                      type="file"
                      accept={PUBLIC_PHOTO_MIME_TYPES.join(",")}
                      onChange={(e) => choosePhoto(e.target.files?.[0])}
                      aria-describedby="photo-help"
                    />
                    <p className={photo.kind === "failed" ? "field-error" : "field-help"} id="photo-help">
                      {photoCopy}
                    </p>
                    {photo.kind === "ready" ? (
                      <Button variant="quiet" type="button" onClick={() => setPhoto({ kind: "idle" })}>
                        Remove photo
                      </Button>
                    ) : null}
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
                        I confirm that the information I have provided is accurate, and I understand that applications
                        are retained for the period stated in the vacancy, then deleted or anonymised.
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

              {/* Honeypot: hidden from people and assistive technology. */}
              <div className={styles.honeypot} aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={values.website}
                  onChange={(e) => setField("website", e.target.value)}
                />
              </div>

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
                    {supabaseMode ? "Your answers stay on this page until you submit." : "Demo mode · submission is recorded in this browser session."}
                  </p>
                  <Button variant="primary" type="submit" disabled={submitting || (isLast && !values.consent)}>
                    {isLast ? (submitting ? "Submitting…" : "Submit application →") : "Save & continue →"}
                  </Button>
                </div>
              </div>
            </form>
          </>
        )}
      </section>

      {/* Application context -------------------------------------------- */}
      <aside className={styles.context} aria-label="Application context">
        <div className={styles.contextBlock}>
          <p className="section-label">Application status</p>
          <p className={styles.contextTitle}>{submitted !== null ? "Submitted" : "Not submitted yet"}</p>
          <p className={styles.contextSmall}>
            {submitted !== null
              ? "Every update arrives by email. There is no portal to check."
              : "No account is needed. The school contacts every applicant by email."}
          </p>
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
          <p className="section-label">Documents</p>
          <ul className={styles.docList}>
            <li>None required with this application</li>
            <li>Optional profile photo · one image, up to 2 MB</li>
            <li>Shortlisted candidates are asked for certificates by the HR office</li>
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
