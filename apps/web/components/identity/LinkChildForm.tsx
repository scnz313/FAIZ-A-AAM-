"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import { identityService } from "@/modules/services/identity";

import { PENDING_LINK_REQUESTS_REFRESH_EVENT } from "./pending-link-events";
import styles from "./LinkChildForm.module.css";

type FieldErrors = {
  guardianName?: string;
  studentReference?: string;
  relation?: string;
};

const FIELD_IDS: ReadonlyArray<keyof FieldErrors> = ["guardianName", "studentReference", "relation"];

const RELATIONS: ReadonlyArray<string> = ["Father", "Mother", "Legal guardian", "Other"];

function fieldId(field: keyof FieldErrors): string {
  return `link-child-${field}`;
}

/**
 * Request to link another child to this guardian account. The form collects
 * the student reference the school office issues plus the guardian relation;
 * it never activates anything by itself. The office verifies the request
 * against school records, and only an approved link makes the child appear in
 * the portal. A reference number alone never activates portal access.
 */
export default function LinkChildForm() {
  const [guardianName, setGuardianName] = useState("");
  const [studentReference, setStudentReference] = useState("");
  const [relation, setRelation] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [linkRef, setLinkRef] = useState<string | null>(null);
  const successRef = useRef<HTMLElement>(null);

  /* Move focus to the pending-request panel so it is announced and visible. */
  useEffect(() => {
    if (linkRef !== null) successRef.current?.focus();
  }, [linkRef]);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (guardianName.trim() === "") next.guardianName = "Enter the guardian name on the account.";
    if (studentReference.trim().length < 3) next.studentReference = "Enter the student reference from the school office.";
    if (relation === "") next.relation = "Choose the guardian relation to the child.";
    return next;
  }

  async function submitLinkRequest() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { ref } = await identityService.requestLink(
        guardianName.trim(),
        studentReference.trim().toUpperCase(),
        relation,
      );
      setLinkRef(ref);
      /* The pending-requests panel is a sibling; it must re-read so the new
         request appears immediately instead of a stale empty list. */
      window.dispatchEvent(new Event(PENDING_LINK_REQUESTS_REFRESH_EVENT));
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The link request could not be recorded.");
    } finally {
      setSubmitting(false);
    }
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
    await submitLinkRequest();
  }

  if (linkRef !== null) {
    return (
      <section ref={successRef} tabIndex={-1} className={`panel ${styles.success}`} role="status" aria-live="polite">
        <p className="section-label">Request recorded</p>
        <p className={styles.successTitle}>Link request pending</p>
        <p className={styles.successLine}>
          Reference <strong className="num">{linkRef}</strong>
        </p>
        <p className={styles.successNote}>
          The school office will verify this request against school records. Once approved, the
          child appears under Linked children on the profile.
        </p>
        <div className={styles.successActions}>
          <Button href="/portal/profile" variant="quiet">
            Back to profile →
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.wrap}>
      <p className="sr-only" role="status" aria-live="polite">
        {Object.keys(errors).length > 0
          ? "The form has errors. Please review the marked fields before submitting."
          : "Link-child form · all fields are required."}
      </p>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <p className={styles.formNote}>
          Linking requires the school to verify the request · a second child appears in the portal only after the
          office approves the link. Enter the student reference the office gives you; verification is by school
          record, never by name or date of birth alone.
        </p>

        {submitError !== null && (
          <ErrorPanel title="The link request was not recorded" note={`${submitError} Your entries are preserved.`}>
            <Button variant="quiet" type="button" onClick={() => void submitLinkRequest()} disabled={submitting}>
              Try again
            </Button>
          </ErrorPanel>
        )}

        <div className={`field ${errors.guardianName ? "field--invalid" : ""}`}>
          <label htmlFor={fieldId("guardianName")}>
            Guardian name <span aria-hidden="true">*</span>
          </label>
          <input
            id={fieldId("guardianName")}
            className="input"
            type="text"
            autoComplete="name"
            value={guardianName}
            onChange={(event) => setGuardianName(event.target.value)}
            aria-invalid={errors.guardianName !== undefined}
            aria-describedby={errors.guardianName ? `${fieldId("guardianName")}-error` : undefined}
          />
          {errors.guardianName && (
            <p id={`${fieldId("guardianName")}-error`} className="field-error">
              {errors.guardianName}
            </p>
          )}
        </div>

        <div className={`field ${errors.studentReference ? "field--invalid" : ""}`}>
          <label htmlFor={fieldId("studentReference")}>
            Student reference <span aria-hidden="true">*</span>
          </label>
          <input
            id={fieldId("studentReference")}
            className="input num"
            type="text"
            autoComplete="off"
            value={studentReference}
            onChange={(event) => setStudentReference(event.target.value)}
            placeholder="e.g. STU-2026-D63E94"
            aria-invalid={errors.studentReference !== undefined}
            aria-describedby={
              errors.studentReference
                ? `${fieldId("studentReference")}-error`
                : `${fieldId("studentReference")}-help`
            }
          />
          <p id={`${fieldId("studentReference")}-help`} className="field-help">
            Ask the school office for the student reference on the child&apos;s record. The request stays
            pending until the office verifies you as guardian; the reference alone never activates access.
          </p>
          {errors.studentReference && (
            <p id={`${fieldId("studentReference")}-error`} className="field-error">
              {errors.studentReference}
            </p>
          )}
        </div>

        <div className={`field ${errors.relation ? "field--invalid" : ""}`}>
          <label htmlFor={fieldId("relation")}>
            Relation to the child <span aria-hidden="true">*</span>
          </label>
          <select
            id={fieldId("relation")}
            className="select"
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
            aria-invalid={errors.relation !== undefined}
            aria-describedby={errors.relation ? `${fieldId("relation")}-error` : undefined}
          >
            <option value="">Choose a relation</option>
            {RELATIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          {errors.relation && (
            <p id={`${fieldId("relation")}-error`} className="field-error">
              {errors.relation}
            </p>
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? "Recording request…" : "Request to link"}
          </Button>
        </div>
      </form>
    </div>
  );
}
