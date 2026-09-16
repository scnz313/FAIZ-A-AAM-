"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import {
  schoolSetupService,
  type ExamComponentInput,
  type SchoolSetup,
  type SetupAcademicYearStatus,
  type SetupComponent,
  type SetupExam,
  type SetupExamStatus,
  type SetupGrade,
  type SetupSection,
  type SetupSectionStatus,
  type SetupSubject,
} from "@/modules/services/school-setup";

import styles from "./page.module.css";

/* ------------------------------------------------------------------ */
/* Labels and tones                                                    */
/* ------------------------------------------------------------------ */

const YEAR_TONE: Record<SetupAcademicYearStatus, "good" | "watch" | "neutral"> = {
  current: "good",
  upcoming: "watch",
  historical: "neutral",
  closed: "neutral",
};

const SECTION_TONE: Record<SetupSectionStatus, "good" | "watch" | "neutral"> = {
  active: "good",
  planned: "watch",
  archived: "neutral",
};

const EXAM_TONE: Record<SetupExamStatus, "good" | "watch" | "neutral"> = {
  open: "good",
  planned: "watch",
  closed: "neutral",
};

const YEAR_TRANSITIONS: Record<SetupAcademicYearStatus, Array<{ status: SetupAcademicYearStatus; label: string; note?: string }>> = {
  upcoming: [{ status: "current", label: "Make current", note: "The current year becomes historical." }],
  current: [{ status: "historical", label: "Mark historical" }],
  historical: [{ status: "closed", label: "Close" }],
  closed: [],
};

const SECTION_TRANSITIONS: Record<SetupSectionStatus, Array<{ status: SetupSectionStatus; label: string }>> = {
  planned: [{ status: "active", label: "Activate" }],
  active: [{ status: "archived", label: "Archive" }],
  archived: [{ status: "active", label: "Restore" }],
};

const EXAM_TRANSITIONS: Record<SetupExamStatus, Array<{ status: SetupExamStatus; label: string }>> = {
  planned: [{ status: "open", label: "Open" }],
  open: [{ status: "closed", label: "Close" }],
  closed: [{ status: "open", label: "Reopen" }],
};

const TABS = [
  { key: "classes", label: "Classes" },
  { key: "sections", label: "Sections" },
  { key: "subjects", label: "Subjects" },
  { key: "exams", label: "Exams" },
] as const;

type SetupTab = (typeof TABS)[number]["key"];

type PendingAction =
  | { kind: "year-status"; status: SetupAcademicYearStatus; label: string; note?: string }
  | { kind: "grade-edit"; id: string }
  | { kind: "section-status"; id: string; status: SetupSectionStatus; label: string }
  | { kind: "subject-edit"; id: string }
  | { kind: "exam-status"; id: string; status: SetupExamStatus; label: string }
  | { kind: "component-edit"; examId: string; id: string }
  | { kind: "component-delete"; examId: string; id: string }
  | null;

type CreatePanel = "year" | "grade" | "catalog" | "section" | "copy" | "subject" | "exam-term" | `component:${string}` | null;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

