"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { identityService } from "@/modules/services/identity";

import styles from "./LinkChildForm.module.css";

type FieldErrors = {
  guardianName?: string;
  childAdmissionRef?: string;
  relation?: string;
};

const FIELD_IDS: ReadonlyArray<keyof FieldErrors> = ["guardianName", "childAdmissionRef", "relation"];

const RELATIONS: ReadonlyArray<string> = ["Father", "Mother", "Legal guardian", "Other"];

function fieldId(field: keyof FieldErrors): string {
  return `link-child-${field}`;
}

/**
 * Request to link another child to this guardian account. Submits through the
 * identity service, which records a pending link (LR reference) in the demo
 * session store. The school office verifies the request before the child
 * appears in the portal. Demo only — nothing is sent anywhere.
 */
export default function LinkChildForm() {
  const [guardianName, setGuardianName] = useState("Firdous Ahmad");
  const [childAdmissionRef, setChildAdmissionRef] = useState("");
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
    if (childAdmissionRef.trim().length < 6) {
      next.childAdmissionRef = "Enter the child's admission reference — at least 6 characters.";
    }
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
      const { ref } = await identityService.requestLink(guardianName.trim(), childAdmissionRef.trim(), relation);
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
          The school office will verify this request. <span className="demo-badge">demo</span> Once approved, the
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
          office approves the link.
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

        <div className={`field ${errors.childAdmissionRef ? "field--invalid" : ""}`}>
          <label htmlFor={fieldId("childAdmissionRef")}>
            Child admission reference <span aria-hidden="true">*</span>
          </label>
          <input
            id={fieldId("childAdmissionRef")}
            className="input num"
            type="text"
            value={childAdmissionRef}
            onChange={(event) => setChildAdmissionRef(event.target.value)}
            placeholder="ADM-2026-0042"
            aria-invalid={errors.childAdmissionRef !== undefined}
            aria-describedby={
              errors.childAdmissionRef
                ? `${fieldId("childAdmissionRef")}-error`
                : `${fieldId("childAdmissionRef")}-help`
            }
          />
          <p id={`${fieldId("childAdmissionRef")}-help`} className="field-help">
            Found on the child&apos;s admission letter, e.g. ADM-2026-0042. Demo: the school record reference
            works too — try STU-2026-0903 (Zoya Khan).
          </p>
          {errors.childAdmissionRef && (
            <p id={`${fieldId("childAdmissionRef")}-error`} className="field-error">
              {errors.childAdmissionRef}
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
          <p className={styles.actionNote}>
            Demo — the request is recorded in this browser session only; nothing is sent to the school.
          </p>
        </div>
      </form>
    </div>
  );
}
