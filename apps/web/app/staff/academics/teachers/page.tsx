"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { teachingStaffService, type TeachingStaffRecord } from "@/modules/services/teaching-staff";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { schoolConfigService } from "@/modules/services/school-config";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./page.module.css";

type Errors = { displayName?: string; title?: string; reason?: string; assignment?: string };

/**
 * Teaching staff workspace (Principal): non-login teacher records and their
 * class/subject assignments. Creating or editing these records never creates
 * an auth identity, user account, or role grant — teachers are school
 * records used for timetable attribution and conflict checks.
 */
export default function TeachingStaffWorkspace() {
  const { summary } = useStaffContext();
  const canManage = canAnyRole(summary?.roles ?? [], "timetable.manage");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [rows, setRows] = useState<TeachingStaffRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [sections, setSections] = useState<Array<{ id: string; label: string; academicYearId: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [assignSection, setAssignSection] = useState("");
  const [assignSubject, setAssignSubject] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endReason, setEndReason] = useState("");
  const [endError, setEndError] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setRows(await teachingStaffService.listTeachingStaff());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Teaching staff could not be loaded.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void schoolConfigService.getConfiguration().then((config) => {
      setSections(config.gradeSections.filter((section) => section.status === "active").map((section) => ({
        id: section.id,
        label: `${section.gradeLabel}-${section.sectionLabel}`,
        academicYearId: section.academicYearId,
      })));
      setSubjects(config.subjects.map((subject) => ({ id: subject.id, name: subject.name })));
    }).catch(() => {});
  }, [refresh]);

  const stats = useMemo(() => {
    if (rows === null) return null;
    const assignments = rows.flatMap((row) => row.assignments);
    return {
      teachers: rows.length,
      active: assignments.filter((assignment) => assignment.status === "active").length,
      ended: assignments.filter((assignment) => assignment.status === "ended").length,
    };
  }, [rows]);

  function announce(text: string) {
    setNotice(text);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Errors = {
      displayName: displayName.trim().length >= 2 ? undefined : "Enter the teacher's display name.",
      title: title.trim() ? undefined : "Enter the job title.",
      reason: reason.trim().length >= 3 ? undefined : "A reason is required for the audit trail.",
    };
    setErrors(next);
    if (Object.values(next).some((value) => value !== undefined)) return;
    setBusy(true);
    try {
      const created = await teachingStaffService.createTeachingStaff({
        displayName: displayName.trim(),
        title: title.trim(),
        reason: reason.trim(),
      });
      setCreateOpen(false);
      setDisplayName("");
      setTitle("");
      setReason("");
      announce(`Teaching record ${created.ref} created · no login account was issued.`);
      await refresh();
    } catch (error) {
      setErrors({ reason: error instanceof Error ? error.message : "The record could not be created." });
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(staffMemberId: string) {
    const section = sections.find((candidate) => candidate.id === assignSection);
    const next: Errors = {
      assignment:
        assignSection === "" ? "Choose the class and section."
        : assignSubject === "" ? "Choose the subject."
          : assignReason.trim().length < 3 ? "A reason is required for the audit trail."
            : undefined,
    };
    setErrors(next);
    if (next.assignment !== undefined || section === undefined) return;
    setBusy(true);
    try {
      const created = await teachingStaffService.createAssignment({
        staffMemberId,
        academicYearId: section.academicYearId,
        gradeSectionId: section.id,
        subjectId: assignSubject,
        reason: assignReason.trim(),
      });
      setAssignFor(null);
      setAssignSection("");
      setAssignSubject("");
      setAssignReason("");
      announce(`Assignment ${created.ref} recorded.`);
      await refresh();
    } catch (error) {
      setErrors({ assignment: error instanceof Error ? error.message : "The assignment could not be created." });
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd(assignmentId: string) {
    const cleanReason = endReason.trim();
    if (cleanReason.length < 3) {
      setEndError(true);
      return;
    }
    setEndError(false);
    setBusy(true);
    try {
      const row = rows?.flatMap((candidate) => candidate.assignments.map((assignment) => ({ staffMemberId: candidate.staffMemberId, assignment })))
        .find((entry) => entry.assignment.id === assignmentId);
      await teachingStaffService.endAssignment({
        assignmentId,
        reason: cleanReason,
        expectedVersion: row?.assignment.version ?? 1,
      });
      setEndingId(null);
      setEndReason("");
      announce("Assignment ended · history is preserved.");
      await refresh();
    } catch (error) {
      announce(error instanceof Error ? error.message : "The assignment could not be ended.");
    } finally {
      setBusy(false);
    }
  }

  function renderTeacherRows(row: TeachingStaffRecord): ReactNode[] {
    const rendered: ReactNode[] = [];
    const assignments = row.assignments;

    if (assignments.length === 0) {
      rendered.push(
        <tr key={`${row.staffMemberId}-empty`}>
          <td className={styles.name}>{row.displayName}</td>
          <td>{row.title}</td>
          <td><span className={styles.muted}>No assignments</span></td>
          <td>—</td>
          <td className={styles.actionCell}>
            {canManage ? (
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setAssignFor(row.staffMemberId); setErrors({}); }}
                  disabled={busy}
                >
                  Add assignment
                </button>
              </div>
            ) : (
              <span className={styles.muted}>Read only</span>
            )}
          </td>
        </tr>,
      );
    } else {
      assignments.forEach((assignment, index) => {
        const tone = assignment.status === "active" ? "good" : assignment.status === "scheduled" ? "watch" : "neutral";
        rendered.push(
          <tr key={assignment.id} className={index === 0 ? styles.groupStart : undefined}>
            <td className={styles.name}>
              {index === 0 ? row.displayName : <span className={styles.continuation} aria-hidden="true">—</span>}
            </td>
            <td>
              {index === 0 ? row.title : <span className={styles.continuation} aria-hidden="true">—</span>}
            </td>
            <td>
              <span className={styles.assignmentLabel}>
                {assignment.gradeLabel ?? "—"}-{assignment.sectionLabel ?? "—"} · {assignment.subjectName ?? "—"}
              </span>
              <span className={`num ${styles.assignmentRef}`}>{assignment.ref}</span>
            </td>
            <td>
              <StatusBadge tone={tone}>{assignment.status}</StatusBadge>
            </td>
            <td className={styles.actionCell}>
              <div className={styles.rowActions}>
                {index === 0 && canManage ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setAssignFor(row.staffMemberId); setErrors({}); }}
                    disabled={busy}
                  >
                    Add assignment
                  </button>
                ) : null}
                {canManage && assignment.status !== "ended" ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setEndingId(assignment.id); setEndReason(""); setEndError(false); }}
                    disabled={busy}
                  >
                    End
                  </button>
                ) : null}
              </div>
            </td>
          </tr>,
        );

        if (endingId === assignment.id) {
          rendered.push(
            <tr key={`end-${assignment.id}`}>
              <td colSpan={5} className={styles.formCell}>
                <div className={styles.inlineForm}>
                  <p className={styles.formTitle}>End assignment {assignment.ref}</p>
                  <div className={styles.formGrid}>
                    <div className={`field ${styles.formGridFull}`}>
                      <label htmlFor={`end-reason-${assignment.id}`}>Reason (recorded in audit trail)</label>
                      <input
                        id={`end-reason-${assignment.id}`}
                        className="input"
                        type="text"
                        value={endReason}
                        onChange={(event) => { setEndReason(event.target.value); setEndError(false); }}
                        aria-invalid={endError}
                      />
                      {endError ? <p className="field-error">A reason is required.</p> : null}
                    </div>
                  </div>
                  <div className={styles.formActionsInline}>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => void handleEnd(assignment.id)} disabled={busy}>
                      {busy ? "Ending…" : "Confirm end"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => { setEndingId(null); setEndReason(""); }}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </td>
            </tr>,
          );
        }
      });
    }

    if (assignFor === row.staffMemberId) {
      rendered.push(
        <tr key={`assign-${row.staffMemberId}`}>
          <td colSpan={5} className={styles.formCell}>
            <div className={styles.inlineForm}>
              <p className={styles.formTitle}>Add assignment for {row.displayName}</p>
              <div className={styles.formGrid}>
                <div className="field">
                  <label htmlFor={`assign-section-${row.staffMemberId}`}>Class and section</label>
                  <select
                    id={`assign-section-${row.staffMemberId}`}
                    className="select"
                    value={assignSection}
                    onChange={(event) => setAssignSection(event.target.value)}
                  >
                    <option value="">Choose class…</option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>{section.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`assign-subject-${row.staffMemberId}`}>Subject</label>
                  <select
                    id={`assign-subject-${row.staffMemberId}`}
                    className="select"
                    value={assignSubject}
                    onChange={(event) => setAssignSubject(event.target.value)}
                  >
                    <option value="">Choose subject…</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>{subject.name}</option>
                    ))}
                  </select>
                </div>
                <div className={`field ${styles.formGridFull}`}>
                  <label htmlFor={`assign-reason-${row.staffMemberId}`}>Reason (recorded in audit trail)</label>
                  <input
                    id={`assign-reason-${row.staffMemberId}`}
                    className="input"
                    type="text"
                    value={assignReason}
                    onChange={(event) => setAssignReason(event.target.value)}
                  />
                  {errors.assignment ? <p className="field-error">{errors.assignment}</p> : null}
                </div>
              </div>
              <div className={styles.formActionsInline}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleAssign(row.staffMemberId)} disabled={busy}>
                  {busy ? "Recording…" : "Record assignment"}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => { setAssignFor(null); setErrors({}); }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>,
      );
    }

    return rendered;
  }

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1>Teaching staff</h1>
          <p className="ph-sub">
            Non-login teacher records for timetable attribution and conflict checks. These records never receive a
            portal account or role grant.
          </p>
        </div>
        <div className="ph-actions">
          <Button variant="primary" onClick={() => { setCreateOpen(true); setErrors({}); }} disabled={!canManage}>
            Add teaching record
          </Button>
          {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
        </div>
      </div>

      {stats !== null ? (
        <div className={styles.summaryStrip} aria-label="Teaching staff summary">
          <div className={styles.summaryCell}>
            <span className={styles.summaryLabel}>Teachers</span>
            <span className={styles.summaryValue}>{stats.teachers}</span>
          </div>
          <div className={styles.summaryCell}>
            <span className={styles.summaryLabel}>Active assignments</span>
            <span className={styles.summaryValue}>{stats.active}</span>
          </div>
          <div className={styles.summaryCell}>
            <span className={styles.summaryLabel}>Ended (on file)</span>
            <span className={styles.summaryValue}>{stats.ended}</span>
          </div>
        </div>
      ) : null}

      {loadError ? <p className={styles.errorNote} role="alert">{loadError}</p> : null}
      {notice ? <p className={styles.liveNote} role="status" aria-live="polite">{notice}</p> : null}

      {createOpen && (
        <form className={styles.form} onSubmit={handleCreate} noValidate>
          <div className="field">
            <label htmlFor="teacher-name">Display name</label>
            <input id="teacher-name" className="input" type="text" value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={errors.displayName !== undefined}
              aria-describedby={errors.displayName ? "teacher-name-error" : undefined} />
            {errors.displayName ? <p className="field-error" id="teacher-name-error">{errors.displayName}</p> : null}
          </div>
          <div className="field">
            <label htmlFor="teacher-title">Job title</label>
            <input id="teacher-title" className="input" type="text" value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={errors.title !== undefined}
              aria-describedby={errors.title ? "teacher-title-error" : undefined} />
            {errors.title ? <p className="field-error" id="teacher-title-error">{errors.title}</p> : null}
          </div>
          <div className="field">
            <label htmlFor="teacher-reason">Reason (recorded in audit trail)</label>
            <input id="teacher-reason" className="input" type="text" value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={errors.reason !== undefined}
              aria-describedby={errors.reason ? "teacher-reason-error" : undefined} />
            {errors.reason ? <p className="field-error" id="teacher-reason-error">{errors.reason}</p> : null}
          </div>
          <div className={styles.formActions}>
            <Button variant="primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create record"}</Button>
            <Button variant="quiet" type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</Button>
          </div>
        </form>
      )}

      <div className="table--scroll">
        {rows === null ? (
          <p className={styles.loading} role="status">Loading teaching staff…</p>
        ) : rows.length === 0 ? (
          <div className="workspace-state">
            <p className="workspace-state-title">No teaching records</p>
            <p className="workspace-state-note">Add a non-login teaching record to build the timetable roster.</p>
          </div>
        ) : (
          <section className="panel">
            <div className="pn-head">
              <div>
                <h2>Teaching records</h2>
                <p className="sub">One row per class and subject assignment</p>
              </div>
            </div>
            <div className="pn-body flush">
              <table className={`ledger ${styles.table}`}>
                <caption className="sr-only">Non-login teaching staff with class and subject assignments</caption>
                <thead>
                  <tr>
                    <th scope="col">Teacher</th>
                    <th scope="col">Title</th>
                    <th scope="col">Assignment</th>
                    <th scope="col">Status</th>
                    <th scope="col" className={styles.actionHead}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.flatMap((row) => renderTeacherRows(row))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <div className="callout">
        <span className="msym" aria-hidden="true">person_off</span>
        <span className="small">
          Teaching records are school data only: no sign-in identity is created and no role grant is issued. Timetable
          periods and conflict checks reference these assignments; historical legacy assignments remain on file.
        </span>
      </div>
    </div>
  );
}
