"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { formatKolkata } from "@/modules/iot/domain";
import { supportService } from "@/modules/services/support";
import type { Grievance, GrievanceCategory, GrievanceEvent } from "@/modules/services/support";

import styles from "./SupportForm.module.css";

const CATEGORIES: ReadonlyArray<GrievanceCategory> = ["Fees", "Results", "Timetable", "Documents", "Other"];

const STATUS_TONE: Record<Grievance["status"], StatusTone> = {
  New: "alert",
  "In progress": "watch",
  Resolved: "good",
};

type FieldErrors = {
  category?: string;
  subject?: string;
  message?: string;
  contactName?: string;
  consent?: string;
};

const FIELD_IDS: ReadonlyArray<keyof FieldErrors> = ["category", "subject", "message", "contactName", "consent"];

/** Applicant-safe thread: the submission is shown as the message; responses render here. */
function ResponseThread({ events }: { events: GrievanceEvent[] }) {
  const responses = events.filter((event) => event.kind === "response");
  if (responses.length === 0) {
    return <p className={styles.threadEmpty}>No response yet — the office responds on school days.</p>;
  }
  return (
    <ul className={styles.thread}>
      {responses.map((event, index) => (
        <li className={styles.threadEntry} key={`${event.atIso}-${index}`}>
          <p className={styles.threadText}>{event.text}</p>
          <p className={styles.threadMeta}>
            <span className={styles.threadBy}>{event.by}</span>
            <time className="num" dateTime={event.atIso}>
              {formatKolkata(event.atIso, { format: "full" })}
            </time>
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Portal grievance form and requester-side tracker. Submissions go through
 * the typed support service, so the reference, status, and thread shown here
 * are the same records the staff inbox reads and answers.
 */
export function SupportForm() {
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Grievance | null>(null);

  const [trackRef, setTrackRef] = useState("");
  const [tracking, setTracking] = useState(false);
  const [tracked, setTracked] = useState<Grievance | null>(null);
  const [trackedMissing, setTrackedMissing] = useState(false);

  const successRef = useRef<HTMLElement>(null);

  function fieldId(field: keyof FieldErrors): string {
    return `grievance-${field}`;
  }

  /* Move keyboard and screen-reader focus to the just-submitted record. */
  useEffect(() => {
    if (submitted !== null) successRef.current?.focus();
  }, [submitted]);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (category === "") next.category = "Choose the category that fits your concern.";
    if (subject.trim().length < 5) next.subject = "Enter a short subject — at least 5 characters.";
    if (message.trim().length < 20) next.message = "Describe your concern — at least 20 characters.";
    if (contactName.trim() === "") next.contactName = "Enter your name so the office can reach you.";
    if (!consent) next.consent = "Consent is required before the grievance can be accepted.";
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    const firstInvalid = FIELD_IDS.find((field) => next[field] !== undefined);
    if (firstInvalid !== undefined) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const { ref } = await supportService.submitGrievance({
        category: category as GrievanceCategory,
        subject: subject.trim(),
        message: message.trim(),
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim() === "" ? undefined : contactPhone.trim(),
      });
      setSubmitted(await supportService.getGrievance(ref));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setCategory("");
    setSubject("");
    setMessage("");
    setContactName("");
    setContactPhone("");
    setConsent(false);
    setErrors({});
    setSubmitted(null);
  }

  async function handleTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ref = trackRef.trim();
    if (ref === "") return;
    setTracking(true);
    setTracked(null);
    setTrackedMissing(false);
    try {
      const record = await supportService.getGrievance(ref);
      if (record === null) setTrackedMissing(true);
      else setTracked(record);
    } finally {
      setTracking(false);
    }
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className={styles.stack}>
      {submitted !== null ? (
        <section
          ref={successRef}
          tabIndex={-1}
          className={`panel ${styles.success}`}
          role="status"
          aria-live="polite"
        >
          <p className="section-label">Submitted</p>
          <div className={styles.recordHead}>
            <h2 className={styles.successTitle}>Concern received</h2>
            <StatusBadge tone={STATUS_TONE[submitted.status]}>{submitted.status}</StatusBadge>
          </div>
          <p className={styles.successLine}>
            Reference <strong className="num">{submitted.ref}</strong>
          </p>
          <p className={styles.successNote}>
            The office responds on school days. Responses appear in this thread.
          </p>
          <ResponseThread events={submitted.thread} />
          <Button variant="quiet" onClick={reset}>
            Submit another
          </Button>
        </section>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <p className="sr-only" role="status" aria-live="polite">
            {hasErrors
              ? "The form has errors. Please review the marked fields before submitting."
              : "Grievance form — all fields are required."}
          </p>

          {hasErrors && (
            <p className={styles.errorSummary} role="alert">
              Please correct the marked fields before submitting.
            </p>
          )}

          <div className={`field ${errors.category ? "field--invalid" : ""}`}>
            <label htmlFor={fieldId("category")}>
              Category <span aria-hidden="true">*</span>
            </label>
            <select
              id={fieldId("category")}
              className="select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-invalid={errors.category !== undefined}
              aria-describedby={errors.category ? `${fieldId("category")}-error` : undefined}
            >
              <option value="">Choose a category</option>
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            {errors.category && (
              <p id={`${fieldId("category")}-error`} className="field-error">
                {errors.category}
              </p>
            )}
          </div>

          <div className={`field ${errors.subject ? "field--invalid" : ""}`}>
            <label htmlFor={fieldId("subject")}>
              Subject <span aria-hidden="true">*</span>
            </label>
            <input
              id={fieldId("subject")}
              className="input"
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="A short heading for the concern"
              aria-invalid={errors.subject !== undefined}
              aria-describedby={errors.subject ? `${fieldId("subject")}-error` : undefined}
            />
            {errors.subject && (
              <p id={`${fieldId("subject")}-error`} className="field-error">
                {errors.subject}
              </p>
            )}
          </div>

          <div className={`field ${errors.message ? "field--invalid" : ""}`}>
            <label htmlFor={fieldId("message")}>
              Message <span aria-hidden="true">*</span>
            </label>
            <textarea
              id={fieldId("message")}
              className="textarea"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Describe what happened, when, and what you need"
              aria-invalid={errors.message !== undefined}
              aria-describedby={errors.message ? `${fieldId("message")}-error` : undefined}
            />
            {errors.message && (
              <p id={`${fieldId("message")}-error`} className="field-error">
                {errors.message}
              </p>
            )}
          </div>

          <div className={`field ${errors.contactName ? "field--invalid" : ""}`}>
            <label htmlFor={fieldId("contactName")}>
              Your name <span aria-hidden="true">*</span>
            </label>
            <input
              id={fieldId("contactName")}
              className="input"
              type="text"
              autoComplete="name"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              aria-invalid={errors.contactName !== undefined}
              aria-describedby={errors.contactName ? `${fieldId("contactName")}-error` : undefined}
            />
            {errors.contactName && (
              <p id={`${fieldId("contactName")}-error`} className="field-error">
                {errors.contactName}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="grievance-contact-phone">Phone — optional</label>
            <input
              id="grievance-contact-phone"
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              placeholder="+91 …"
            />
          </div>

          <div className={`field ${styles.consent} ${errors.consent ? "field--invalid" : ""}`}>
            <label className={styles.consentLabel}>
              <input
                id={fieldId("consent")}
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I understand this is a demo form — nothing is sent to the school.
            </label>
            {errors.consent && (
              <p id={`${fieldId("consent")}-error`} className="field-error">
                {errors.consent}
              </p>
            )}
          </div>

          <div className={styles.actions}>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit grievance"}
            </Button>
            <p className={styles.actionNote}>The office responds on school days within 3 working days.</p>
          </div>
        </form>
      )}

      <section className={`panel ${styles.tracker}`} aria-labelledby="track-heading">
        <p className="section-label">Track a reference</p>
        <h2 id="track-heading" className={styles.trackerTitle}>
          Check a grievance you already raised
        </h2>
        <p className={styles.trackerNote}>
          Enter the reference from your submission to see its status and the office&apos;s responses.
        </p>
        <form className={styles.trackerForm} onSubmit={handleTrack} noValidate>
          <div className={styles.trackerInputWrap}>
            <label htmlFor="grievance-track-ref" className="sr-only">
              Grievance reference
            </label>
            <input
              id="grievance-track-ref"
              className="input num"
              type="text"
              value={trackRef}
              onChange={(event) => {
                setTrackRef(event.target.value);
                setTrackedMissing(false);
              }}
              placeholder="GRV-2026-0107"
              aria-describedby={trackedMissing ? "grievance-track-error" : undefined}
              aria-invalid={trackedMissing}
            />
            {trackedMissing && (
              <p id="grievance-track-error" className="field-error">
                No grievance found for that reference — check the number and try again.
              </p>
            )}
          </div>
          <Button variant="quiet" type="submit" disabled={tracking}>
            {tracking ? "Checking…" : "Track"}
          </Button>
        </form>

        {tracked !== null && (
          <div className={styles.tracked}>
            <div className={styles.recordHead}>
              <span className={`num ${styles.trackedRef}`}>{tracked.ref}</span>
              <StatusBadge tone={STATUS_TONE[tracked.status]}>{tracked.status}</StatusBadge>
            </div>
            <p className={styles.trackedSubject}>{tracked.subject}</p>
            <ResponseThread events={tracked.thread} />
          </div>
        )}
      </section>
    </div>
  );
}
