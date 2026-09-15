"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ResultTable } from "@/components/portal/ResultTable";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import Button from "@/components/ui/Button";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import type { Term } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { academicsService } from "@/modules/services/academics";
import type { Publication, StudentResultSnapshot } from "@/modules/services/academics";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  documentsService,
  generatedReportCardReleaseReference,
  isDocumentMetadataDownloadable,
} from "@/modules/services/documents";

import styles from "@/app/portal/results/[publicationRef]/page.module.css";

/**
 * One released report for the ACTIVE child. The server-seeded publication is
 * trusted for the first paint; after any child switch (generation bump) the
 * publication is re-resolved through the active-child service so a reference
 * that belongs to the previous child can never be shown beside the new
 * child's marks.
 */
export function PublicationPageClient({
  publicationRef,
  initialPublication,
}: {
  publicationRef: string;
  initialPublication?: Publication | null;
}) {
  const { activeStudent, context, generation } = useFamilyContext();
  const supabaseMode = clientAdapterMode() === "supabase";
  const [publication, setPublication] = useState<Publication | null | undefined>(
    initialPublication === null && !supabaseMode ? undefined : initialPublication,
  );
  const [snapshot, setSnapshot] = useState<StudentResultSnapshot | null | undefined>(undefined);
  const [reportCardDocument, setReportCardDocument] = useState<{ reference: string; filename: string } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [snapshotError, setSnapshotError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const studentId = activeStudent?.student.ref ?? null;
  const academicYearId = activeStudent?.academicYear.id ?? null;

  useEffect(() => {
    let cancelled = false;
    /* The server prop is only authoritative for the initial child. After a
       switch, re-read through the service (scoped to the active child) so a
       stale release cannot be paired with the new child's snapshot. */
    if (supabaseMode && generation === 0 && initialPublication !== undefined) {
      setPublication(initialPublication);
      return () => {
        cancelled = true;
      };
    }
    setPublication(undefined);
    setLoadError(false);
    void academicsService
      .getPublication(publicationRef)
      .then((next) => {
        if (!cancelled) setPublication(next);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialPublication, publicationRef, supabaseMode, reloadToken, generation]);

  useEffect(() => {
    if (studentId === null || academicYearId === null) return;
    let cancelled = false;
    setSnapshot(undefined);
    setSnapshotError(false);
    void academicsService
      .getStudentResultSnapshot(studentId, academicYearId)
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot(null);
          setSnapshotError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, academicYearId, reloadToken]);

  /* The generated report card is a private document owned by the student.
     The report page only claims availability when that document is actually
     present for this release and downloadable; otherwise the copy stays
     honest about the PDF not being generated yet. */
  useEffect(() => {
    if (!supabaseMode || publication === null || publication === undefined) {
      setReportCardDocument(null);
      return;
    }
    const accountId = context?.accountId;
    const studentRecordId = activeStudent?.student.id;
    if (accountId === undefined || studentRecordId === undefined) {
      setReportCardDocument(null);
      return;
    }
    let cancelled = false;
    void documentsService
      .listForStudent(accountId, studentRecordId)
      .then((bundle) => {
        if (cancelled) return;
        const match = (bundle.metadata ?? []).find(
          (document) =>
            generatedReportCardReleaseReference(document) === publication.ref &&
            isDocumentMetadataDownloadable(document),
        );
        setReportCardDocument(match ? { reference: match.ref, filename: match.filename } : null);
      })
      .catch(() => {
        if (!cancelled) setReportCardDocument(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStudent, context, publication, supabaseMode]);

  if (loadError || snapshotError) {
    return (
      <div className={styles.page}>
        <Link prefetch={false} className="link-arrow" href="/portal/results">← Results</Link>
        <h1 className={styles.title}>Released report</h1>
        <ErrorPanel title="The report could not be loaded" note="The results service did not respond. The released version is untouched.">
          <Button
            variant="quiet"
            type="button"
            onClick={() => {
              setLoadError(false);
              setSnapshotError(false);
              setReloadToken((token) => token + 1);
            }}
          >
            Try again
          </Button>
        </ErrorPanel>
      </div>
    );
  }

  if (publication === undefined || snapshot === undefined) {
    return (
      <div className={styles.page}>
        <p className="eyebrow">Portal · Results</p>
        <h1 className={styles.title}>Released report</h1>
        <p className={styles.notFoundText} role="status" aria-live="polite">Loading report…</p>
      </div>
    );
  }

  if (publication === null) {
    return (
      <div className={styles.page}>
        <Link prefetch={false} className="link-arrow" href="/portal/results">← Results</Link>
        <h1 className={styles.title}>Report not found</h1>
        <p className={styles.notFoundText}>
          No released report for the active child carries the reference <span className="num">{publicationRef}</span>.
        </p>
      </div>
    );
  }

  const term: Term = {
    id: `release-${publication.ref}`,
    label: publication.term,
    publicationStatus: publication.status,
    publishedAtIso: publication.publishedAtIso ?? undefined,
    version: publication.version,
  };
  const marks = snapshot?.terms[publication.term] ?? [];

  return (
    <div className={styles.page}>
      <Link prefetch={false} className="link-arrow" href="/portal/results">← Results</Link>
      <header>
        <p className="eyebrow">Portal · Results</p>
        <h1 className={styles.title}>{publication.term} · released report</h1>
        <p className={styles.metaLine}>
          <span className="num">{publication.ref}</span>
          {publication.publishedAtIso ? (
            <span> · Released {formatKolkata(publication.publishedAtIso, { format: "day" })}</span>
          ) : null}
          <span> · v{publication.version}</span>
        </p>
        {publication.correctionNote ? <p className={styles.correctionNote}>{publication.correctionNote}</p> : null}
        {!supabaseMode ? (
          <p className={styles.demoLine}>
            <span className="demo-badge">Demo data</span> {ACADEMICS_DEMO_NOTE}
          </p>
        ) : null}
      </header>
      {snapshot === null || marks.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No released snapshot for this child</p>
          <p className="workspace-state-note">
            The report is private to the active linked child and is available only when its release manifest includes that snapshot.
          </p>
        </div>
      ) : (
        <ResultTable term={term} marks={marks} reportCardDocument={reportCardDocument} />
      )}
    </div>
  );
}
