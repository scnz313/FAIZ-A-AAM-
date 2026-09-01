"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { identityService } from "@/modules/services/identity";

import styles from "./LinkChildForm.module.css";

type FieldErrors = {
  guardianName?: string;
  childName?: string;
  childDateOfBirth?: string;
  relation?: string;
};

const FIELD_IDS: ReadonlyArray<keyof FieldErrors> = ["guardianName", "childName", "childDateOfBirth", "relation"];

const RELATIONS: ReadonlyArray<string> = ["Father", "Mother", "Legal guardian", "Other"];

function fieldId(field: keyof FieldErrors): string {
  return `link-child-${field}`;
}

/**
 * Request to link another child to this guardian account. The form collects
 * the child's name and date of birth — NOT a student/admission reference.
 * The school office verifies the request against school records before the
 * child appears in the portal. This eliminates student-reference activation:
 * a reference number alone never activates portal access.
 */
export default function LinkChildForm() {
  const [guardianName, setGuardianName] = useState("Firdous Ahmad");
  const [childName, setChildName] = useState("");
  const [childDateOfBirth, setChildDateOfBirth] = useState("");
  const [relation, setRelation] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [linkRef, setLinkRef] = useState<string | null>(null);
  const successRef = useRef<HTMLElement>(null);

  /* Move focus to the pending-request panel so it is announced and visible. */
  useEffect(() => {
    if (linkRef !== null) successRef.current?.focus();
  }, [linkRef]);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (guardianName.trim() === "") next.guardianName = "Enter the guardian name on the account.";
    if (childName.trim().length < 2) next.childName = "Enter the child's full name.";
    if (childDateOfBirth.trim() === "") next.childDateOfBirth = "Enter the child's date of birth.";
    if (relation === "") next.relation = "Choose the guardian relation to the child.";
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
      const { ref } = await identityService.requestLink(
        guardianName.trim(),
        `${childName.trim()}|DOB:${childDateOfBirth}`,
        relation,
      );
      setLinkRef(ref);
    } finally {
      setSubmitting(false);
    }
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
          : "Link-child form — all fields are required."}
      </p>

      <form className={`panel ${styles.form}`} onSubmit={handleSubmit} noValidate>
        <p className={styles.formNote}>
          Linking requires the school to verify the request — a second child appears in the portal only after the
          office approves the link. Provide the child&apos;s name and date of birth; the school matches them to
          the correct student record.
        </p>

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

        <div className={`field ${errors.childName ? "field--invalid" : ""}`}>
          <label htmlFor={fieldId("childName")}>
            Child full name <span aria-hidden="true">*</span>
          </label>
          <input
            id={fieldId("childName")}
            className="input"
            type="text"
            autoComplete="off"
            value={childName}
            onChange={(event) => setChildName(event.target.value)}
            placeholder="e.g. Zoya Khan"
            aria-invalid={errors.childName !== undefined}
            aria-describedby={
              errors.childName
                ? `${fieldId("childName")}-error`
                : `${fieldId("childName")}-help`
            }
          />
          <p id={`${fieldId("childName")}-help`} className="field-help">
            The school office matches this name to the student record. A student or admission reference
            number is not accepted — verification is by name and date of birth only.
          </p>
          {errors.childName && (
            <p id={`${fieldId("childName")}-error`} className="field-error">
              {errors.childName}
            </p>
          )}
        </div>

        <div className={`field ${errors.childDateOfBirth ? "field--invalid" : ""}`}>
          <label htmlFor={fieldId("childDateOfBirth")}>
            Child date of birth <span aria-hidden="true">*</span>
          </label>
          <input
            id={fieldId("childDateOfBirth")}
            className="input"
            type="date"
            value={childDateOfBirth}
            onChange={(event) => setChildDateOfBirth(event.target.value)}
            aria-invalid={errors.childDateOfBirth !== undefined}
            aria-describedby={errors.childDateOfBirth ? `${fieldId("childDateOfBirth")}-error` : undefined}
          />
          {errors.childDateOfBirth && (
            <p id={`${fieldId("childDateOfBirth")}-error`} className="field-error">
              {errors.childDateOfBirth}
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
