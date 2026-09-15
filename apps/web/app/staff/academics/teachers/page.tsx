"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

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
      setSections(config.gradeSections.map((section) => ({
        id: section.id,
        label: `${section.gradeLabel}-${section.sectionLabel}`,
        academicYearId: section.academicYearId,
      })));
      setSubjects(config.subjects.map((subject) => ({ id: subject.id, name: subject.name })));
    }).catch(() => {});
  }, [refresh]);

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
            <div className="pn-head"><h2>Teaching records</h2></div>
            <div className="pn-body flush">
          <table className={`ledger ${styles.table}`}>
            <caption className="sr-only">Non-login teaching staff with their class and subject assignments</caption>
            <thead>
              <tr>
                <th scope="col">Teacher</th>
                <th scope="col">Title</th>
                <th scope="col">Assignments</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.staffMemberId}>
                  <td className={styles.name}>{row.displayName}</td>
                  <td>{row.title}</td>
                  <td>
                    {row.assignments.length === 0 ? (
                      <span className={styles.muted}>No assignments</span>
                    ) : (
                      <ul className={styles.assignmentList}>
                        {row.assignments.map((assignment) => (
                          <li key={assignment.id} className={styles.assignmentItem}>
                            <span className="num">{assignment.ref}</span>
                            <span>{assignment.gradeLabel ?? "—"}-{assignment.sectionLabel ?? "—"} · {assignment.subjectName ?? "—"}</span>
                            <StatusBadge tone={assignment.status === "active" ? "good" : assignment.status === "scheduled" ? "watch" : "neutral"}>
                              {assignment.status}
                            </StatusBadge>
                            {canManage && assignment.status !== "ended" ? (
                              endingId === assignment.id ? (
                                <span className={styles.endBox}>
                                  <input className="input" type="text" value={endReason}
                                    onChange={(event) => { setEndReason(event.target.value); }}
                                    placeholder="Why is this assignment ending?"
                                    aria-label={`Reason for ending ${assignment.ref}`}
                                    aria-invalid={endError} />
                                  {endError ? <p className="field-error">A reason is required.</p> : null}
                                  <button type="button" className="button button--danger button--small"
                                    onClick={() => void handleEnd(assignment.id)} disabled={busy}>
                                    {busy ? "Ending…" : "Confirm end"}
                                  </button>
                                  <button type="button" className="button button--quiet button--small"
                                    onClick={() => { setEndingId(null); setEndReason(""); }} disabled={busy}>Cancel</button>
                                </span>
                              ) : (
                                <button type="button" className="button button--quiet button--small"
                                  onClick={() => { setEndingId(assignment.id); setEndReason(""); }} disabled={busy}>
                                  End
                                </button>
                              )
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    {canManage ? (
                      assignFor === row.staffMemberId ? (
                        <div className={styles.assignForm}>
                          <select className="select" value={assignSection}
                            onChange={(event) => setAssignSection(event.target.value)}
                            aria-label="Class and section">
                            <option value="">Choose class…</option>
                            {sections.map((section) => (
                              <option key={section.id} value={section.id}>{section.label}</option>
                            ))}
                          </select>
                          <select className="select" value={assignSubject}
                            onChange={(event) => setAssignSubject(event.target.value)}
                            aria-label="Subject">
                            <option value="">Choose subject…</option>
                            {subjects.map((subject) => (
                              <option key={subject.id} value={subject.id}>{subject.name}</option>
                            ))}
                          </select>
                          <input className="input" type="text" value={assignReason}
                            onChange={(event) => setAssignReason(event.target.value)}
                            placeholder="Reason (recorded in audit trail)"
                            aria-label="Assignment reason" />
                          {errors.assignment ? <p className="field-error">{errors.assignment}</p> : null}
                          <button type="button" className="button button--primary button--small"
                            onClick={() => void handleAssign(row.staffMemberId)} disabled={busy}>
                            {busy ? "Recording…" : "Record assignment"}
                          </button>
                          <button type="button" className="button button--quiet button--small"
                            onClick={() => { setAssignFor(null); setErrors({}); }} disabled={busy}>Cancel</button>
                        </div>
                      ) : (
                        <button type="button" className="button button--quiet button--small"
                          onClick={() => { setAssignFor(row.staffMemberId); setErrors({}); }} disabled={busy}>
                          Add assignment
                        </button>
                      )
                    ) : (
                      <span className={styles.muted}>Read only</span>
                    )}
                  </td>
                </tr>
              ))}
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
