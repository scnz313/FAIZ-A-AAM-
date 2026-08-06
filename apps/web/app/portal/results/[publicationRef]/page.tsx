"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { ResultTable } from "@/components/portal/ResultTable";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import type { Term } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { academicsService } from "@/modules/services/academics";
import type { Publication, StudentResultSnapshot } from "@/modules/services/academics";

import styles from "./page.module.css";

function PublicationNotFound({ reference }: { reference: string }) {
  return (
    <div className={styles.page}>
      <a className="link-arrow" href="/portal/results">
        ← Results
      </a>
      <h1 className={styles.title}>Publication not found</h1>
      <p className={styles.notFoundText}>
        No published report carries the reference <span className="num">{reference}</span>. It may have been
        superseded, or the link is incorrect.
      </p>
      <a className="link-arrow" href="/portal/results">
        Back to all results →
      </a>
    </div>
  );
}

/**
 * Published-report detail — reads the publication through the academics
 * service so a report published in this demo session (including a fresh
 * correction version) opens here directly. Marks come from the published
 * per-student snapshot for the ACTIVE child, never from a term fixture.
 */
export default function PublicationPage() {
  const params = useParams<{ publicationRef: string }>();
  const publicationRef = params.publicationRef;
  const { activeStudent } = useFamilyContext();
  const [publication, setPublication] = useState<Publication | null | undefined>(undefined);
  /** The active child's published snapshot; undefined while loading. */
  const [snapshot, setSnapshot] = useState<StudentResultSnapshot | null | undefined>(undefined);
  const studentId = activeStudent?.student.id ?? null;
  const academicYearId = activeStudent?.academicYear.id ?? null;

  useEffect(() => {
    let cancelled = false;
    void academicsService.getPublication(publicationRef).then((next) => {
      if (!cancelled) setPublication(next);
    });
    return () => {
      cancelled = true;
    };
  }, [publicationRef]);

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

  useEffect(() => {
    if (publication) document.title = `${publication.term} results · Portal`;
  }, [publication]);

  if (publication === undefined || snapshot === undefined) {
    return (
      <div className={styles.page}>
        <p className="eyebrow">Portal · Results</p>
        <h1 className={styles.title}>Published report</h1>
        <p className={styles.notFoundText}>Loading publication…</p>
      </div>
    );
  }
  if (publication === null) return <PublicationNotFound reference={publicationRef} />;

  const childName = activeStudent?.student.displayName ?? "this child";
  const marks = snapshot?.terms[publication.term] ?? [];
  const withdrawnNotice = publication.withdrawnAtIso ? (
    <p className={styles.withdrawnNote}>
      Withdrawn {formatKolkata(publication.withdrawnAtIso, { format: "day" })} —{" "}
      {publication.withdrawalReason ?? "no reason recorded"}. This report is no longer live; the published record
      stays on file.
    </p>
  ) : null;

  if (snapshot === null) {
    return (
      <div className={styles.page}>
        <a className="link-arrow" href="/portal/results">
          ← Results
        </a>
        <header>
          <p className="eyebrow">Portal · Results</p>
          <h1 className={styles.title}>
            {publication.term} · published report
          </h1>
          <p className={styles.metaLine}>
            <span className="num">{publication.ref}</span>
            <span>· Published {formatKolkata(publication.publishedAtIso, { format: "day" })}</span>
            <span>· v{publication.version}</span>
          </p>
          {withdrawnNotice}
        </header>
        <div className="workspace-state">
          <p className="workspace-state-title">No published report for this child</p>
          <p className="workspace-state-note">
            No published report exists yet for {childName} in this academic year. Once the examination, moderation,
            and publication are complete, the report appears here exactly as published.
          </p>
        </div>
      </div>
    );
  }

  // The published report as of this publication — the table reads the term
  // metadata, so build it from the publication record itself. The version is
  // passed as v1 of the rendered snapshot: the meta line above carries the
  // publication's version and correction note, so the table's generic
  // correction banner is not duplicated.
  const term: Term = {
    id: `publication-${publication.ref}`,
    label: publication.term,
    publicationStatus: publication.status,
    publishedAtIso: publication.publishedAtIso,
    version: 1,
  };

  return (
    <div className={styles.page}>
      <a className="link-arrow" href="/portal/results">
        ← Results
      </a>

      <header>
        <p className="eyebrow">Portal · Results</p>
        <h1 className={styles.title}>
          {publication.term} · published report
        </h1>
        <p className={styles.metaLine}>
          <span className="num">{publication.ref}</span>
          <span>· Published {formatKolkata(publication.publishedAtIso, { format: "day" })}</span>
          <span>· v{publication.version}</span>
        </p>
        {publication.correctionNote ? <p className={styles.correctionNote}>{publication.correctionNote}</p> : null}
        {withdrawnNotice}
        <p className={styles.demoLine}>
          <span className="demo-badge">Demo data</span> {ACADEMICS_DEMO_NOTE}
        </p>
      </header>

      {marks.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No report for {publication.term}</p>
          <p className="workspace-state-note">
            {childName} has no published {publication.term} rows in the snapshot yet. Check back after the next
            publication.
          </p>
        </div>
      ) : (
        <ResultTable term={term} marks={marks} />
      )}

      <p className={styles.versionNote}>
        Published results are versioned; corrections never silently rewrite history.
      </p>
    </div>
  );
}
