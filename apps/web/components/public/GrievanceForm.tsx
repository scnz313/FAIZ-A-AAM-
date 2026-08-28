"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { supportService } from "@/modules/services/support";
import type { GrievanceCategory } from "@/modules/services/support";

import styles from "./GrievanceForm.module.css";

const CATEGORIES: ReadonlyArray<GrievanceCategory> = ["Fees", "Results", "Timetable", "Documents", "Other"];

type FieldErrors = {
  category?: string;
  subject?: string;
  message?: string;
  contactName?: string;
  consent?: string;
};

/** Focus order for the error summary — first failing field wins. */
const FIELD_IDS: ReadonlyArray<keyof FieldErrors> = ["category", "subject", "message", "contactName", "consent"];

/**
 * Public grievance entry (§5.2): unauthenticated visitors raise a concern
 * here instead of being sent to /portal/support. Validates client-side,
 * submits through the typed support service, and shows the deterministic
 * reference the school office will use to respond.
 */
export function GrievanceForm() {
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const successRef = useRef<HTMLElement>(null);

  function fieldId(field: string): string {
    return `public-grievance-${field}`;
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (category === "") next.category = "Choose the category that fits your concern.";
    if (subject.trim().length < 5) next.subject = "Enter a short subject — at least 5 characters.";
    if (message.trim().length < 20) next.message = "Describe your concern — at least 20 characters.";
    if (contactName.trim() === "") next.contactName = "Enter your name so the office can reach you.";
    if (!consent) next.consent = "Consent is required before the concern can be accepted.";
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
      const { ref: newRef } = await supportService.submitGrievance({
        category: category as GrievanceCategory,
        subject: subject.trim(),
        message: message.trim(),
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim() === "" ? undefined : contactPhone.trim(),
      });
      setRef(newRef);
      /* Move keyboard and screen-reader focus to the success panel. */
      requestAnimationFrame(() => successRef.current?.focus());
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
    setRef(null);
  }

  if (ref !== null) {
    return (
      <section
        ref={successRef}
        tabIndex={-1}
        className={`panel ${styles.success}`}
        role="status"
        aria-live="polite"
      >
        <p className="section-label">Submitted</p>
        <h2 className={styles.successTitle}>Concern received — reference {ref}</h2>
        <p className={styles.successLine}>The school office responds on school days.</p>
        <p className={styles.successNote}>
          Keep this reference: once your family portal account is linked, the same reference can be
          tracked under Portal → Support.
        </p>
        <Button variant="quiet" onClick={reset}>
          Submit another
        </Button>
      </section>
    );
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className={`panel ${styles.wrap}`}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <p className="sr-only" role="status" aria-live="polite">
          {hasErrors
            ? "The form has errors. Please review the marked fields before submitting."
            : "Raise a concern form."}
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

        <div className={styles.contactRow}>
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
            <label htmlFor={fieldId("contactPhone")}>Phone — optional</label>
            <input
              id={fieldId("contactPhone")}
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              placeholder="+91 …"
            />
          </div>
        </div>

        <div className={`field ${errors.consent ? "field--invalid" : ""}`}>
          <label className={styles.consentLabel}>
            <input
              id={fieldId("consent")}
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              aria-invalid={errors.consent !== undefined}
              aria-describedby={errors.consent ? `${fieldId("consent")}-error` : undefined}
            />
            The school will use these details to respond to this concern.
          </label>
          {errors.consent && (
            <p id={`${fieldId("consent")}-error`} className="field-error">
              {errors.consent}
            </p>
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit concern"}
          </Button>
          <p className={styles.actionNote}>The office responds on school days.</p>
        </div>
      </form>

      <p className={styles.demoNote}>
        <span className="demo-badge">Demo</span>
        <span>Nothing is sent — this concern is stored in this browser session only.</span>
      </p>
    </div>
  );
}
