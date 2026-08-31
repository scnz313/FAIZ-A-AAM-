"use client";

import { useState } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";

import styles from "./page.module.css";

type StateKey = "loading" | "empty" | "error" | "denied" | "stale" | "processing" | "retry" | "success";

const STATES: ReadonlyArray<{ key: StateKey; label: string; context: string }> = [
  { key: "loading", label: "Loading", context: "A record is being requested from a domain service." },
  { key: "empty", label: "Empty", context: "The service responded successfully, but there is nothing to show." },
  { key: "error", label: "Recoverable error", context: "A request failed and the user has a safe next step." },
  { key: "denied", label: "Permission denied", context: "The server will not expose this record to the current role." },
  { key: "stale", label: "Stale draft", context: "A saved draft needs review before it can be trusted." },
  { key: "processing", label: "Processing", context: "A consequential action is in flight and must not be duplicated." },
  { key: "retry", label: "Retry", context: "The previous attempt can be checked again without creating a duplicate." },
  { key: "success", label: "Success", context: "The action completed and has a durable next step." },
];

export default function StateGallery() {
  const [selected, setSelected] = useState<StateKey>("loading");
  const state = STATES.find((item) => item.key === selected) ?? STATES[0]!;

  return (
    <section className={styles.gallery} aria-labelledby="state-gallery-title">
      <div className={styles.galleryHead}>
        <div>
          <p className="section-label">State preview</p>
          <h2 id="state-gallery-title" className={styles.galleryTitle}>
            Choose a state to inspect
          </h2>
        </div>
        <span className="demo-badge">No data writes</span>
      </div>

      <div className={styles.selectorRow}>
        <label htmlFor="state-preview-select">State</label>
        <select
          id="state-preview-select"
          className="select"
          value={selected}
          onChange={(event) => setSelected(event.target.value as StateKey)}
        >
          {STATES.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <p className="field-help">Each example is a static UI state. Use the linked product screens for real demo journeys.</p>
      </div>

      <div className={styles.statePreview} aria-live="polite" aria-busy={selected === "loading" || selected === "processing"}>
        <p className={styles.stateKicker}>{state.context}</p>
        {selected === "loading" ? (
          <div className={styles.stateBody} role="status">
            <span className={styles.loadingMark} aria-hidden="true" />
            <div>
              <h3>Loading your records…</h3>
              <p>We are checking the school service. Keep this page open.</p>
            </div>
          </div>
        ) : null}

        {selected === "empty" ? (
          <div className={styles.stateBody}>
            <div>
              <h3>No notices in this view</h3>
              <p>Try another category or return to all notices. Nothing has been removed.</p>
            </div>
            <Link className="link-arrow" href="/notices">
              View all notices →
            </Link>
          </div>
        ) : null}

        {selected === "error" ? (
          <div className={styles.stateBody} role="alert">
            <div>
              <h3>We couldn’t load that record</h3>
              <p>The demo request did not complete. Your data is unchanged.</p>
            </div>
            <Button variant="primary" onClick={() => setSelected("loading")}>
              Try again
            </Button>
          </div>
        ) : null}

        {selected === "denied" ? (
          <div className={styles.stateBody} role="alert">
            <div>
              <h3>This record is not available to this role</h3>
              <p>Ask the school office to confirm access. The interface does not reveal private student information.</p>
            </div>
            <Link className="link-arrow" href="/access-denied" prefetch={false}>
              See access-denied screen →
            </Link>
          </div>
        ) : null}

        {selected === "stale" ? (
          <div className={`${styles.stateBody} ${styles.stateBodyStacked}`} role="alert">
            <div>
              <h3>This draft may be out of date</h3>
              <p>Values are preserved. Review, keep, save now, or start over — never silently discard the applicant’s work.</p>
            </div>
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => setSelected("success")}>
                Review draft
              </Button>
              <Button variant="quiet" onClick={() => setSelected("loading")}>
                Save now
              </Button>
            </div>
          </div>
        ) : null}

        {selected === "processing" ? (
          <div className={styles.stateBody} role="status">
            <span className={styles.processingMark} aria-hidden="true">…</span>
            <div>
              <h3>Recording your action…</h3>
              <p>Do not submit again. We will show the confirmed result here.</p>
            </div>
          </div>
        ) : null}

        {selected === "retry" ? (
          <div className={styles.stateBody} role="alert">
            <div>
              <h3>Confirmation is taking longer than expected</h3>
              <p>Checking again is safe. The original attempt will not be duplicated.</p>
            </div>
            <Button variant="primary" onClick={() => setSelected("success")}>
              Check status again
            </Button>
          </div>
        ) : null}

        {selected === "success" ? (
          <div className={styles.stateBody} role="status">
            <span className={styles.successMark} aria-hidden="true">✓</span>
            <div>
              <h3>Action complete</h3>
              <p>The updated record is available, with a receipt, reference, timeline, or other durable next step.</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.stateIndex} aria-label="Available state previews">
        {STATES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={selected === item.key ? styles.stateIndexActive : styles.stateIndexButton}
            aria-pressed={selected === item.key}
            onClick={() => setSelected(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
