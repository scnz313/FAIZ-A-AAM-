"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import Button from "@/components/ui/Button";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import type { Term } from "@/modules/academics/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { academicsService } from "@/modules/services/academics";
import type { Publication, StudentResultSnapshot } from "@/modules/services/academics";
import { gradeSectionLabel } from "@/modules/services/family-context";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "@/app/portal/results/page.module.css";

export function ResultsPageClient({ initialPublications = null }: { initialPublications?: Publication[] | null }) {
  return <Suspense fallback={<div className={styles.body}><div className="page-head"><div><h1 className={styles.title}>Results</h1><p className="ph-sub">Loading results…</p></div></div></div>}><ResultsBody initialPublications={initialPublications} /></Suspense>;
}

/** Supabase term list derived from the publications read — identical mapping
 *  to the service's `getTerms`, without a duplicate `results.listReleases`. */
function termsFromPublications(publications: Publication[]): Term[] {
  return publications.map((publication) => ({
    id: publication.ref,
    label: publication.term,
    publicationStatus: publication.status,
    publishedAtIso: publication.publishedAtIso ?? undefined,
    version: publication.version,
  }));
}

function ResultsBody({ initialPublications }: { initialPublications?: Publication[] | null }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("term");
  const { activeStudent, generation } = useFamilyContext();
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [publications, setPublications] = useState<Publication[] | null>(initialPublications ?? null);
  const [snapshot, setSnapshot] = useState<StudentResultSnapshot | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [snapshotError, setSnapshotError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const studentId = activeStudent?.student.ref ?? null;
  const academicYearId = activeStudent?.academicYear.id ?? null;

  /* Publications reload on child switch (generation bump clears the stale
     server-prop list and fetches the new child's publications). The Supabase
     path derives the term list from the same publications read, so one
     request replaces the previous `getTerms` + `getPublications` pair. */
  const firstRun = useRef(true);
  useEffect(() => {
    let cancelled = false;
    if (firstRun.current && initialPublications != null) {
      firstRun.current = false;
      setTerms(termsFromPublications(initialPublications));
      setPublications(initialPublications);
      setLoadError(false);
      return;
    }
    firstRun.current = false;
    setPublications(null);
    setLoadError(false);
    const load = clientAdapterMode() === "supabase"
      ? academicsService.getPublications().then((nextPublications) => {
        if (cancelled) return;
        setTerms(termsFromPublications(nextPublications));
        setPublications(nextPublications);
      })
      : Promise.all([academicsService.getTerms(), academicsService.getPublications()]).then(([nextTerms, nextPublications]) => {
        if (cancelled) return;
        setTerms(nextTerms);
        setPublications(nextPublications);
      });
    void load.catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [generation, reloadToken, initialPublications]);

  useEffect(() => {
    if (studentId === null || academicYearId === null) return;
    let cancelled = false;
    setSnapshot(undefined);
    setSnapshotError(false);
    void academicsService.getStudentResultSnapshot(studentId, academicYearId).then((next) => { if (!cancelled) setSnapshot(next); }).catch(() => { if (!cancelled) { setSnapshot(null); setSnapshotError(true); } });
    return () => { cancelled = true; };
  }, [studentId, academicYearId, reloadToken]);

  if (loadError || snapshotError) return (
    <div className={styles.body}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Results</h1>
          <p className="ph-sub">The released results could not be read.</p>
        </div>
      </div>
      <ErrorPanel
        title="Results could not be loaded"
        note="The results service did not respond. No record was changed; the last released version is untouched."
      >
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

  if (terms === null || publications === null || snapshot === undefined) return (
    <div className={styles.body}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Results</h1>
          <p className="ph-sub">Loading results…</p>
        </div>
      </div>
      <div className={styles.loadingBlock} aria-busy="true">
        <span className="skeleton-rule" aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "46%" }} aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "82%" }} aria-hidden="true" />
      </div>
    </div>
  );

  /* Prefer the requested term; otherwise the newest published term; never a
     hardcoded demo term id that does not exist in live releases. */
  const term = terms.find((item) => item.id === requested) ?? terms.find((item) => item.publicationStatus !== "not-published") ?? terms[0];
  if (!term) return (
    <div className={styles.body}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Results</h1>
          <p className="ph-sub">No published report</p>
        </div>
      </div>
      <p className="workspace-state-note">There are no released result reports for this account.</p>
    </div>
  );

  const marks = snapshot?.terms[term.label] ?? [];
  const childName = activeStudent?.student.displayName ?? "this child";
  const childClass = activeStudent ? ` · ${gradeSectionLabel(activeStudent.gradeSection)}` : "";
  const ayLabel = activeStudent?.academicYear.label ?? "";
  const presentMarks = marks.filter((mark) => mark.markStatus === undefined || mark.markStatus === "present");
  const totalObtained = presentMarks.reduce((sum, mark) => sum + (mark.obtained ?? 0), 0);
  const totalMax = presentMarks.reduce((sum, mark) => sum + mark.max, 0);
  const percentage = totalMax === 0 ? 0 : (totalObtained / totalMax) * 100;
  const published = term.publishedAtIso ? formatKolkata(term.publishedAtIso, { format: "day" }) : null;
  const isFinal = term.publicationStatus === "final";

  return (
    <div className={styles.body}>
      {/* V14 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Results</h1>
          <p className="ph-sub">
            Published results for {childName}{childClass}. Corrected results arrive as new versions; nothing is overwritten.
          </p>
          <ActiveChildLine />
        </div>
        {ayLabel ? <span className="chip">{ayLabel}</span> : null}
      </div>

      {/* V14 term tabs */}
      <div className="tabs" role="tablist" aria-label="Terms">
        {terms.map((item) => {
          const notPublished = item.publicationStatus === "not-published";
          return (
            <Link
              prefetch={false}
              key={item.id}
              href={`/portal/results?term=${item.id}`}
              role="tab"
              aria-selected={item.id === term.id}
              className={item.id === term.id ? "on" : undefined}
              aria-disabled={notPublished || undefined}
              tabIndex={notPublished ? -1 : undefined}
              onClick={notPublished ? (event) => event.preventDefault() : undefined}
              style={notPublished ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
            >
              {item.label}
              {notPublished ? <span className="chip" style={{ marginLeft: 4 }}>Awaiting</span> : null}
            </Link>
          );
        })}
      </div>

      {term.publicationStatus === "not-published" ? (
        <div className="workspace-state">
          <p className="workspace-state-title">Not yet released</p>
          <p className="workspace-state-note">Results appear here only after the school releases an immutable report manifest.</p>
        </div>
      ) : snapshot === null ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No released report for this child</p>
          <p className="workspace-state-note">No released snapshot exists for {childName} in this academic year.</p>
        </div>
      ) : marks.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No report for {term.label}</p>
          <p className="workspace-state-note">The released manifest contains no marks for this term.</p>
        </div>
      ) : (
        /* V14 g32 grid: subject marks panel on left, aggregate + reports on right */
        <div className="grid g32">
          <div className="stack" style={{ gap: 18 }}>
            <section className="panel">
              <div className="pn-head">
                <h2>{term.label} · subject marks</h2>
                <span className="chip">
                  {isFinal ? "Final" : "Provisional"}{published ? ` · ${published}` : ""}{term.version !== undefined && term.version > 1 ? ` · v${term.version}` : ""}
                </span>
              </div>
              <div className="pn-body flush">
                <div
                  className="table-wrap"
                  role="region"
                  aria-label={`${term.label} subject marks table`}
                  tabIndex={0}
                >
                  <table className={`ledger ${styles.marksTable}`}>
                    <thead>
                      <tr>
                        <th>Subject</th>
                        <th className="num">Marks</th>
                        <th>Grade</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marks.map((mark) => {
                        const statusLabel = mark.markStatus === "absent" ? "Absent"
                          : mark.markStatus === "exempt" ? "Exempt"
                          : mark.markStatus === "not_applicable" ? "N/A"
                          : null;
                        return (
                          <tr key={mark.subject}>
                            <td className={styles.subjectCell}>
                              <strong className={styles.subjectName}>{mark.subject}</strong>
                            </td>
                            <td className="num">
                              {statusLabel !== null ? <em className={styles.mutedEm}>{statusLabel}</em> : `${mark.obtained}/${mark.max}`}
                            </td>
                            <td className="num">{mark.grade}</td>
                            <td className={styles.remarkCell}>{mark.remark || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
            <div className="callout">
              <span className="msym" style={{ fontSize: 20, flex: "none", marginTop: 1, color: "var(--ink-3)" }}>balance</span>
              <span className="small">
                <strong>How aggregates work.</strong> Subject marks shown here come from the released report manifest. Any
                aggregate or rank the school adds is published separately; this page does not compute a weighted aggregate.
              </span>
            </div>
          </div>

          <div className="stack" style={{ gap: 18 }}>
            <section className="panel">
              <div className="pn-head"><h2>Aggregate</h2></div>
              <div className="pn-body">
                <div className={`serif num ${styles.aggNum}`}>
                  {totalObtained}/{totalMax} · {percentage.toFixed(1)}%
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  Sum of the published subject marks · no class rank published
                </div>
              </div>
            </section>
            <section className="panel">
              <div className="pn-head">
                <h2>Released reports</h2>
                <span className="tiny muted">
                  {clientAdapterMode() === "supabase"
                    ? "Released records · PDFs appear once generated"
                    : "Official PDFs, exactly as issued"}
                </span>
              </div>
              <div className="pn-body" style={{ paddingTop: 12 }}>
                {publications.length === 0 ? (
                  <p className="small muted">No released reports yet.</p>
                ) : (
                  publications.map((publication) => (
                    <div key={publication.ref} className={styles.pubFile}>
                      <span className="msym" style={{ fontSize: 22, color: "var(--muted)" }} aria-hidden="true">picture_as_pdf</span>
                      <div className="grow">
                        <div className={styles.pubFileName}>
                          Report card · {publication.term} · v{publication.version}
                        </div>
                        <div className={styles.pubFileMeta}>
                          {publication.ref}
                          {publication.publishedAtIso ? ` · ${formatKolkata(publication.publishedAtIso, { format: "day" })}` : ""}
                        </div>
                      </div>
                      <Link
                        prefetch={false}
                        className="btn btn-ghost btn-sm"
                        href={`/portal/results/${publication.ref}`}
                        aria-label={`Open released report: ${publication.term}, version ${publication.version}`}
                      >
                        <span className="msym" style={{ fontSize: 16 }} aria-hidden="true">
                          {clientAdapterMode() === "supabase" ? "visibility" : "download"}
                        </span>
                      </Link>
                    </div>
                  ))
                )}
                <p className="tiny muted" style={{ marginTop: 10 }}>
                  Corrections create a new version; this release keeps its reference and stays auditable.
                </p>
              </div>
            </section>
          </div>
        </div>
      )}

      {clientAdapterMode() !== "supabase" ? (
        <p className={styles.demoNote}>
          <span className="demo-badge">Demo data</span>
          <span>{ACADEMICS_DEMO_NOTE} Supabase mode reads the released report manifest and active-child snapshot.</span>
        </p>
      ) : null}
    </div>
  );
}
