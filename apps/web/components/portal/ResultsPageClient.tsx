"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { ResultTable } from "@/components/portal/ResultTable";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import type { Term } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { academicsService } from "@/modules/services/academics";
import type { Publication, StudentResultSnapshot } from "@/modules/services/academics";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "@/app/portal/results/page.module.css";

export function ResultsPageClient({ initialPublications = null }: { initialPublications?: Publication[] | null }) {
  return <Suspense fallback={<div className={styles.body}><p className="eyebrow">Portal · Results</p><h1 className={styles.title}>Results</h1><p className={styles.intro}>Loading results…</p></div>}><ResultsBody initialPublications={initialPublications} /></Suspense>;
}

function ResultsBody({ initialPublications }: { initialPublications?: Publication[] | null }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("term");
  const { activeStudent, generation } = useFamilyContext();
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [publications, setPublications] = useState<Publication[] | null>(initialPublications ?? null);
  const [snapshot, setSnapshot] = useState<StudentResultSnapshot | null | undefined>(undefined);
  const studentId = activeStudent?.student.ref ?? null;
  const academicYearId = activeStudent?.academicYear.id ?? null;

  /* Publications reload on child switch (generation bump clears the stale
     server-prop list and fetches the new child's publications). */
  useEffect(() => {
    let cancelled = false;
    setPublications(null);
    void Promise.all([academicsService.getTerms(), academicsService.getPublications()]).then(([nextTerms, nextPublications]) => {
      if (cancelled) return;
      setTerms(nextTerms);
      setPublications(nextPublications);
    }).catch(() => { if (!cancelled) { setTerms([]); setPublications([]); } });
    return () => { cancelled = true; };
  }, [generation]);

  useEffect(() => {
    if (studentId === null || academicYearId === null) return;
    let cancelled = false;
    setSnapshot(undefined);
    void academicsService.getStudentResultSnapshot(studentId, academicYearId).then((next) => { if (!cancelled) setSnapshot(next); }).catch(() => { if (!cancelled) setSnapshot(null); });
    return () => { cancelled = true; };
  }, [studentId, academicYearId]);

  if (terms === null || publications === null || snapshot === undefined) return <div className={styles.body}><header><p className="eyebrow">Portal · Results</p><h1 className={styles.title}>Results</h1><p className={styles.intro}>Loading results…</p></header><div className={styles.loadingBlock} aria-busy="true"><span className="skeleton-rule" aria-hidden="true" /><span className="skeleton-bar" style={{ width: "46%" }} aria-hidden="true" /><span className="skeleton-bar" style={{ width: "82%" }} aria-hidden="true" /></div></div>;
  const term = terms.find((item) => item.id === requested) ?? terms.find((item) => item.id === "term-2") ?? terms[0];
  if (!term) return <div className={styles.body}><p className="workspace-state-title">No published report</p><p className="workspace-state-note">There are no released result reports for this account.</p></div>;
  const marks = snapshot?.terms[term.label] ?? [];
  const childName = activeStudent?.student.displayName ?? "this child";
  return <div className={styles.body}>
    <header><p className="eyebrow">Portal · Results</p><h1 className={styles.title}>Results</h1><p className={styles.intro}>Only released student report snapshots are shown; corrections create a superseding release.</p><ActiveChildLine /></header>
    <div className="tabs" role="group" aria-label="Select a term">{terms.map((item) => <Link prefetch={false} key={item.id} href={`/portal/results?term=${item.id}`} className={`${styles.tabLink}${item.id === term.id ? ` ${styles.tabLinkActive}` : ""}`} aria-current={item.id === term.id ? "true" : undefined}>{item.label}</Link>)}</div>
    {term.publicationStatus === "not-published" ? <div className="workspace-state"><p className="workspace-state-title">Not yet released</p><p className="workspace-state-note">Results appear here only after the school releases an immutable report manifest.</p></div> : snapshot === null ? <div className="workspace-state"><p className="workspace-state-title">No released report for this child</p><p className="workspace-state-note">No released snapshot exists for {childName} in this academic year.</p></div> : marks.length === 0 ? <div className="workspace-state"><p className="workspace-state-title">No report for {term.label}</p><p className="workspace-state-note">The released manifest contains no marks for this term.</p></div> : <ResultTable term={term} marks={marks} />}
    <section aria-labelledby="publications-heading"><p className="section-label" id="publications-heading">Released reports</p><ul className={styles.publicationList}>{publications.map((publication) => <li key={publication.ref} className={styles.publicationRow}><Link prefetch={false} className="link-arrow" href={`/portal/results/${publication.ref}`}>{publication.term} · released report →</Link><span className={styles.publicationMeta}><span className="num">{publication.ref}</span><span> · {formatKolkata(publication.publishedAtIso, { format: "day" })}</span><span> · v{publication.version}</span></span></li>)}</ul></section>
    {clientAdapterMode() !== "supabase" ? <p className={styles.demoNote}><span className="demo-badge">Demo data</span><span>{ACADEMICS_DEMO_NOTE} Supabase mode reads the released report manifest and active-child snapshot.</span></p> : null}
  </div>;
}
