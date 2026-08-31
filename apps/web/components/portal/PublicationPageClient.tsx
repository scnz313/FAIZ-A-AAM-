"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ResultTable } from "@/components/portal/ResultTable";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import type { Term } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { academicsService } from "@/modules/services/academics";
import type { Publication, StudentResultSnapshot } from "@/modules/services/academics";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "@/app/portal/results/[publicationRef]/page.module.css";

export function PublicationPageClient({ publicationRef, initialPublication }: { publicationRef: string; initialPublication?: Publication | null }) {
  const { activeStudent } = useFamilyContext();
  const supabaseMode = clientAdapterMode() === "supabase";
  const [publication, setPublication] = useState<Publication | null | undefined>(
    initialPublication === null && !supabaseMode ? undefined : initialPublication,
  );
  const [snapshot, setSnapshot] = useState<StudentResultSnapshot | null | undefined>(undefined);
  const studentId = activeStudent?.student.ref ?? null;
  const academicYearId = activeStudent?.academicYear.id ?? null;
  useEffect(() => { let cancelled = false; if (supabaseMode && initialPublication !== undefined) { setPublication(initialPublication); return () => { cancelled = true; }; } void academicsService.getPublication(publicationRef).then((next) => { if (!cancelled) setPublication(next); }).catch(() => { if (!cancelled) setPublication(null); }); return () => { cancelled = true; }; }, [initialPublication, publicationRef, supabaseMode]);
  useEffect(() => { if (studentId === null || academicYearId === null) return; let cancelled = false; setSnapshot(undefined); void academicsService.getStudentResultSnapshot(studentId, academicYearId).then((next) => { if (!cancelled) setSnapshot(next); }).catch(() => { if (!cancelled) setSnapshot(null); }); return () => { cancelled = true; }; }, [studentId, academicYearId]);
  if (publication === undefined || snapshot === undefined) return <div className={styles.page}><p className="eyebrow">Portal · Results</p><h1 className={styles.title}>Released report</h1><p className={styles.notFoundText}>Loading report…</p></div>;
  if (publication === null) return <div className={styles.page}><Link prefetch={false} className="link-arrow" href="/portal/results">← Results</Link><h1 className={styles.title}>Report not found</h1><p className={styles.notFoundText}>No released report carries the reference <span className="num">{publicationRef}</span>.</p></div>;
  const term: Term = { id: `release-${publication.ref}`, label: publication.term, publicationStatus: publication.status, publishedAtIso: publication.publishedAtIso, version: publication.version };
  const marks = snapshot?.terms[publication.term] ?? [];
  return <div className={styles.page}><Link prefetch={false} className="link-arrow" href="/portal/results">← Results</Link><header><p className="eyebrow">Portal · Results</p><h1 className={styles.title}>{publication.term} · released report</h1><p className={styles.metaLine}><span className="num">{publication.ref}</span><span> · Released {formatKolkata(publication.publishedAtIso, { format: "day" })}</span><span> · v{publication.version}</span></p>{publication.correctionNote ? <p className={styles.correctionNote}>{publication.correctionNote}</p> : null}{clientAdapterMode() !== "supabase" ? <p className={styles.demoLine}><span className="demo-badge">Demo data</span> {ACADEMICS_DEMO_NOTE}</p> : null}</header>{snapshot === null || marks.length === 0 ? <div className="workspace-state"><p className="workspace-state-title">No released snapshot for this child</p><p className="workspace-state-note">The report is private to the active linked child and is available only when its release manifest includes that snapshot.</p></div> : <ResultTable term={term} marks={marks} />}</div>;
}
