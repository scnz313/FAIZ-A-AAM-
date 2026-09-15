"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { StaffProfileCode } from "@fass/contracts";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { formatKolkata } from "@/modules/iot/domain";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { academicsService, ENTRY_BATCH_STATUS_META } from "@/modules/services/academics";
import type { CorrectionApproval, EntryBatch, EntryBatchStatus, ExamDefinitionOption, PendingCorrection } from "@/modules/services/academics";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./ResultsBatches.module.css";

const DEFAULT_ACTOR = "M. Wani (exam office)";

const STATUS_FILTERS: ReadonlyArray<{ key: "all" | EntryBatchStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "moderation", label: "Moderation" },
  { key: "returned", label: "Returned" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
  { key: "withdrawn", label: "Withdrawn" },
];

/**
 * Result batch queue (V15 `q-head5`/`q-row5`): Batch → Term → Entry → Status
 * → Action. Entry → Moderation → Approved → Published is driven by the
 * academics service; Approve/Publish/Correct call the adapter and refresh the
 * queue from it, so the visible status always matches the session state.
 */
export function ResultsBatches({ batches: initial }: { batches?: EntryBatch[] | null }) {
  const supabaseMode = clientAdapterMode() === "supabase";
  const [batches, setBatches] = useState<EntryBatch[] | null>(initial ?? null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<"all" | EntryBatchStatus>("all");
  const [live, setLive] = useState("");
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [correctingRef, setCorrectingRef] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [withdrawingRef, setWithdrawingRef] = useState<string | null>(null);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [returningRef, setReturningRef] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [publishingRef, setPublishingRef] = useState<string | null>(null);
  const [lastPublication, setLastPublication] = useState<{ batchRef: string; pubRef: string; version: number } | null>(null);
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [createdBatch, setCreatedBatch] = useState<EntryBatch | null>(null);
  const { summary } = useStaffContext();
  const profileCode = summary?.profileCode ?? null;
  const canEnter = canAnyRole(summary?.roles ?? [], "results.enter");
  /* Maker/checker split: moderation/approval belongs to exam reviewers
     (results.approve), publication and correction to result publishers
     (results.publish). Return-with-reason is part of moderation so a
     reviewer can send a sheet back to the entry officer. The entry officer
     may also raise a correction request; an independent reviewer approves
     it before an editable version opens. */
  const canApprove = canAnyRole(summary?.roles ?? [], "results.approve");
  const canPublish = canAnyRole(summary?.roles ?? [], "results.publish");
  const canView = canAnyRole(summary?.roles ?? [], "results.view");
  const canRequestCorrection = canEnter || canPublish;
  const [corrections, setCorrections] = useState<PendingCorrection[] | null>(null);
  const [correctionsError, setCorrectionsError] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [correctionApproval, setCorrectionApproval] = useState<CorrectionApproval | null>(null);

  useEffect(() => {
    if (supabaseMode && initial !== undefined) {
      setBatches(initial);
      return;
    }
    let cancelled = false;
    void academicsService
      .listBatches()
      .then((items) => {
        if (!cancelled) {
          setBatches(items);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initial, supabaseMode]);

  const loadCorrections = useCallback(async () => {
    if (clientAdapterMode() !== "supabase") {
      setCorrections([]);
      return;
    }
    setCorrectionsError(false);
    const result = await academicsService.listCorrections();
    if (!result.ok) {
      setCorrectionsError(true);
      return;
    }
    setCorrections(result.value);
  }, []);

  useEffect(() => {
    void loadCorrections();
  }, [loadCorrections]);

  async function refresh() {
    try {
      setBatches(await academicsService.listBatches());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  function handleBatchCreated(batch: EntryBatch) {
    setCreatedBatch(batch);
    setNewBatchOpen(false);
    setFilter("all");
    setLive(`Created batch ${batch.ref} for ${batch.className} · ${batch.subject}.`);
    void refresh();
  }

  function reportErrors(errors: ReadonlyArray<{ message: string }>) {
    setLive(errors.map((error) => error.message).join(" "));
  }

  async function approve(ref: string) {
    setBusyRef(ref);
    const result = await academicsService.approve(ref);
    setBusyRef(null);
    if (!result.ok) return reportErrors(result.errors);
    setLive(`${ref} approved${supabaseMode ? "" : " (demo)"}`);
    await refresh();
  }

  async function publish(ref: string) {
    setBusyRef(ref);
    const result = await academicsService.publish(ref, DEFAULT_ACTOR);
    setBusyRef(null);
    setPublishingRef(null);
    if (!result.ok) return reportErrors(result.errors);
    setLastPublication({ batchRef: ref, pubRef: result.value.ref, version: result.value.version });
    setLive(
      supabaseMode
        ? `Published as ${result.value.ref} · immutable subject snapshots created`
        : `Published as ${result.value.ref} (demo) · the portal report is live`,
    );
    await refresh();
  }

  async function startCorrection(ref: string) {
    if (correctionReason.trim() === "") {
      setLive("Enter a reason for the correction.");
      return;
    }
    setBusyRef(ref);
    const result = await academicsService.startCorrection(ref, correctionReason.trim(), DEFAULT_ACTOR);
    setBusyRef(null);
    setCorrectingRef(null);
    setCorrectionReason("");
    if (!result.ok) return reportErrors(result.errors);
    setLive(
      supabaseMode
        ? `Correction requested for ${ref} · an independent exam reviewer must approve it before the editable version opens.`
        : `${ref} correction v${result.value.version} started (demo)`,
    );
    await Promise.all([refresh(), loadCorrections()]);
  }

  async function approveCorrectionRequest(request: PendingCorrection) {
    setApprovingId(request.requestId);
    const result = await academicsService.approveCorrection(request.requestId, request.version);
    setApprovingId(null);
    if (!result.ok) return reportErrors(result.errors);
    setCorrectionApproval(result.value);
    setLive(`Correction approved · ${result.value.sheetRef} is open for entry. The published record stays on file.`);
    await Promise.all([refresh(), loadCorrections()]);
  }

  async function withdraw(ref: string) {
    if (withdrawalReason.trim() === "") {
      setLive("Enter a reason for the withdrawal.");
      return;
    }
    setBusyRef(ref);
    const result = await academicsService.withdrawPublication(ref, withdrawalReason.trim(), DEFAULT_ACTOR);
    setBusyRef(null);
    setWithdrawingRef(null);
    setWithdrawalReason("");
    if (!result.ok) return reportErrors(result.errors);
    setLive(
      supabaseMode
        ? `${ref} withdrawn · the live subject publication was removed`
        : `${ref} withdrawn · the live portal publication was removed (demo)`,
    );
    await refresh();
  }

  async function returnForCorrection(ref: string) {
    if (returnReason.trim() === "") {
      setLive("Enter a reason for the return.");
      return;
    }
    setBusyRef(ref);
    const result = await academicsService.returnWithReason(ref, returnReason.trim());
    setBusyRef(null);
    setReturningRef(null);
    setReturnReason("");
    if (!result.ok) return reportErrors(result.errors);
    setLive(`${ref} returned to entry with a reason${supabaseMode ? "" : " (demo)"}`);
    await refresh();
  }

  const visible = batches === null ? null : filter === "all" ? batches : batches.filter((b) => b.status === filter);
  /* Server-hydrated rows carry no correction state; the reader below keeps the
     queue note accurate without a duplicate batch read. */
  const correctionsBySheet = new Map<string, string>();
  for (const correction of corrections ?? []) {
    if (correction.sheetRef !== null && correction.reason.trim() !== "") correctionsBySheet.set(correction.sheetRef, correction.reason);
  }

  return (
    <section aria-labelledby="batch-queue-heading">
      <div className={styles.sectionHead}>
        <h2 id="batch-queue-heading" className="section-label">
          Batch queue
        </h2>
        <div className={styles.headActions}>
          {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
          {canEnter ? (
            <Button
              variant="primary"
              onClick={() => setNewBatchOpen((open) => !open)}
              aria-expanded={newBatchOpen}
              aria-controls="new-batch-panel"
            >
              New batch
            </Button>
          ) : null}
        </div>
      </div>

      {newBatchOpen && canEnter ? (
        <div id="new-batch-panel">
          <NewBatchPanel onCreated={handleBatchCreated} onClose={() => setNewBatchOpen(false)} />
        </div>
      ) : null}

      {batches !== null && (
        <div className="tabs" role="group" aria-label="Filter batches by status">
          {STATUS_FILTERS.map((tab) => {
            const count = tab.key === "all" ? batches.length : batches.filter((b) => b.status === tab.key).length;
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={filter === tab.key}
                className={filter === tab.key ? "active" : undefined}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label}
                <span className={`num ${styles.tabCount}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {loadError && batches !== null ? (
        <p className="small muted" role="status">
          The batch queue could not be refreshed. Showing the last loaded records.
        </p>
      ) : null}
      {loadError && batches === null ? (
        <ErrorPanel title="Result batches could not be loaded" note="The results service did not respond. No publication was changed.">
          <Button variant="quiet" type="button" onClick={() => void refresh()}>
            Try again
          </Button>
        </ErrorPanel>
      ) : visible === null ? (
        <p className={styles.live}>Loading batch queue…</p>
      ) : visible.length === 0 ? (
        <p className={styles.live}>No batches in this view.</p>
      ) : (
        <div className="queue">
          <div className="q-head5" aria-hidden="true">
            <span>Batch</span>
            <span>Term</span>
            <span>Entry</span>
            <span>Status</span>
            <span style={{ textAlign: "right" }}>Action</span>
          </div>
          {visible.map((batch) => (
            <BatchRow
              key={batch.ref}
              batch={batch}
              busy={busyRef === batch.ref}
              correcting={correctingRef === batch.ref}
              correctionReason={correctionReason}
              canEnter={canEnter}
              canApprove={canApprove}
              canPublish={canPublish}
              canView={canView}
              canRequestCorrection={canRequestCorrection}
              pendingCorrectionReason={correctionsBySheet.get(batch.ref)}
              profileCode={profileCode}
              supabaseMode={supabaseMode}
              onCorrectionReasonChange={setCorrectionReason}
              onApprove={approve}
              onPublish={publish}
              onStartCorrection={startCorrection}
              onOpenCorrection={(ref) => {
                setCorrectingRef(ref);
                setCorrectionReason("");
              }}
              onCancelCorrection={() => {
                setCorrectingRef(null);
                setCorrectionReason("");
              }}
              withdrawing={withdrawingRef === batch.ref}
              withdrawalReason={withdrawalReason}
              onWithdrawalReasonChange={setWithdrawalReason}
              onWithdraw={withdraw}
              onOpenWithdraw={(ref) => {
                setWithdrawingRef(ref);
                setWithdrawalReason("");
              }}
              onCancelWithdraw={() => {
                setWithdrawingRef(null);
                setWithdrawalReason("");
              }}
              returning={returningRef === batch.ref}
              returnReason={returnReason}
              onReturnReasonChange={setReturnReason}
              onReturn={returnForCorrection}
              onOpenReturn={(ref) => {
                setReturningRef(ref);
                setReturnReason("");
              }}
              onCancelReturn={() => {
                setReturningRef(null);
                setReturnReason("");
              }}
              publishing={publishingRef === batch.ref}
              onOpenPublish={(ref) => {
                setPublishingRef(ref);
              }}
              onCancelPublish={() => {
                setPublishingRef(null);
              }}
            />
          ))}
        </div>
      )}

      {canView && corrections !== null && corrections.length > 0 ? (
        <section className="panel" aria-labelledby="corrections-review-heading">
          <div className="pn-head">
            <h3 id="corrections-review-heading">Corrections awaiting review</h3>
            <span className="chip">{corrections.length}</span>
          </div>
          <div className="pn-body">
            <p className={styles.panelNote}>
              A correction request opens a new editable sheet only after an independent exam reviewer approves it.
              The published version stays on file.
            </p>
            <div className="queue">
              <div className="q-head" aria-hidden="true">
                <span>Correction</span>
                <span>Class · subject</span>
                <span>Requested</span>
                <span style={{ textAlign: "right" }}>Action</span>
              </div>
              {corrections.map((correction) => (
                <div className="q-row" key={correction.requestId}>
                  <div>
                    <div className="q-t">
                      <span className="num">{correction.sheetRef ?? correction.releaseRef ?? "Result batch"}</span>
                    </div>
                    <div className="q-s">{correction.reason}</div>
                  </div>
                  <div className="q-m">
                    {correction.className ?? "Class"} · {correction.subject ?? "Subject"}
                    {correction.term ? ` · ${termLabel(correction.term)}` : ""}
                  </div>
                  <div className="q-m">
                    {correction.requestedAtIso ? formatKolkata(correction.requestedAtIso, { format: "day" }) : ""}
                  </div>
                  <div className="q-act">
                    {canApprove ? (
                      <Button
                        variant="primary"
                        disabled={approvingId !== null}
                        onClick={() => void approveCorrectionRequest(correction)}
                      >
                        {approvingId === correction.requestId ? "Approving…" : "Approve correction"}
                      </Button>
                    ) : (
                      <span className="small muted">Awaiting reviewer</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      {correctionsError ? (
        <p className="small muted" role="status">
          Corrections awaiting review could not be refreshed. The batch queue below is unaffected.
        </p>
      ) : null}

      {correctionApproval ? (
        <p className={styles.publishSuccess}>
          <strong>
            Correction approved · <span className="num">{correctionApproval.sheetRef}</span> is open for entry.
          </strong>{" "}
          <Link
            prefetch={false}
            className="link-arrow"
            href={canonicalStaffUrl(profileCode, `/results/${correctionApproval.sheetRef}/entry`)}
          >
            Open entry →
          </Link>
        </p>
      ) : null}

      {createdBatch ? (
        <p className={styles.publishSuccess}>
          <strong>
            Created <span className="num">{createdBatch.ref}</span> · {createdBatch.exam} · {createdBatch.className} ·{" "}
            {createdBatch.subject}.
          </strong>{" "}
          <Link
            prefetch={false}
            className="link-arrow"
            href={canonicalStaffUrl(profileCode, `/results/${createdBatch.ref}/entry`)}
          >
            Open entry →
          </Link>
        </p>
      ) : null}

      {lastPublication ? (
        <p className={styles.publishSuccess}>
          <strong>
            Published as <span className="num">{lastPublication.pubRef}</span> (v{lastPublication.version})
            {!supabaseMode ? " (demo)" : ""}.
          </strong>{" "}
          <Link
            prefetch={false}
            className="link-arrow"
            href={canonicalStaffUrl(profileCode, `/results/${lastPublication.batchRef}`)}
          >
            View immutable record →
          </Link>
        </p>
      ) : null}

      <p className={styles.live} aria-live="polite">
        {live}
      </p>
    </section>
  );
}

/** Human-readable term label; server terms are stored lowercase. */
function termLabel(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function sectionOptionLabel(definition: ExamDefinitionOption): string {
  const base = `${definition.gradeLabel} · ${definition.sectionLabel}`;
  return definition.academicYearLabel === undefined ? base : `${base} · ${definition.academicYearLabel}`;
}

/**
 * Create-batch panel (Principal, results.enter only). Term, class section,
 * and subject come from the authorized exam-definition projection, so every
 * offered subject has configured assessment components. Failures keep the
 * selection and offer an explicit retry; success refreshes the queue through
 * the parent and announces the new reference.
 */
function NewBatchPanel({
  onCreated,
  onClose,
}: {
  onCreated: (batch: EntryBatch) => void;
  onClose: () => void;
}) {
  const [definitions, setDefinitions] = useState<ExamDefinitionOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [term, setTerm] = useState<string | null>(null);
  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const creatingRef = useRef(false);

  const load = useCallback(async () => {
    setLoadError(false);
    setDefinitions(null);
    try {
      const result = await academicsService.listExamDefinitions();
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "Exam options are unavailable.");
      setDefinitions(result.value);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all = definitions ?? [];
  /* Prefer a term/section that actually has configured subjects so the panel
     opens on a creatable selection; every configured term stays listed so a
     missing assessment configuration is visible and actionable instead of
     silently hidden. */
  const withSubjects = all.filter((definition) => definition.subjects.length > 0);
  const preferred = withSubjects.length > 0 ? withSubjects : all;
  const terms: string[] = [];
  for (const definition of [...preferred, ...all]) {
    if (!terms.includes(definition.term)) terms.push(definition.term);
  }
  const activeTerm = term !== null && terms.includes(term) ? term : (terms[0] ?? "");
  const sections = all.filter((definition) => definition.term === activeTerm);
  const activeDefinition = sections.find((definition) => definition.id === definitionId)
    ?? sections.find((definition) => definition.subjects.length > 0)
    ?? sections[0]
    ?? null;
  const subjects = activeDefinition?.subjects ?? [];
  const activeSubjectId = subjectId !== null && subjects.some((subject) => subject.id === subjectId)
    ? subjectId
    : (subjects[0]?.id ?? null);
  const ready = activeDefinition !== null && activeSubjectId !== null;

  async function submit() {
    if (activeDefinition === null || activeSubjectId === null) {
      setCreateError("Choose an exam, class section, and subject.");
      return;
    }
    /* One intent per click: the ref blocks a same-tick double submit while
       the server's active-sheet lookup keeps retries duplicate-free. */
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    const result = await academicsService.createBatch({
      examDefinitionId: activeDefinition.id,
      gradeSectionId: activeDefinition.gradeSectionId,
      subjectId: activeSubjectId,
      idempotencyKey: `batch:${crypto.randomUUID()}`,
    });
    creatingRef.current = false;
    setCreating(false);
    if (!result.ok) {
      setCreateError(result.errors.map((error) => error.message).join(" "));
      return;
    }
    setTerm(null);
    setDefinitionId(null);
    setSubjectId(null);
    onCreated(result.value);
  }

  return (
    <section className="panel" aria-labelledby="new-batch-heading">
      <div className="pn-head">
        <h3 id="new-batch-heading">New batch</h3>
        <Button variant="quiet" type="button" onClick={onClose} disabled={creating}>
          Close
        </Button>
      </div>
      <div className="pn-body">
        <p className={styles.panelNote}>
          Choose the exam, class section, and subject. Creating a batch freezes the active roster and the assessment
          components configured for that subject; existing open work for the same selection is reopened instead.
        </p>

        {loadError ? (
          <ErrorPanel
            title="Exam options could not be loaded"
            note="The results service did not respond or your account has no exam definitions in scope. No batch was created."
          >
            <Button variant="quiet" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </ErrorPanel>
        ) : definitions === null ? (
          <LoadingSkeleton lines={2} label="Loading exam options" />
        ) : all.length === 0 ? (
          <p className={styles.panelNote}>
            No exam definitions are available in your scope. Ask the examination office to configure the term and
            assessment components first.
          </p>
        ) : (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            noValidate
          >
            <div className="field">
              <label htmlFor="new-batch-term">Term or exam</label>
              <select
                id="new-batch-term"
                className="select"
                value={activeTerm}
                onChange={(event) => {
                  setTerm(event.target.value);
                  setDefinitionId(null);
                  setSubjectId(null);
                  setCreateError(null);
                }}
              >
                {terms.map((option) => (
                  <option key={option} value={option}>
                    {termLabel(option)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="new-batch-section">Class section</label>
              <select
                id="new-batch-section"
                className="select"
                value={activeDefinition?.id ?? ""}
                onChange={(event) => {
                  setDefinitionId(event.target.value);
                  setSubjectId(null);
                  setCreateError(null);
                }}
              >
                {sections.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {sectionOptionLabel(definition)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              {subjects.length === 0 ? (
                <div className="callout warn" role="status" id="new-batch-subject-empty">
                  <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
                    info
                  </span>
                  <div>
                    <p className="strong" style={{ margin: 0 }}>
                      No assessment components are configured for{" "}
                      {activeDefinition !== null ? sectionOptionLabel(activeDefinition) : "this class section"} yet.
                    </p>
                    <p className="small muted" style={{ margin: "4px 0 0" }}>
                      A batch needs at least one subject with configured assessment components. Ask the examination
                      office to add them for {termLabel(activeTerm)}, or choose another class section that is already
                      configured.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <label htmlFor="new-batch-subject">Subject</label>
                  <select
                    id="new-batch-subject"
                    className="select"
                    value={activeSubjectId ?? ""}
                    onChange={(event) => {
                      setSubjectId(event.target.value);
                      setCreateError(null);
                    }}
                  >
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            {createError !== null ? (
              <ErrorPanel title="The batch could not be created" note={createError}>
                <Button variant="quiet" type="button" onClick={() => void submit()} disabled={creating}>
                  Try again
                </Button>
              </ErrorPanel>
            ) : null}

            <div className={styles.actions}>
              <Button type="submit" variant="primary" disabled={!ready || creating}>
                {creating ? "Creating…" : "Create batch"}
              </Button>
              <Button variant="quiet" type="button" onClick={onClose} disabled={creating}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function BatchRow({
  batch,
  busy,
  correcting,
  correctionReason,
  canEnter,
  canApprove,
  canPublish,
  canView,
  canRequestCorrection,
  pendingCorrectionReason,
  profileCode,
  onCorrectionReasonChange,
  onApprove,
  onPublish,
  onStartCorrection,
  onOpenCorrection,
  onCancelCorrection,
  withdrawing,
  withdrawalReason,
  onWithdrawalReasonChange,
  onWithdraw,
  onOpenWithdraw,
  onCancelWithdraw,
  returning,
  returnReason,
  onReturnReasonChange,
  onReturn,
  onOpenReturn,
  onCancelReturn,
  publishing,
  onOpenPublish,
  onCancelPublish,
  supabaseMode,
}: {
  batch: EntryBatch;
  busy: boolean;
  correcting: boolean;
  correctionReason: string;
  canEnter: boolean;
  canApprove: boolean;
  canPublish: boolean;
  canView: boolean;
  canRequestCorrection: boolean;
  pendingCorrectionReason?: string;
  profileCode: StaffProfileCode | null;
  supabaseMode: boolean;
  onCorrectionReasonChange: (reason: string) => void;
  onApprove: (ref: string) => void;
  onPublish: (ref: string) => void;
  onStartCorrection: (ref: string) => void;
  onOpenCorrection: (ref: string) => void;
  onCancelCorrection: () => void;
  withdrawing: boolean;
  withdrawalReason: string;
  onWithdrawalReasonChange: (reason: string) => void;
  onWithdraw: (ref: string) => void;
  onOpenWithdraw: (ref: string) => void;
  onCancelWithdraw: () => void;
  returning: boolean;
  returnReason: string;
  onReturnReasonChange: (reason: string) => void;
  onReturn: (ref: string) => void;
  onOpenReturn: (ref: string) => void;
  onCancelReturn: () => void;
  publishing: boolean;
  onOpenPublish: (ref: string) => void;
  onCancelPublish: () => void;
}) {
  const meta = ENTRY_BATCH_STATUS_META[batch.status];
  /* Queue rows carry server counts (000109); the fallback keeps rows mapped
     with a full matrix (detail/demo) working through the same expression. */
  const entered = batch.enteredCount ?? batch.rows.filter((row) => row.obtained !== null).length;
  const total = batch.totalCount ?? batch.rows.length;

  return (
    <div className={styles.batchItem}>
      <div className="q-row5">
        <div>
          <div className="q-t">
            <Link prefetch={false} className={styles.rowLink} href={canonicalStaffUrl(profileCode, `/results/${batch.ref}`)}>
              <span className="num">{batch.ref}</span>
            </Link>
          </div>
          <div className="q-s">
            {batch.className} · {batch.subject}
            {batch.publishedAtIso ? ` · published ${formatKolkata(batch.publishedAtIso, { format: "day" })}` : ""}
          </div>
        </div>
        <div className="q-m">{batch.exam}</div>
        <div className="q-m num">
          {entered}/{total}
        </div>
        <div>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>
        <div className="q-act">
          {canEnter ? (
            <Button variant="quiet" href={canonicalStaffUrl(profileCode, `/results/${batch.ref}/entry`)}>
              {batch.status === "draft" || batch.status === "returned" ? "Open entry" : "View sheet"}
            </Button>
          ) : null}
          {canApprove && (batch.status === "submitted" || batch.status === "moderation") && (
            <Button variant="primary" onClick={() => onApprove(batch.ref)} disabled={busy}>
              Approve
            </Button>
          )}
          {canApprove && (batch.status === "submitted" || batch.status === "moderation") && (
            <Button
              variant="quiet"
              onClick={() => (returning ? onCancelReturn() : onOpenReturn(batch.ref))}
              disabled={busy}
            >
              Return
            </Button>
          )}
          {canPublish && batch.status === "approved" && (
            <Button
              variant="saffron"
              onClick={() => (publishing ? onCancelPublish() : onOpenPublish(batch.ref))}
              disabled={busy}
              aria-expanded={publishing}
            >
              Publish
            </Button>
          )}
          {canRequestCorrection && batch.status === "published" && (
            <Button
              variant="quiet"
              onClick={() => (correcting ? onCancelCorrection() : onOpenCorrection(batch.ref))}
              disabled={busy}
            >
              Request correction
            </Button>
          )}
          {canPublish && batch.status === "published" && (
            <Button
              variant="quiet"
              onClick={() => (withdrawing ? onCancelWithdraw() : onOpenWithdraw(batch.ref))}
              disabled={busy}
            >
              Withdraw
            </Button>
          )}
          {canView && !canEnter && !canApprove && !canPublish ? (
            <Button variant="quiet" href={canonicalStaffUrl(profileCode, `/results/${batch.ref}`)}>
              Open
            </Button>
          ) : null}
        </div>
      </div>

      {(batch.note || pendingCorrectionReason) && !correcting && !withdrawing && !returning && !publishing && (
        <p className={styles.noteLine}>
          {pendingCorrectionReason ? `Correction pending reviewer approval · ${pendingCorrectionReason}` : batch.note}
        </p>
      )}

      {publishing && batch.status === "approved" && (
        <div
          className="panel"
          role="group"
          aria-label={`Confirm publication of ${batch.ref}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancelPublish();
          }}
        >
          <p>
            Publish <strong className="num">{batch.ref}</strong> · {batch.exam} · {batch.className} ·{" "}
            {batch.subject} · v{batch.version}? A new immutable publication is created
            {supabaseMode
              ? "; each student's report release is assembled separately before families can view it."
              : " and the portal report updates immediately (demo)."}
          </p>
          <div className={styles.actions}>
            <Button variant="saffron" onClick={() => onPublish(batch.ref)} disabled={busy}>
              Publish v{batch.version}
            </Button>
            <Button variant="quiet" onClick={onCancelPublish} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {correcting && (
        <div className="panel">
          <label className="sr-only" htmlFor={`correction-reason-${batch.ref}`}>
            Reason for correction (required)
          </label>
          <input
            id={`correction-reason-${batch.ref}`}
            className="input"
            type="text"
            value={correctionReason}
            onChange={(event) => onCorrectionReasonChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelCorrection();
            }}
            placeholder="Reason for correction (required) · an independent reviewer approves before an editable version opens"
            aria-required="true"
          />
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => onStartCorrection(batch.ref)} disabled={busy}>
              Request correction
            </Button>
            <Button variant="quiet" onClick={onCancelCorrection} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {withdrawing && (
        <div className="panel">
          <label className="sr-only" htmlFor={`withdraw-reason-${batch.ref}`}>
            Reason for withdrawing v{batch.version} (required)
          </label>
          <input
            id={`withdraw-reason-${batch.ref}`}
            className="input"
            type="text"
            value={withdrawalReason}
            onChange={(event) => onWithdrawalReasonChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelWithdraw();
            }}
            placeholder={`Reason for withdrawing v${batch.version} (required) · the live report is removed`}
            aria-required="true"
          />
          <div className={styles.actions}>
            <Button variant="danger" onClick={() => onWithdraw(batch.ref)} disabled={busy}>
              Withdraw publication
            </Button>
            <Button variant="quiet" onClick={onCancelWithdraw} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {returning && (
        <div className="panel">
          <label className="sr-only" htmlFor={`return-reason-${batch.ref}`}>
            Reason for returning {batch.ref} (required)
          </label>
          <input
            id={`return-reason-${batch.ref}`}
            className="input"
            type="text"
            value={returnReason}
            onChange={(event) => onReturnReasonChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelReturn();
            }}
            placeholder="Why is the sheet back with the entry officer? This reason is recorded on the batch."
            aria-required="true"
          />
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => onReturn(batch.ref)} disabled={busy}>
              Confirm return
            </Button>
            <Button variant="quiet" onClick={onCancelReturn} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
