"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { ResultTable } from "@/components/portal/ResultTable";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import type { Term } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { academicsService } from "@/modules/services/academics";
import type { Publication, StudentResultSnapshot } from "@/modules/services/academics";

import styles from "./page.module.css";

/**
 * Portal results — reads terms and publications through the academics
 * service, so a batch published in the staff workspace appears here in the
 * same demo session. Marks come from the published per-student snapshot
 * for the ACTIVE child (via `useFamilyContext`), never from a term
 * fixture: the snapshot decides what each linked child sees, and a child
 * or term without a snapshot gets the honest not-published/empty state.
 */
function ResultsBody() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("term");
  const { activeStudent } = useFamilyContext();
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [publications, setPublications] = useState<Publication[] | null>(null);
  /** The active child's published snapshot; undefined while loading. */
  const [snapshot, setSnapshot] = useState<StudentResultSnapshot | null | undefined>(undefined);
  const studentId = activeStudent?.student.id ?? null;
  const academicYearId = activeStudent?.academicYear.id ?? null;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([academicsService.getTerms(), academicsService.getPublications()]).then(([nextTerms, nextPublications]) => {
      if (cancelled) return;
      setTerms(nextTerms);
      setPublications(nextPublications);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (studentId === null || academicYearId === null) return;
    let cancelled = false;
    setSnapshot(undefined);
    void academicsService.getStudentResultSnapshot(studentId, academicYearId).then((next) => {
      if (cancelled) return;
      setSnapshot(next);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId, academicYearId]);

  if (terms === null || publications === null || snapshot === undefined) {
    return (
      <div className={styles.body}>
        <header>
          <p className="eyebrow">Portal · Results</p>
          <h1 className={styles.title}>Results</h1>
          <p className={styles.intro}>Loading results…</p>
        </header>
      </div>
    );
  }

  const term: Term = terms.find((item) => item.id === requested) ?? terms.find((item) => item.id === "term-2") ?? terms[0]!;
  const marks = snapshot?.terms[term.label] ?? [];
  const childName = activeStudent?.student.displayName ?? "this child";

  return (
    <div className={styles.body}>
      <header>
        <p className="eyebrow">Portal · Results</p>
        <h1 className={styles.title}>Results</h1>
        <p className={styles.intro}>Only published reports are shown; corrections create a new version.</p>
        <ActiveChildLine />
      </header>

      <div className="tabs" role="group" aria-label="Select a term">
        {terms.map((item) => (
          <a
            key={item.id}
            href={`/portal/results?term=${item.id}`}
            className={`${styles.tabLink}${item.id === term.id ? ` ${styles.tabLinkActive}` : ""}`}
            aria-current={item.id === term.id ? "true" : undefined}
          >
            {item.label}
          </a>
        ))}
      </div>

      {term.publicationStatus === "not-published" ? (
        <div className="workspace-state">
          <p className="workspace-state-title">Not yet published</p>
          <p className="workspace-state-note">
            Results for {term.label} appear here once the examination, moderation, and publication are complete.
            Published reports are never rewritten — corrections release as a new version.
          </p>
        </div>
      ) : snapshot === null ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No published report for this child</p>
          <p className="workspace-state-note">
            No published report exists yet for {childName} in this academic year. Once the examination, moderation,
            and publication are complete, the report appears here exactly as published — never rewritten.
          </p>
        </div>
      ) : marks.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No report for {term.label}</p>
          <p className="workspace-state-note">
            {childName} has no published {term.label} rows in the snapshot yet. Check back after the next publication.
          </p>
        </div>
      ) : (
        <ResultTable term={term} marks={marks} />
      )}

      <section aria-labelledby="publications-heading">
        <p className="section-label" id="publications-heading">
          Publications
        </p>
        <ul className={styles.publicationList}>
          {publications.map((publication) => (
            <li key={publication.ref} className={styles.publicationRow}>
              <a className="link-arrow" href={`/portal/results/${publication.ref}`}>
                {publication.term} · published report →
              </a>
              <span className={styles.publicationMeta}>
                <span className="num">{publication.ref}</span>
                <span>· {formatKolkata(publication.publishedAtIso, { format: "day" })}</span>
                <span>· v{publication.version}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.demoNote}>
        <span className="demo-badge">Demo data</span>
        <span>{ACADEMICS_DEMO_NOTE} The real report arrives with the results backend.</span>
      </p>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <div className={styles.page}>
      <Suspense
        fallback={
          <div className={styles.body}>
            <header>
              <p className="eyebrow">Portal · Results</p>
              <h1 className={styles.title}>Results</h1>
              <p className={styles.intro}>Loading results…</p>
            </header>
          </div>
        }
      >
        <ResultsBody />
      </Suspense>
    </div>
  );
}