export default function SchoolSetupWorkspace() {
  const { summary } = useStaffContext();
  const profileLabel = summary?.profileLabel ?? summary?.roleLabel ?? "Staff";
  const [setup, setSetup] = useState<SchoolSetup | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [yearId, setYearId] = useState<string | null>(null);
  const [tab, setTab] = useState<SetupTab>("classes");
  const [action, setAction] = useState<PendingAction>(null);
  const [createPanel, setCreatePanel] = useState<CreatePanel>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [operationError, setOperationError] = useState<string | null>(null);

  const reload = useCallback(async (targetYearId?: string | null) => {
    try {
      const next = await schoolSetupService.read(targetYearId ?? undefined);
      setSetup(next);
      setLoadError(false);
      setYearId((current) => current ?? next.selectedAcademicYearId);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function selectYear(id: string) {
    if (id === yearId) return;
    setYearId(id);
    setAction(null);
    setCreatePanel(null);
    void reload(id);
  }

  /** Run a write through the service, announce it, then re-read so the
      rendered state always matches the authoritative read. */
  async function runWrite<T>(write: () => Promise<T>, announce: (result: T) => string): Promise<boolean> {
    setBusy(true);
    setOperationError(null);
    try {
      const result = await write();
      setAnnouncement(announce(result));
      setAction(null);
      setCreatePanel(null);
      await reload(yearId);
      return true;
    } catch (error) {
      setOperationError(errorMessage(error, "The change could not be saved."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const selectedYear = setup?.academicYears.find((year) => year.id === yearId) ?? null;

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <p className="eyebrow">{profileLabel} · School setup</p>
          <h1 className={styles.title}>School setup</h1>
          <p className="ph-sub">
            Academic years, classes and sections, subjects, exam terms and marking components. Changes are audited.
          </p>
        </div>
      </div>

      {announcement ? <p className={styles.liveNote} role="status" aria-live="polite">{announcement}</p> : null}
      {operationError ? <p className={styles.error} role="alert">{operationError}</p> : null}

      {loadError && setup === null ? (
        <section className="panel" aria-labelledby="school-setup-heading">
          <div className="pn-head"><h2 id="school-setup-heading">School configuration</h2></div>
          <div className="pn-body">
            <ErrorPanel title="School setup could not be loaded" note="The configuration read did not respond. No records were changed.">
              <Button variant="quiet" type="button" onClick={() => void reload(yearId)}>Try again</Button>
            </ErrorPanel>
          </div>
        </section>
      ) : setup === null ? (
        <section className="panel" aria-labelledby="school-setup-heading">
          <div className="pn-head"><h2 id="school-setup-heading">School configuration</h2></div>
          <div className="pn-body"><LoadingSkeleton lines={6} label="Loading school setup…" /></div>
        </section>
      ) : (
        <>
          <div className={styles.yearBar}>
            <div className="seg x-scroll" role="group" aria-label="Academic year">
              {setup.academicYears.map((year) => (
                <button
                  key={year.id}
                  type="button"
                  className={year.id === yearId ? "on" : undefined}
                  onClick={() => selectYear(year.id)}
                  aria-pressed={year.id === yearId}
                >
                  {year.label}
                  <span className={styles.yearStatus}>
                    <StatusBadge tone={YEAR_TONE[year.status]}>{year.status}</StatusBadge>
                  </span>
                </button>
              ))}
            </div>
            <span className={styles.yearBarSpacer} />
            {selectedYear !== null
              ? YEAR_TRANSITIONS[selectedYear.status].map((transition) => (
                  <button
                    key={transition.status}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAction({ kind: "year-status", status: transition.status, label: transition.label, note: transition.note })}
                  >
                    {transition.label}
                  </button>
                ))
              : null}
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => { setCreatePanel(createPanel === "year" ? null : "year"); setAction(null); }}
            >
              New academic year
            </button>
          </div>

          {action?.kind === "year-status" && selectedYear !== null ? (
            <ReasonForm
              key={`year-${action.status}`}
              id={`year-${action.status}`}
              submitLabel={`${action.label} ${selectedYear.label}`}
              note={action.note}
              busy={busy}
              onCancel={() => setAction(null)}
              onSubmit={async (reason) => {
                await runWrite(
                  () => schoolSetupService.setAcademicYearStatus({ id: selectedYear.id, status: action.status, reason }),
                  () => `${selectedYear.label} is now ${action.status}.`,
                );
              }}
            />
          ) : null}

          {createPanel === "year" ? (
            <NewYearForm
              busy={busy}
              onCancel={() => setCreatePanel(null)}
              onSubmit={async (input) => {
                await runWrite(
                  () => schoolSetupService.createAcademicYear({ ...input, reason: input.reason }),
                  (year) => `Academic year ${year.label} created as upcoming.`,
                );
              }}
            />
          ) : null}

          <div className="v14-tabs" role="tablist" aria-label="School setup areas">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={tab === entry.key}
                className={tab === entry.key ? "on" : undefined}
                onClick={() => { setTab(entry.key); setAction(null); setCreatePanel(null); }}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {tab === "classes" ? (
            <ClassesPanel
              setup={setup}
              busy={busy}
              action={action}
              setAction={setAction}
              createPanel={createPanel}
              setCreatePanel={setCreatePanel}
              runWrite={runWrite}
            />
          ) : null}
          {tab === "sections" ? (
            <SectionsPanel
              setup={setup}
              yearId={yearId}
              busy={busy}
              action={action}
              setAction={setAction}
              createPanel={createPanel}
              setCreatePanel={setCreatePanel}
              runWrite={runWrite}
            />
          ) : null}
          {tab === "subjects" ? (
            <SubjectsPanel
              setup={setup}
              busy={busy}
              action={action}
              setAction={setAction}
              createPanel={createPanel}
              setCreatePanel={setCreatePanel}
              runWrite={runWrite}
            />
          ) : null}
          {tab === "exams" ? (
            <ExamsPanel
              setup={setup}
              yearId={yearId}
              busy={busy}
              action={action}
              setAction={setAction}
              createPanel={createPanel}
              setCreatePanel={setCreatePanel}
              runWrite={runWrite}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared form pieces                                                  */
/* ------------------------------------------------------------------ */

function ReasonField({
  id,
  value,
  error,
  onChange,
}: {
  id: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Reason (required)</label>
      <input
        id={id}
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-required="true"
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder="Why is this changing?"
      />
      {error ? <p className="field-error" id={`${id}-error`} role="alert">{error}</p> : null}
    </div>
  );
}

/** Inline reason form for status transitions — one reason field plus an
    optional confirm note. */
function ReasonForm({
  id,
  submitLabel,
  note,
  busy,
  danger,
  onSubmit,
  onCancel,
}: {
  id: string;
  submitLabel: string;
  note?: string;
  busy: boolean;
  danger?: boolean;
  onSubmit: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <div className={styles.inlineForm}>
      {note ? <p className={styles.secondary}>{note}</p> : null}
      <ReasonField
        id={`reason-${id}`}
        value={reason}
        error={fieldError}
        onChange={(value) => { setReason(value); setFieldError(null); }}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={`btn ${danger ? "btn-danger" : "btn-primary"} btn-sm`}
          disabled={busy}
          onClick={() => {
            const clean = reason.trim();
            if (clean.length < 3) {
              setFieldError("Enter a reason of at least 3 characters.");
              return;
            }
            void onSubmit(clean);
          }}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function NewYearForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (input: { label: string; startsOn: string; endsOn: string; reason: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <section className="panel" aria-labelledby="new-year-heading">
      <div className="pn-head"><h2 id="new-year-heading">New academic year</h2></div>
      <div className="pn-body">
        <div className={styles.inlineForm}>
          <div className={styles.formGrid}>
            <div className="field">
              <label htmlFor="new-year-label">Label</label>
              <input id="new-year-label" className="input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="2027-28" />
            </div>
            <div className="field">
              <label htmlFor="new-year-starts">Starts on</label>
              <input id="new-year-starts" className="input" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="new-year-ends">Ends on</label>
              <input id="new-year-ends" className="input" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
            </div>
          </div>
          <ReasonField id="new-year-reason" value={reason} error={fieldError} onChange={(value) => { setReason(value); setFieldError(null); }} />
          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => {
                const clean = reason.trim();
                if (label.trim() === "" || startsOn === "" || endsOn === "") {
                  setFieldError("Enter a label and both dates.");
                  return;
                }
                if (clean.length < 3) {
                  setFieldError("Enter a reason of at least 3 characters.");
                  return;
                }
                void onSubmit({ label: label.trim(), startsOn, endsOn, reason: clean });
              }}
            >
              {busy ? "Saving…" : "Create academic year"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Classes tab                                                         */
/* ------------------------------------------------------------------ */

function ClassesPanel({
  setup,
  busy,
  action,
  setAction,
  createPanel,
  setCreatePanel,
  runWrite,
}: {
  setup: SchoolSetup;
  busy: boolean;
  action: PendingAction;
  setAction: (action: PendingAction) => void;
  createPanel: CreatePanel;
  setCreatePanel: (panel: CreatePanel) => void;
  runWrite: <T>(write: () => Promise<T>, announce: (result: T) => string) => Promise<boolean>;
}) {
  const grades = [...setup.grades].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return (
    <section className="panel" aria-labelledby="classes-heading">
      <div className="pn-head">
        <div>
          <h2 id="classes-heading">Classes</h2>
          <p className="sub">The class catalog is shared across years. Codes are permanent once a class is referenced.</p>
        </div>
        <div className={styles.panelActions}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCreatePanel(createPanel === "catalog" ? null : "catalog"); setAction(null); }}>
            Add standard classes (Nursery to Class 10)
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setCreatePanel(createPanel === "grade" ? null : "grade"); setAction(null); }}>
            Add class
          </button>
        </div>
      </div>
      <div className="pn-body flush">
        {createPanel === "catalog" ? (
          <div className={styles.detailPanel}>
            <h3 className={styles.detailHeading}>Add standard classes</h3>
            <p className={styles.secondary}>
              Adds every missing class from Nursery through Class 10. Classes already configured are left untouched.
            </p>
            <ReasonForm
              id="grade-catalog"
              submitLabel="Add standard classes"
              busy={busy}
              onCancel={() => setCreatePanel(null)}
              onSubmit={async (reason) => {
                await runWrite(
                  () => schoolSetupService.addStandardGrades({ reason }),
                  (inserted) => inserted.length === 0
                    ? "Every standard class already exists."
                    : `Added ${inserted.length} standard ${inserted.length === 1 ? "class" : "classes"}: ${inserted.map((grade) => grade.label).join(", ")}.`,
                );
              }}
            />
          </div>
        ) : null}
        {createPanel === "grade" ? (
          <div className={styles.detailPanel}>
            <h3 className={styles.detailHeading}>Add class</h3>
            <GradeForm
              busy={busy}
              onCancel={() => setCreatePanel(null)}
              onSubmit={async (input, reason) => {
                await runWrite(
                  () => schoolSetupService.upsertGrade({ code: input.code, label: input.label, sortOrder: input.sortOrder, reason }),
                  (grade) => `${grade.label} added to the class catalog.`,
                );
              }}
            />
          </div>
        ) : null}
        {grades.length === 0 ? (
          <div className={`workspace-state ${styles.statePad}`}>
            <p className="workspace-state-title">No classes yet</p>
            <p className="workspace-state-note">Add the standard catalog or create the first class.</p>
          </div>
        ) : (
          <div className="table-wrap" role="region" aria-label="Class catalog" tabIndex={0}>
            <table className={`ledger ${styles.table}`}>
              <caption className="sr-only">Classes with code, sort order, section count and reference state</caption>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Code</th>
                  <th scope="col" className="num">Sort order</th>
                  <th scope="col" className="num">Sections this year</th>
                  <th scope="col">Referenced</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((grade) => (
                  <GradeRow
                    key={grade.id}
                    grade={grade}
                    editing={action?.kind === "grade-edit" && action.id === grade.id}
                    busy={busy}
                    onEdit={() => setAction({ kind: "grade-edit", id: grade.id })}
                    onCancel={() => setAction(null)}
                    onSubmit={async (input, reason) => {
                      await runWrite(
                        () => schoolSetupService.upsertGrade({ id: grade.id, label: input.label, sortOrder: input.sortOrder, reason }),
                        (saved) => `${saved.label} updated.`,
                      );
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function GradeRow({
  grade,
  editing,
  busy,
  onEdit,
  onCancel,
  onSubmit,
}: {
  grade: SetupGrade;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: (input: { label: string; sortOrder: number }, reason: string) => Promise<void>;
}) {
  return (
    <>
      <tr>
        <td><strong>{grade.label}</strong></td>
        <td className="num">{grade.code}</td>
        <td className="num">{grade.sortOrder}</td>
        <td className="num">{grade.sectionCount}</td>
        <td>{grade.referenced ? "Referenced" : <span className={styles.secondary}>Not referenced</span>}</td>
        <td>
          {editing ? null : (
            <button type="button" className="btn btn-quiet btn-sm" onClick={onEdit} aria-expanded={false} aria-controls={`grade-edit-${grade.id}`}>
              Edit
            </button>
          )}
        </td>
      </tr>
      {editing ? (
        <tr>
          <td colSpan={6} className={styles.detailCell}>
            <div className={styles.detailPanel} id={`grade-edit-${grade.id}`}>
              <h3 className={styles.detailHeading}>Edit {grade.label}</h3>
              <p className={styles.secondary}>Code <span className="num">{grade.code}</span> is permanent{grade.referenced ? " · this class is referenced by school records" : ""}.</p>
              <GradeForm busy={busy} grade={grade} onCancel={onCancel} onSubmit={onSubmit} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function GradeForm({
  grade,
  busy,
  onSubmit,
  onCancel,
}: {
  grade?: SetupGrade;
  busy: boolean;
  onSubmit: (input: { code: string; label: string; sortOrder: number }, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(grade?.code ?? "");
  const [label, setLabel] = useState(grade?.label ?? "");
  const [sortOrder, setSortOrder] = useState(grade !== undefined ? String(grade.sortOrder) : "0");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const uid = grade?.id ?? "new";
  return (
    <div className={styles.inlineForm}>
      <div className={styles.formGrid}>
        {grade === undefined ? (
          <div className="field">
            <label htmlFor={`grade-code-${uid}`}>Code</label>
            <input id={`grade-code-${uid}`} className="input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="6" />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={`grade-label-${uid}`}>Label</label>
          <input id={`grade-label-${uid}`} className="input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Class 6" />
        </div>
        <div className="field">
          <label htmlFor={`grade-sort-${uid}`}>Sort order</label>
          <input id={`grade-sort-${uid}`} className="input" type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
        </div>
      </div>
      <ReasonField id={`grade-reason-${uid}`} value={reason} error={fieldError} onChange={(value) => { setReason(value); setFieldError(null); }} />
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => {
            const clean = reason.trim();
            if (label.trim() === "" || (grade === undefined && code.trim() === "")) {
              setFieldError("Enter a label and a code.");
              return;
            }
            if (!Number.isFinite(Number(sortOrder))) {
              setFieldError("Enter a numeric sort order.");
              return;
            }
            if (clean.length < 3) {
              setFieldError("Enter a reason of at least 3 characters.");
              return;
            }
            void onSubmit({ code: code.trim(), label: label.trim(), sortOrder: Number(sortOrder) }, clean);
          }}
        >
          {busy ? "Saving…" : grade === undefined ? "Add class" : "Save class"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sections tab                                                        */
/* ------------------------------------------------------------------ */

function SectionsPanel({
  setup,
  yearId,
  busy,
  action,
  setAction,
  createPanel,
  setCreatePanel,
  runWrite,
}: {
  setup: SchoolSetup;
  yearId: string | null;
  busy: boolean;
  action: PendingAction;
  setAction: (action: PendingAction) => void;
  createPanel: CreatePanel;
  setCreatePanel: (panel: CreatePanel) => void;
  runWrite: <T>(write: () => Promise<T>, announce: (result: T) => string) => Promise<boolean>;
}) {
  const gradeOrder = new Map(setup.grades.map((grade) => [grade.id, grade.sortOrder]));
  const sections = [...setup.sections].sort(
    (a, b) =>
      (gradeOrder.get(a.gradeId) ?? 0) - (gradeOrder.get(b.gradeId) ?? 0) ||
      a.gradeLabel.localeCompare(b.gradeLabel) ||
      a.sectionLabel.localeCompare(b.sectionLabel),
  );
  const otherYears = setup.academicYears.filter((year) => year.id !== yearId);
  return (
    <section className="panel" aria-labelledby="sections-heading">
      <div className="pn-head">
        <div>
          <h2 id="sections-heading">Sections</h2>
          <p className="sub">Sections belong to one academic year. Activate a section before it can hold enrollments, timetables and results.</p>
        </div>
        <div className={styles.panelActions}>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setCreatePanel(createPanel === "section" ? null : "section"); setAction(null); }}>
            Add section
          </button>
        </div>
      </div>
      <div className="pn-body flush">
        {createPanel === "section" ? (
          <div className={styles.detailPanel}>
            <h3 className={styles.detailHeading}>Add section</h3>
            <SectionForm
              grades={setup.grades}
              busy={busy}
              onCancel={() => setCreatePanel(null)}
              onSubmit={async (input, reason) => {
                if (yearId === null) return;
                await runWrite(
                  () => schoolSetupService.createSection({ academicYearId: yearId, ...input, reason }),
                  (section) => `${section.gradeLabel} · ${section.sectionLabel} created as planned.`,
                );
              }}
            />
          </div>
        ) : null}
        {sections.length === 0 ? (
          <div className={`workspace-state ${styles.statePad}`}>
            <p className="workspace-state-title">No sections this year</p>
            <p className="workspace-state-note">
              {otherYears.length > 0 ? "Copy the class structure from another year, or add sections one at a time." : "Add a section above."}
            </p>
            {otherYears.length > 0 ? (
              createPanel === "copy" ? (
                <CopySectionsForm
                  years={otherYears}
                  busy={busy}
                  onCancel={() => setCreatePanel(null)}
                  onSubmit={async (sourceYearId, reason) => {
                    if (yearId === null) return;
                    await runWrite(
                      () => schoolSetupService.copySectionsFromYear({ sourceYearId, targetYearId: yearId, reason }),
                      (created) => `Copied ${created.length} ${created.length === 1 ? "section" : "sections"} as planned.`,
                    );
                  }}
                />
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreatePanel("copy")}>
                  Copy sections from another year
                </button>
              )
            ) : null}
          </div>
        ) : (
          <div className="table-wrap" role="region" aria-label="Sections for the selected year" tabIndex={0}>
            <table className={`ledger ${styles.table}`}>
              <caption className="sr-only">Sections for the selected academic year with status, enrolment and exam counts</caption>
              <thead>
                <tr>
                  <th scope="col">Section</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Enrolled</th>
                  <th scope="col" className="num">Exams</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <SectionRow
                    key={section.id}
                    section={section}
                    action={action}
                    busy={busy}
                    onOpen={(status, label) => setAction({ kind: "section-status", id: section.id, status, label })}
                    onCancel={() => setAction(null)}
                    onSubmit={async (status, label, reason) => {
                      await runWrite(
                        () => schoolSetupService.setSectionStatus({ id: section.id, status, reason }),
                        () => `${section.gradeLabel} · ${section.sectionLabel} is now ${status}.`,
                      );
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function SectionRow({
  section,
  action,
  busy,
  onOpen,
  onCancel,
  onSubmit,
}: {
  section: SetupSection;
  action: PendingAction;
  busy: boolean;
  onOpen: (status: SetupSectionStatus, label: string) => void;
  onCancel: () => void;
  onSubmit: (status: SetupSectionStatus, label: string, reason: string) => Promise<void>;
}) {
  const open = action?.kind === "section-status" && action.id === section.id ? action : null;
  return (
    <>
      <tr>
        <td>
          <strong>{section.gradeLabel} · {section.sectionLabel}</strong>
          <span className={styles.secondary}>{section.ref}</span>
          {section.status === "planned" ? (
            <span className={styles.secondary}>Activate to use in enrollments, timetables and results.</span>
          ) : null}
        </td>
        <td><StatusBadge tone={SECTION_TONE[section.status]}>{section.status}</StatusBadge></td>
        <td className="num">{section.enrollmentCount}</td>
        <td className="num">{section.examCount}</td>
        <td>
          {open === null ? (
            <div className={styles.actions}>
              {SECTION_TRANSITIONS[section.status].map((transition) => {
                const blocked = transition.status === "archived" && section.enrollmentCount > 0;
                return (
                  <button
                    key={transition.status}
                    type="button"
                    className={`btn btn-sm ${transition.status === "archived" ? "btn-danger" : "btn-ghost"}`}
                    disabled={blocked}
                    title={blocked ? "Section still has active enrollments" : undefined}
                    onClick={() => onOpen(transition.status, transition.label)}
                  >
                    {transition.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </td>
      </tr>
      {open !== null ? (
        <tr>
          <td colSpan={5} className={styles.detailCell}>
            <div className={styles.detailPanel}>
              <ReasonForm
                id={`section-${section.id}`}
                submitLabel={`${open.label} ${section.gradeLabel} · ${section.sectionLabel}`}
                busy={busy}
                danger={open.status === "archived"}
                onCancel={onCancel}
                onSubmit={(reason) => onSubmit(open.status, open.label, reason)}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SectionForm({
  grades,
  busy,
  onSubmit,
  onCancel,
}: {
  grades: SetupGrade[];
  busy: boolean;
  onSubmit: (input: { gradeId: string; sectionLabel: string }, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [gradeId, setGradeId] = useState(grades[0]?.id ?? "");
  const [sectionLabel, setSectionLabel] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <div className={styles.inlineForm}>
      <div className={styles.formGrid}>
        <div className="field">
          <label htmlFor="section-grade">Class</label>
          <select id="section-grade" className="select" value={gradeId} onChange={(event) => setGradeId(event.target.value)}>
            {grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="section-label">Section label</label>
          <input id="section-label" className="input" value={sectionLabel} onChange={(event) => setSectionLabel(event.target.value)} placeholder="A" maxLength={3} />
        </div>
      </div>
      <ReasonField id="section-reason" value={reason} error={fieldError} onChange={(value) => { setReason(value); setFieldError(null); }} />
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || grades.length === 0}
          onClick={() => {
            const clean = reason.trim();
            if (gradeId === "" || sectionLabel.trim() === "") {
              setFieldError("Choose a class and enter a section label.");
              return;
            }
            if (clean.length < 3) {
              setFieldError("Enter a reason of at least 3 characters.");
              return;
            }
            void onSubmit({ gradeId, sectionLabel: sectionLabel.trim() }, clean);
          }}
        >
          {busy ? "Saving…" : "Add section"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function CopySectionsForm({
  years,
  busy,
  onSubmit,
  onCancel,
}: {
  years: SchoolSetup["academicYears"];
  busy: boolean;
  onSubmit: (sourceYearId: string, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [sourceYearId, setSourceYearId] = useState(years[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <div className={styles.inlineForm}>
      <div className="field">
        <label htmlFor="copy-source-year">Copy sections from</label>
        <select id="copy-source-year" className="select" value={sourceYearId} onChange={(event) => setSourceYearId(event.target.value)}>
          {years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
        </select>
      </div>
      <p className={styles.secondary}>Missing class and section pairs arrive as planned; existing pairs are kept.</p>
      <ReasonField id="copy-reason" value={reason} error={fieldError} onChange={(value) => { setReason(value); setFieldError(null); }} />
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || sourceYearId === ""}
          onClick={() => {
            const clean = reason.trim();
            if (clean.length < 3) {
              setFieldError("Enter a reason of at least 3 characters.");
              return;
            }
            void onSubmit(sourceYearId, clean);
          }}
        >
          {busy ? "Copying…" : "Copy sections"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Subjects tab                                                        */
/* ------------------------------------------------------------------ */

function SubjectsPanel({
  setup,
  busy,
  action,
  setAction,
  createPanel,
  setCreatePanel,
  runWrite,
}: {
  setup: SchoolSetup;
  busy: boolean;
  action: PendingAction;
  setAction: (action: PendingAction) => void;
  createPanel: CreatePanel;
  setCreatePanel: (panel: CreatePanel) => void;
  runWrite: <T>(write: () => Promise<T>, announce: (result: T) => string) => Promise<boolean>;
}) {
  const subjects = [...setup.subjects].sort((a, b) => a.code.localeCompare(b.code));
  return (
    <section className="panel" aria-labelledby="subjects-heading">
      <div className="pn-head">
        <div>
          <h2 id="subjects-heading">Subjects</h2>
          <p className="sub">The subject catalog feeds exam components, teaching assignments and imports. Codes are permanent.</p>
        </div>
        <div className={styles.panelActions}>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setCreatePanel(createPanel === "subject" ? null : "subject"); setAction(null); }}>
            Add subject
          </button>
        </div>
      </div>
      <div className="pn-body flush">
        {createPanel === "subject" ? (
          <div className={styles.detailPanel}>
            <h3 className={styles.detailHeading}>Add subject</h3>
            <SubjectForm
              busy={busy}
              onCancel={() => setCreatePanel(null)}
              onSubmit={async (input, reason) => {
                await runWrite(
                  () => schoolSetupService.upsertSubject({ code: input.code, name: input.name, reason }),
                  (subject) => `${subject.name} added to the subject catalog.`,
                );
              }}
            />
          </div>
        ) : null}
        {subjects.length === 0 ? (
          <div className={`workspace-state ${styles.statePad}`}>
            <p className="workspace-state-title">No subjects yet</p>
            <p className="workspace-state-note">Add the first subject above.</p>
          </div>
        ) : (
          <div className="table-wrap" role="region" aria-label="Subject catalog" tabIndex={0}>
            <table className={`ledger ${styles.table}`}>
              <caption className="sr-only">Subjects with code, component usage and reference state</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Name</th>
                  <th scope="col" className="num">Components</th>
                  <th scope="col">Referenced</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((subject) => (
                  <SubjectRow
                    key={subject.id}
                    subject={subject}
                    editing={action?.kind === "subject-edit" && action.id === subject.id}
                    busy={busy}
                    onEdit={() => setAction({ kind: "subject-edit", id: subject.id })}
                    onCancel={() => setAction(null)}
                    onSubmit={async (input, reason) => {
                      await runWrite(
                        () => schoolSetupService.upsertSubject({ id: subject.id, name: input.name, reason }),
                        (saved) => `${saved.name} updated.`,
                      );
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function SubjectRow({
  subject,
  editing,
  busy,
  onEdit,
  onCancel,
  onSubmit,
}: {
  subject: SetupSubject;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: (input: { name: string }, reason: string) => Promise<void>;
}) {
  return (
    <>
      <tr>
        <td className="num">{subject.code}</td>
        <td><strong>{subject.name}</strong></td>
        <td className="num">{subject.componentCount}</td>
        <td>{subject.referenced ? "Referenced" : <span className={styles.secondary}>Not referenced</span>}</td>
        <td>
          {editing ? null : (
            <button type="button" className="btn btn-quiet btn-sm" onClick={onEdit} aria-expanded={false} aria-controls={`subject-edit-${subject.id}`}>
              Rename
            </button>
          )}
        </td>
      </tr>
      {editing ? (
        <tr>
          <td colSpan={5} className={styles.detailCell}>
            <div className={styles.detailPanel} id={`subject-edit-${subject.id}`}>
              <h3 className={styles.detailHeading}>Rename {subject.name}</h3>
              <p className={styles.secondary}>Code <span className="num">{subject.code}</span> is permanent.</p>
              <SubjectForm subject={subject} busy={busy} onCancel={onCancel} onSubmit={onSubmit} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SubjectForm({
  subject,
  busy,
  onSubmit,
  onCancel,
}: {
  subject?: SetupSubject;
  busy: boolean;
  onSubmit: (input: { code: string; name: string }, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(subject?.code ?? "");
  const [name, setName] = useState(subject?.name ?? "");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const uid = subject?.id ?? "new";
  return (
    <div className={styles.inlineForm}>
      <div className={styles.formGrid}>
        {subject === undefined ? (
          <div className="field">
            <label htmlFor={`subject-code-${uid}`}>Code</label>
            <input id={`subject-code-${uid}`} className="input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="HIN" maxLength={20} />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={`subject-name-${uid}`}>Name</label>
          <input id={`subject-name-${uid}`} className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Hindi" />
        </div>
      </div>
      <ReasonField id={`subject-reason-${uid}`} value={reason} error={fieldError} onChange={(value) => { setReason(value); setFieldError(null); }} />
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => {
            const clean = reason.trim();
            if (name.trim() === "" || (subject === undefined && code.trim() === "")) {
              setFieldError("Enter a name and a code.");
              return;
            }
            if (clean.length < 3) {
              setFieldError("Enter a reason of at least 3 characters.");
              return;
            }
            void onSubmit({ code: code.trim(), name: name.trim() }, clean);
          }}
        >
          {busy ? "Saving…" : subject === undefined ? "Add subject" : "Save subject"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Exams tab                                                           */
/* ------------------------------------------------------------------ */

function ExamsPanel({
  setup,
  yearId,
  busy,
  action,
  setAction,
  createPanel,
  setCreatePanel,
  runWrite,
}: {
  setup: SchoolSetup;
  yearId: string | null;
  busy: boolean;
  action: PendingAction;
  setAction: (action: PendingAction) => void;
  createPanel: CreatePanel;
  setCreatePanel: (panel: CreatePanel) => void;
  runWrite: <T>(write: () => Promise<T>, announce: (result: T) => string) => Promise<boolean>;
}) {
  const terms = new Map<string, SetupExam[]>();
  for (const exam of setup.exams) {
    const list = terms.get(exam.term) ?? [];
    list.push(exam);
    terms.set(exam.term, list);
  }
  const termNames = [...terms.keys()].sort((a, b) => a.localeCompare(b));
  return (
    <section className="panel" aria-labelledby="exams-heading">
      <div className="pn-head">
        <div>
          <h2 id="exams-heading">Exam terms and components</h2>
          <p className="sub">An exam term creates one definition per chosen class section, each with its marking components.</p>
        </div>
        <div className={styles.panelActions}>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setCreatePanel(createPanel === "exam-term" ? null : "exam-term"); setAction(null); }}>
            New exam term
          </button>
        </div>
      </div>
      <div className="pn-body flush">
        {createPanel === "exam-term" && yearId !== null ? (
          <div className={styles.detailPanel}>
            <h3 className={styles.detailHeading}>New exam term</h3>
            <ExamTermWizard
              sections={setup.sections}
              subjects={setup.subjects}
              busy={busy}
              onCancel={() => setCreatePanel(null)}
              onSubmit={async (input, reason) => {
                await runWrite(
                  () => schoolSetupService.createExamTerm({ academicYearId: yearId, ...input, reason }),
                  (result) => {
                    const created = `Created ${result.created.length} ${result.created.length === 1 ? "exam" : "exams"}${result.created.length > 0 ? ` (${result.created.join(", ")})` : ""}`;
                    const skipped = result.skipped.length > 0 ? ` · skipped ${result.skipped.length} already configured (${result.skipped.join(", ")})` : "";
                    return `${created}${skipped}.`;
                  },
                );
              }}
            />
          </div>
        ) : null}
        {setup.exams.length === 0 ? (
          <div className={`workspace-state ${styles.statePad}`}>
            <p className="workspace-state-title">No exam terms this year</p>
            <p className="workspace-state-note">Create an exam term to schedule assessments for the year&rsquo;s sections.</p>
          </div>
        ) : (
          termNames.map((term) => (
            <div key={term}>
              <h3 className={styles.termHeading}>
                {term} <span>· {terms.get(term)?.length ?? 0} {(terms.get(term)?.length ?? 0) === 1 ? "section" : "sections"}</span>
              </h3>
              <div className="table-wrap" role="region" aria-label={`Exam definitions for ${term}`} tabIndex={0}>
                <table className={`ledger ${styles.tableWide}`}>
                  <caption className="sr-only">Exam definitions for {term} with status and component counts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Class section</th>
                      <th scope="col">Reference</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="num">Components</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(terms.get(term) ?? []).map((exam) => (
                      <ExamRow
                        key={exam.id}
                        exam={exam}
                        subjects={setup.subjects}
                        action={action}
                        busy={busy}
                        createPanel={createPanel}
                        setCreatePanel={setCreatePanel}
                        onOpen={(status, label) => setAction({ kind: "exam-status", id: exam.id, status, label })}
                        onCancel={() => setAction(null)}
                        onSubmit={async (status, label, reason) => {
                          await runWrite(
                            () => schoolSetupService.setExamStatus({ id: exam.id, status, reason }),
                            () => `${exam.sectionLabel} ${exam.term} is now ${status}.`,
                          );
                        }}
                        runWrite={runWrite}
                        setAction={setAction}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ExamRow({
  exam,
  subjects,
  action,
  busy,
  createPanel,
  setCreatePanel,
  onOpen,
  onCancel,
  onSubmit,
  runWrite,
  setAction,
}: {
  exam: SetupExam;
  subjects: SetupSubject[];
  action: PendingAction;
  busy: boolean;
  createPanel: CreatePanel;
  setCreatePanel: (panel: CreatePanel) => void;
  onOpen: (status: SetupExamStatus, label: string) => void;
  onCancel: () => void;
  onSubmit: (status: SetupExamStatus, label: string, reason: string) => Promise<void>;
  runWrite: <T>(write: () => Promise<T>, announce: (result: T) => string) => Promise<boolean>;
  setAction: (action: PendingAction) => void;
}) {
  const open = action?.kind === "exam-status" && action.id === exam.id ? action : null;
  const componentsOpen = createPanel === `component:${exam.id}`;
  const closed = exam.status === "closed";
  return (
    <>
      <tr>
        <td><strong>{exam.sectionLabel}</strong></td>
        <td className="num">{exam.ref}</td>
        <td><StatusBadge tone={EXAM_TONE[exam.status]}>{exam.status}</StatusBadge></td>
        <td className="num">{exam.components.length}</td>
        <td>
          <div className={styles.actions}>
            {EXAM_TRANSITIONS[exam.status].map((transition) => (
              <button
                key={transition.status}
                type="button"
                className={`btn btn-sm ${transition.status === "closed" ? "btn-danger" : "btn-ghost"}`}
                onClick={() => onOpen(transition.status, transition.label)}
              >
                {transition.label}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => { setCreatePanel(componentsOpen ? null : `component:${exam.id}`); setAction(null); }}
              aria-expanded={componentsOpen}
              aria-controls={`exam-components-${exam.id}`}
            >
              {componentsOpen ? "Close components" : "Components"}
            </button>
          </div>
        </td>
      </tr>
      {open !== null ? (
        <tr>
          <td colSpan={5} className={styles.detailCell}>
            <div className={styles.detailPanel}>
              <ReasonForm
                id={`exam-${exam.id}`}
                submitLabel={`${open.label} ${exam.sectionLabel} ${exam.term}`}
                busy={busy}
                danger={open.status === "closed"}
                onCancel={onCancel}
                onSubmit={(reason) => onSubmit(open.status, open.label, reason)}
              />
            </div>
          </td>
        </tr>
      ) : null}
      {componentsOpen ? (
        <tr>
          <td colSpan={5} className={styles.detailCell}>
            <div className={styles.detailPanel} id={`exam-components-${exam.id}`}>
              <h3 className={styles.detailHeading}>Marking components · {exam.sectionLabel} {exam.term}</h3>
              <ComponentsEditor
                exam={exam}
                subjects={subjects}
                action={action}
                setAction={setAction}
                busy={busy}
                closed={closed}
                runWrite={runWrite}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ComponentsEditor({
  exam,
  subjects,
  action,
  setAction,
  busy,
  closed,
  runWrite,
}: {
  exam: SetupExam;
  subjects: SetupSubject[];
  action: PendingAction;
  setAction: (action: PendingAction) => void;
  busy: boolean;
  closed: boolean;
  runWrite: <T>(write: () => Promise<T>, announce: (result: T) => string) => Promise<boolean>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const lockedNote = closed ? "Exam is closed" : "Marks already entered";
  const unusedSubjects = subjects.filter((subject) => !exam.components.some((component) => component.subjectId === subject.id));
  return (
    <>
      {exam.components.length === 0 ? (
        <p className={styles.secondary}>No components yet · add one below.</p>
      ) : (
        <div className="table-wrap" role="region" aria-label={`Components for ${exam.sectionLabel} ${exam.term}`} tabIndex={0}>
          <table className={`ledger ${styles.componentTable}`}>
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Component</th>
                <th scope="col" className="num">Max marks</th>
                <th scope="col" className="num">Batches</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {exam.components.map((component) => {
                const locked = closed || component.batchCount > 0;
                const editing = action?.kind === "component-edit" && action.id === component.id;
                const deleting = action?.kind === "component-delete" && action.id === component.id;
                return (
                  <ComponentRow
                    key={component.id}
                    exam={exam}
                    component={component}
                    locked={locked}
                    lockedNote={lockedNote}
                    editing={editing}
                    deleting={deleting}
                    busy={busy}
                    onEdit={() => setAction({ kind: "component-edit", examId: exam.id, id: component.id })}
                    onDelete={() => setAction({ kind: "component-delete", examId: exam.id, id: component.id })}
                    onCancel={() => setAction(null)}
                    runWrite={runWrite}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {addOpen && !closed ? (
        <ComponentAddForm
          exam={exam}
          subjects={unusedSubjects}
          busy={busy}
          onCancel={() => setAddOpen(false)}
          onDone={() => setAddOpen(false)}
          runWrite={runWrite}
        />
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={closed || unusedSubjects.length === 0}
            title={closed ? "Exam is closed" : unusedSubjects.length === 0 ? "Every subject already has a component" : undefined}
            onClick={() => { setAddOpen(true); setAction(null); }}
          >
            Add component
          </button>
        </div>
      )}
    </>
  );
}

function ComponentRow({
  exam,
  component,
  locked,
  lockedNote,
  editing,
  deleting,
  busy,
  onEdit,
  onDelete,
  onCancel,
  runWrite,
}: {
  exam: SetupExam;
  component: SetupComponent;
  locked: boolean;
  lockedNote: string;
  editing: boolean;
  deleting: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCancel: () => void;
  runWrite: <T>(write: () => Promise<T>, announce: (result: T) => string) => Promise<boolean>;
}) {
  return (
    <>
      <tr>
        <td><strong>{component.subjectName}</strong><span className={styles.secondary}>{component.subjectCode}</span></td>
        <td>{component.name}</td>
        <td className="num">{component.maxMarks}</td>
        <td className="num">{component.batchCount}</td>
        <td>
          {editing || deleting ? null : (
            <div className={styles.actions}>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={locked}
                title={locked ? lockedNote : undefined}
                onClick={onEdit}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={locked}
                title={locked ? lockedNote : undefined}
                onClick={onDelete}
              >
                Remove
              </button>
            </div>
          )}
        </td>
      </tr>
      {editing ? (
        <tr>
          <td colSpan={5} className={styles.detailCell}>
            <div className={styles.detailPanel}>
              <ComponentEditForm
                component={component}
                busy={busy}
                onCancel={onCancel}
                onSubmit={async (input, reason) => {
                  await runWrite(
                    () => schoolSetupService.upsertComponent({ examDefinitionId: exam.id, subjectId: component.subjectId, ...input, reason }),
                    (saved) => `${saved.subjectName} component updated.`,
                  );
                }}
              />
            </div>
          </td>
        </tr>
      ) : null}
      {deleting ? (
        <tr>
          <td colSpan={5} className={styles.detailCell}>
            <div className={styles.detailPanel}>
              <ReasonForm
                id={`component-delete-${component.id}`}
                submitLabel={`Remove ${component.name}`}
                note={`Removes the ${component.subjectName} component from ${exam.sectionLabel} ${exam.term}.`}
                busy={busy}
                danger
                onCancel={onCancel}
                onSubmit={async (reason) => {
                  await runWrite(
                    () => schoolSetupService.deleteComponent({ id: component.id, reason }),
                    () => `${component.subjectName} component removed from ${exam.sectionLabel} ${exam.term}.`,
                  );
                }}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ComponentEditForm({
  component,
  busy,
  onSubmit,
  onCancel,
}: {
  component: SetupComponent;
  busy: boolean;
  onSubmit: (input: { name: string; maxMarks: number }, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(component.name);
  const [maxMarks, setMaxMarks] = useState(String(component.maxMarks));
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <div className={styles.inlineForm}>
      <div className={styles.formGrid}>
        <div className="field">
          <label htmlFor={`component-name-${component.id}`}>Component name</label>
          <input id={`component-name-${component.id}`} className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`component-marks-${component.id}`}>Max marks</label>
          <input id={`component-marks-${component.id}`} className={`input ${styles.marksInput}`} type="number" min={1} max={1000} value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} />
        </div>
      </div>
      <ReasonField id={`component-reason-${component.id}`} value={reason} error={fieldError} onChange={(value) => { setReason(value); setFieldError(null); }} />
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => {
            const clean = reason.trim();
            const marks = Number(maxMarks);
            if (name.trim() === "" || !Number.isFinite(marks) || marks <= 0) {
              setFieldError("Enter a component name and positive maximum marks.");
              return;
            }
            if (clean.length < 3) {
              setFieldError("Enter a reason of at least 3 characters.");
              return;
            }
            void onSubmit({ name: name.trim(), maxMarks: marks }, clean);
          }}
        >
          {busy ? "Saving…" : "Save component"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

function ComponentAddForm({
  exam,
  subjects,
  busy,
  onCancel,
  onDone,
  runWrite,
}: {
  exam: SetupExam;
  subjects: SetupSubject[];
  busy: boolean;
  onCancel: () => void;
  onDone: () => void;
  runWrite: <T>(write: () => Promise<T>, announce: (result: T) => string) => Promise<boolean>;
}) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [name, setName] = useState("Theory");
  const [maxMarks, setMaxMarks] = useState("100");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <div className={styles.inlineForm}>
      <h4 className={styles.detailHeading}>Add component</h4>
      <div className={styles.formGrid}>
        <div className="field">
          <label htmlFor={`component-add-subject-${exam.id}`}>Subject</label>
          <select id={`component-add-subject-${exam.id}`} className="select" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`component-add-name-${exam.id}`}>Component name</label>
          <input id={`component-add-name-${exam.id}`} className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`component-add-marks-${exam.id}`}>Max marks</label>
          <input id={`component-add-marks-${exam.id}`} className={`input ${styles.marksInput}`} type="number" min={1} max={1000} value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} />
        </div>
      </div>
      <ReasonField id={`component-add-reason-${exam.id}`} value={reason} error={fieldError} onChange={(value) => { setReason(value); setFieldError(null); }} />
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || subjectId === ""}
          onClick={() => {
            const clean = reason.trim();
            const marks = Number(maxMarks);
            if (name.trim() === "" || !Number.isFinite(marks) || marks <= 0) {
              setFieldError("Enter a component name and positive maximum marks.");
              return;
            }
            if (clean.length < 3) {
              setFieldError("Enter a reason of at least 3 characters.");
              return;
            }
            void runWrite(
              () => schoolSetupService.upsertComponent({ examDefinitionId: exam.id, subjectId, name: name.trim(), maxMarks: marks, reason: clean }),
              (saved) => `${saved.subjectName} component added.`,
            ).then((saved) => { if (saved) onDone(); });
          }}
        >
          {busy ? "Saving…" : "Add component"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Exam term wizard                                                    */
/* ------------------------------------------------------------------ */

function ExamTermWizard({
  sections,
  subjects,
  busy,
  onSubmit,
  onCancel,
}: {
  sections: SetupSection[];
  subjects: SetupSubject[];
  busy: boolean;
  onSubmit: (input: { term: string; gradeSectionIds: string[]; components: ExamComponentInput[] }, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const eligible = sections.filter((section) => section.status === "active" || section.status === "planned");
  const [term, setTerm] = useState("");
  const [checkedSections, setCheckedSections] = useState<ReadonlySet<string>>(new Set());
  const [checkedSubjects, setCheckedSubjects] = useState<ReadonlySet<string>>(new Set());
  const [componentNames, setComponentNames] = useState<Record<string, string>>({});
  const [componentMarks, setComponentMarks] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  function toggle(set: ReadonlySet<string>, id: string, apply: (next: ReadonlySet<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  function toggleSubject(id: string) {
    toggle(checkedSubjects, id, setCheckedSubjects);
    if (!checkedSubjects.has(id)) {
      setComponentNames((current) => ({ ...current, [id]: current[id] ?? "Theory" }));
      setComponentMarks((current) => ({ ...current, [id]: current[id] ?? "100" }));
    }
  }

  return (
    <div className={styles.inlineForm}>
      <div className="field">
        <label htmlFor="exam-term-name">Term name</label>
        <input id="exam-term-name" className="input" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="unit test 1" />
      </div>

      <fieldset className={styles.fieldSet}>
        <legend>Class sections</legend>
        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => setCheckedSections(new Set(eligible.filter((section) => section.status === "active").map((section) => section.id)))}
          >
            Select all active
          </button>
        </div>
        {eligible.length === 0 ? (
          <p className={styles.secondary}>No planned or active sections this year · add or activate sections first.</p>
        ) : (
          <div className={`${styles.checkList} y-scroll`}>
            {eligible.map((section) => (
              <label key={section.id} className={styles.checkItem}>
                <input
                  type="checkbox"
                  checked={checkedSections.has(section.id)}
                  onChange={() => toggle(checkedSections, section.id, setCheckedSections)}
                />
                <span>{section.gradeLabel} · {section.sectionLabel}</span>
                <StatusBadge tone={SECTION_TONE[section.status]}>{section.status}</StatusBadge>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className={styles.fieldSet}>
        <legend>Subjects and components</legend>
        <p className={styles.secondary}>Each chosen subject becomes a component on every new exam definition.</p>
        <div className={`${styles.checkList} y-scroll`}>
          {subjects.map((subject) => {
            const checked = checkedSubjects.has(subject.id);
            return (
              <div key={subject.id} className={styles.checkItem}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSubject(subject.id)}
                  aria-label={`Include ${subject.name}`}
                />
                <span>{subject.name}</span>
                {checked ? (
                  <span className={styles.checkFields}>
                    <label htmlFor={`wizard-name-${subject.id}`} className="sr-only">Component name for {subject.name}</label>
                    <input
                      id={`wizard-name-${subject.id}`}
                      className="input"
                      value={componentNames[subject.id] ?? "Theory"}
                      onChange={(event) => setComponentNames((current) => ({ ...current, [subject.id]: event.target.value }))}
                      placeholder="Component name"
                    />
                    <label htmlFor={`wizard-marks-${subject.id}`} className="sr-only">Maximum marks for {subject.name}</label>
                    <input
                      id={`wizard-marks-${subject.id}`}
                      className={`input ${styles.marksInput}`}
                      type="number"
                      min={1}
                      max={1000}
                      value={componentMarks[subject.id] ?? "100"}
                      onChange={(event) => setComponentMarks((current) => ({ ...current, [subject.id]: event.target.value }))}
                    />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      <ReasonField id="exam-term-reason" value={reason} error={fieldError} onChange={(value) => { setReason(value); setFieldError(null); }} />
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => {
            const clean = reason.trim();
            const components: ExamComponentInput[] = subjects
              .filter((subject) => checkedSubjects.has(subject.id))
              .map((subject) => ({
                subjectId: subject.id,
                name: (componentNames[subject.id] ?? "Theory").trim() || "Theory",
                maxMarks: Number(componentMarks[subject.id] ?? "100"),
              }));
            if (term.trim().length < 2) {
              setFieldError("Enter a term name of at least 2 characters.");
              return;
            }
            if (checkedSections.size === 0) {
              setFieldError("Choose at least one class section.");
              return;
            }
            if (components.length === 0 || components.some((component) => !Number.isFinite(component.maxMarks) || component.maxMarks <= 0)) {
              setFieldError("Choose at least one subject and enter positive maximum marks.");
              return;
            }
            if (clean.length < 3) {
              setFieldError("Enter a reason of at least 3 characters.");
              return;
            }
            void onSubmit({ term: term.trim(), gradeSectionIds: [...checkedSections], components }, clean);
          }}
        >
          {busy ? "Creating…" : "Create exam term"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
