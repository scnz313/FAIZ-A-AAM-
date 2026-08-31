"use client";

import { useEffect, useState } from "react";
import type { ExamSlot, Period } from "@/modules/academics/demo";
import Button from "@/components/ui/Button";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canRole } from "@/modules/services/staff-authorization";
import {
  dateForTimetableWeekday,
  deriveEditedKeys,
  fixtureVersion,
  getEffectiveTimetable,
  getTimetableDraftAsync,
  getTimetableDraftConflicts,
  getTimetableEditorOptions,
  initialOpenConflicts,
  suggestedResolve,
  TIMETABLE_CLASS,
  TIMETABLE_KNOWN_CLASSES,
  TIMETABLE_WEEK,
  TIMETABLE_WEEK_DAYS,
  listTimetableClasses,
  timetableDays,
  timetableService,
  timetableWeekdayForDate,
  saveTimetableDraftAsync,
  timetableDemoNowIso,
  TimetableConflictError,
  validateDraft,
  validateResolve,
  type DraftNote,
  type EditField,
  type TimetableConflict,
  type TimetableEditorOptions,
  type TimetableOverride,
  type TimetableOverrideKind,
  type TimetablePeriodEdit,
  type TimetableVersionEntry,
} from "@/modules/services/timetable";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { TimetableEditor } from "./TimetableEditor";

import styles from "./TimetableManager.module.css";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

function formatDemoDate(iso: string): string {
  if (iso === "") return "—";
  return DATE_FORMATTER.format(new Date(iso));
}

/** Open conflicts are seeded from the 8-A fixture; classes without timetable data have nothing to check. */
function loadOpenConflicts(className: string): TimetableConflict[] {
  if (clientAdapterMode() === "supabase") return [];
  return className === TIMETABLE_CLASS ? initialOpenConflicts() : [];
}

function assignmentText(periods: Record<string, Period[]>, day: string, time: string): string {
  const period = periods[day]?.find((p) => p.time === time);
  if (!period) return "—";
  return `${period.subject} · ${period.teacher} · ${period.room}`;
}

/**
 * Staff timetable workspace: version/change-log panel, live conflict
 * detection with reasoned resolution, the class editor, and
 * draft/publish (append-only versions). All reads and writes go through
 * the single timetable facade (`timetableService`) keyed by the selected
 * class — the same store the portal timetable reads, so a publish here
 * updates the portal for the session. All state is session demo state.
 */
export function TimetableManager({ dateSheet }: { dateSheet: ReadonlyArray<ExamSlot> }) {
  const { summary } = useStaffContext();
  const canManage = canRole(summary?.role ?? "", "timetable.manage");
  const live = clientAdapterMode() === "supabase";
  const initialClass = live ? "" : (TIMETABLE_KNOWN_CLASSES[0] ?? TIMETABLE_CLASS);
  const [selectedClass, setSelectedClass] = useState<string>(initialClass);
  const [availableClasses, setAvailableClasses] = useState<string[]>(live ? [] : [...TIMETABLE_KNOWN_CLASSES]);
  const [working, setWorking] = useState<Record<string, Period[]>>({});
  const [baseline, setBaseline] = useState<Record<string, Period[]>>({});
  const [effectiveWeekOf, setEffectiveWeekOf] = useState<string | null>(live ? null : TIMETABLE_WEEK);
  const [editorOptions, setEditorOptions] = useState<TimetableEditorOptions>({ subjects: [], teachers: [], rooms: [] });
  const [editedKeys, setEditedKeys] = useState<ReadonlySet<string>>(new Set());
  const [draftNotes, setDraftNotes] = useState<DraftNote[]>([]);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [versions, setVersions] = useState<TimetableVersionEntry[]>(live ? [] : [fixtureVersion]);
  const [openConflicts, setOpenConflicts] = useState<TimetableConflict[]>(() => loadOpenConflicts(initialClass));
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveReason, setResolveReason] = useState("");
  const [resolveFeedback, setResolveFeedback] = useState("");
  const [preview, setPreview] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [publishFeedback, setPublishFeedback] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [overrides, setOverrides] = useState<TimetableOverride[]>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideTime, setOverrideTime] = useState("");
  const [overrideKind, setOverrideKind] = useState<TimetableOverrideKind>("substitute");
  const [overrideTeacher, setOverrideTeacher] = useState("");
  const [overrideSubject, setOverrideSubject] = useState("");
  const [overrideRoom, setOverrideRoom] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [overrideFeedback, setOverrideFeedback] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TimetableOverride | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokingRef, setRevokingRef] = useState<string | null>(null);
  const [dateSheetRows, setDateSheetRows] = useState<ExamSlot[]>(() => dateSheet.map((entry) => ({ ...entry })));
  const [dateSheetPublished, setDateSheetPublished] = useState(false);
  const [dateSheetLive, setDateSheetLive] = useState("");

  useEffect(() => {
    let active = true;
    void listTimetableClasses().then((classes) => {
      if (!active || classes.length === 0) return;
      setAvailableClasses(classes);
      setSelectedClass((current) => classes.includes(current) ? current : classes[0]!);
    }).catch(() => { if (active) setAvailableClasses([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (selectedClass === "") {
      setVersions([]);
      setBaseline({});
      setWorking({});
      return () => { active = false; };
    }
    void Promise.all([
      timetableService.getTimetableVersionList(selectedClass),
      getEffectiveTimetable(selectedClass),
      getTimetableDraftAsync(selectedClass),
      getTimetableEditorOptions(selectedClass),
      timetableService.getTimetableVersion(selectedClass),
    ]).then(async ([list, effective, draft, options, published]) => {
      if (!active) return;
      const nextBaseline = effective ?? {};
      const nextWorking = draft?.periods ?? nextBaseline;
      setVersions(list);
      setBaseline(nextBaseline);
      setWorking(nextWorking);
      setEffectiveWeekOf(published?.weekOf ?? (live ? null : TIMETABLE_WEEK));
      setEditorOptions(options);
      setEditedKeys(new Set(deriveEditedKeys(nextWorking, nextBaseline)));
      setDraftNotes(draft?.notes ?? []);
      setDraftSavedAt(draft?.savedAtIso ?? null);
      if (draft !== null && live) {
        const conflicts = await getTimetableDraftConflicts(draft, selectedClass);
        if (active) setOpenConflicts(conflicts);
      } else if (active) {
        setOpenConflicts(loadOpenConflicts(selectedClass));
      }
    }).catch(() => {
      if (active) {
        setVersions([]);
        setBaseline({});
        setWorking({});
        setEditorOptions({ subjects: [], teachers: [], rooms: [] });
        setOpenConflicts([]);
      }
    });
    return () => {
      active = false;
    };
  }, [live, selectedClass]);

  useEffect(() => {
    let active = true;
    if (selectedClass === "") {
      setOverrides([]);
      setDateSheetRows(live ? [] : dateSheet.map((entry) => ({ ...entry })));
      setDateSheetPublished(false);
      return () => { active = false; };
    }
    void Promise.all([
      timetableService.listTimetableOverridesAsync(selectedClass),
      timetableService.getDateSheetState(selectedClass),
    ]).then(([nextOverrides, state]) => {
      if (!active) return;
      setOverrides(nextOverrides);
      setDateSheetRows(live ? state?.entries.map((entry) => ({ ...entry })) ?? [] : dateSheet.map((entry) => ({ ...entry })));
      setDateSheetPublished(state?.published ?? false);
      setDateSheetLive(state ? `Date sheet v${state.version} published at ${formatDemoDate(state.publishedAtIso)}${live ? "." : " (demo session)."}` : "");
    }).catch(() => {
      if (!active) return;
      setOverrides([]);
      setDateSheetRows(live ? [] : dateSheet.map((entry) => ({ ...entry })));
      setDateSheetPublished(false);
    });
    return () => {
      active = false;
    };
  }, [dateSheet, live, selectedClass]);

  const isEmptyClass = selectedClass === "" || availableClasses.length === 0 || !availableClasses.includes(selectedClass) || Object.keys(working).length === 0;
  const currentEntry = versions[0] ?? null;
  const targetVersion = (currentEntry?.version ?? 0) + 1;
  const workingDays = timetableDays(working);
  const resolving = openConflicts.find((conflict) => conflict.id === resolveId) ?? null;
  const suggestion = resolving && !live ? suggestedResolve(resolving, working, selectedClass) : null;
  const draftFeedback = draftSavedAt !== null
    ? `Draft for Class ${selectedClass} saved at ${formatDemoDate(draftSavedAt)}${live ? "." : " (session demo)."}`
    : "";

  function applyEdit(day: string, time: string, field: EditField, value: string) {
    const next: Record<string, Period[]> = {};
    for (const d of TIMETABLE_WEEK_DAYS) {
      next[d] = (working[d] ?? []).map((period) =>
        d === day && period.time === time ? { ...period, [field]: value } : period,
      );
    }
    setWorking(next);
    setEditedKeys(new Set(deriveEditedKeys(next, baseline)));
    setDraftSavedAt(null);
  }

  /** Switch the workspace to another known class and reload everything for it. */
  function selectClass(className: string) {
    if (className === selectedClass) return;
    setSelectedClass(className);
    setWorking({});
    setBaseline({});
    setEffectiveWeekOf(live ? null : TIMETABLE_WEEK);
    setEditorOptions({ subjects: [], teachers: [], rooms: [] });
    setEditedKeys(new Set());
    setDraftNotes([]);
    setDraftSavedAt(null);
    setOpenConflicts([]);
    setVersions([]);
    /* Clear transient UI state so nothing from the previous class lingers. */
    setResolveId(null);
    setResolveReason("");
    setResolveFeedback("");
    setPreview(false);
    setPublishOpen(false);
    setPublishNote("");
    setPublishFeedback("");
    setOverrides([]);
    setOverrideOpen(false);
    setOverrideDate("");
    setOverrideTime("");
    setOverrideKind("substitute");
    setOverrideTeacher("");
    setOverrideSubject("");
    setOverrideRoom("");
    setOverrideNote("");
    setOverrideFeedback("");
    setRevokeTarget(null);
    setRevokeReason("");
    setRevokingRef(null);
    setDateSheetRows(live ? [] : dateSheet.map((entry) => ({ ...entry })));
    setDateSheetPublished(false);
    setDateSheetLive("");
  }

  async function saveDraft() {
    try {
      const draft = await saveTimetableDraftAsync(working, draftNotes, selectedClass);
      setDraftSavedAt(draft.savedAtIso);
      if (live) setOpenConflicts(await getTimetableDraftConflicts(draft, selectedClass));
      setPublishFeedback(live
        ? `Draft for Class ${selectedClass} saved to the school timetable service — not published.`
        : `Draft for Class ${selectedClass} saved to the session (demo) — not published. It will be restored when you return.`);
    } catch (error) {
      setPublishFeedback(`Draft save failed: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  }

  function openResolve(conflict: TimetableConflict) {
    setResolveId(conflict.id);
    setResolveReason("");
    setResolveFeedback("");
  }

  function applySuggestion(conflict: TimetableConflict) {
    if (suggestion === null) {
      setResolveFeedback("No safe suggestion found — change the assignment manually in the table below.");
      return;
    }
    applyEdit(conflict.day, conflict.time, suggestion.field, suggestion.value);
    setResolveReason(suggestion.reason);
    setResolveFeedback("");
  }

  function confirmResolve(conflict: TimetableConflict) {
    const result = validateResolve(conflict, working, baseline, resolveReason, selectedClass);
    if (!result.ok) {
      setResolveFeedback(result.error);
      return;
    }
    const note: DraftNote = { conflictMessage: conflict.message, reason: resolveReason.trim(), atIso: timetableDemoNowIso() };
    setDraftNotes((current) => [...current, note]);
    setOpenConflicts((current) => current.filter((item) => item.id !== conflict.id));
    setResolveId(null);
    setResolveReason("");
    setResolveFeedback(`Resolved: ${conflict.message} — ${note.reason}`);
  }

  function openPublish() {
    const issues = validateDraft(working, editedKeys);
    const firstIssue = issues[0];
    if (firstIssue !== undefined) {
      setPublishFeedback(
        `Cannot publish — ${firstIssue.day} ${firstIssue.time} ${firstIssue.field} is required for the edited period.`,
      );
      return;
    }
    if (openConflicts.length > 0) {
      setPublishFeedback(
        `Cannot publish — resolve the ${openConflicts.length} open conflict${openConflicts.length === 1 ? "" : "s"} first.`,
      );
      return;
    }
    const prefill = draftNotes
      .map((note) => `Resolved: ${note.conflictMessage} — ${note.reason}`)
      .join("; ");
    setPublishNote(prefill);
    setPublishFeedback("");
    setPublishOpen(true);
  }

  async function confirmPublish() {
    const note = publishNote.trim();
    if (note === "") {
      setPublishFeedback("A change note is required — it becomes the version note in the change log.");
      return;
    }
    const edits: TimetablePeriodEdit[] = [];
    for (const key of editedKeys) {
      const [day, time] = key.split("|");
      if (day === undefined || time === undefined) continue;
      const period = working[day]?.find((p) => p.time === time);
      edits.push({ day, time, subject: period?.subject ?? "", teacher: period?.teacher ?? "", room: period?.room ?? "" });
    }
    setPublishing(true);
    setPublishFeedback(`Publishing v${targetVersion} for Class ${selectedClass}…`);
    try {
      const version = await timetableService.publishTimetable(edits, note, selectedClass);
      setVersions(await timetableService.getTimetableVersionList(selectedClass));
      setWorking(version.periods);
      setBaseline(version.periods);
      setEditedKeys(new Set());
      setDraftNotes([]);
      setDraftSavedAt(null);
      setPublishOpen(false);
      setEffectiveWeekOf(version.weekOf);
      setPublishFeedback(
        `v${version.version} published for Class ${selectedClass} at ${formatDemoDate(version.publishedAtIso ?? "")}${live ? "" : " (demo session)"} — the portal timetable now shows it.`,
      );
    } catch (error) {
      if (error instanceof TimetableConflictError) setOpenConflicts(error.conflicts);
      setPublishFeedback(
        `Publish failed: ${error instanceof Error ? error.message : "unknown error"} — review the change note and try again.`,
      );
    } finally {
      setPublishing(false);
    }
  }

  function openOverrideForm() {
    /* Default to the first day of the effective week (or today when no
     * published week is known) — the manager can pick any calendar date. */
    const defaultDate = effectiveWeekOf !== null
      ? (dateForTimetableWeekday(TIMETABLE_WEEK_DAYS[0] ?? "Monday", effectiveWeekOf) ?? new Date().toISOString().slice(0, 10))
      : new Date().toISOString().slice(0, 10);
    setOverrideDate(defaultDate);
    setOverrideTime("");
    setOverrideKind("substitute");
    setOverrideTeacher("");
    setOverrideSubject("");
    setOverrideRoom("");
    setOverrideNote("");
    setOverrideFeedback("");
    setOverrideOpen(true);
  }

  async function confirmOverride() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(overrideDate) || timetableWeekdayForDate(overrideDate) === null) {
      setOverrideFeedback("Choose a valid override date.");
      return;
    }
    const dateIso = overrideDate;
    setSavingOverride(true);
    setOverrideFeedback("Saving override…");
    try {
      const override = await timetableService.saveTimetableOverride(
        {
          dateIso,
          time: overrideTime,
          kind: overrideKind,
          teacher: overrideKind === "substitute" ? overrideTeacher : undefined,
          subject: overrideKind === "substitute" ? overrideSubject : undefined,
          room: overrideKind === "room" ? overrideRoom : undefined,
          note: overrideNote,
        },
        selectedClass,
      );
      setOverrides(await timetableService.listTimetableOverridesAsync(selectedClass));
      setOverrideOpen(false);
      setOverrideFeedback(
        `${override.ref} recorded — ${override.day} ${override.time} ${override.kind} override applies only on ${override.dateIso}${live ? "." : " (demo session)."}`,
      );
    } catch (error) {
      setOverrideFeedback(
        `Override not saved: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      setSavingOverride(false);
    }
  }

  async function confirmRevokeOverride() {
    if (revokeTarget === null) return;
    const reason = revokeReason.trim();
    if (reason.length < 10) {
      setOverrideFeedback("A revocation reason of at least 10 characters is required.");
      return;
    }
    setRevokingRef(revokeTarget.ref);
    setOverrideFeedback(`Revoking ${revokeTarget.ref}…`);
    try {
      const revoked = await timetableService.revokeTimetableOverride(
        revokeTarget.ref,
        reason,
        revokeTarget.version,
        selectedClass,
      );
      setOverrides((current) => current.map((candidate) => candidate.ref === revoked.ref ? revoked : candidate));
      setRevokeTarget(null);
      setRevokeReason("");
      setOverrideFeedback(`${revoked.ref} revoked — the published base timetable reapplies on that date. The reason remains in history.`);
    } catch (error) {
      setOverrideFeedback(
        `Revoke failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      setRevokingRef(null);
    }
  }

  async function publishDateSheet() {
    setDateSheetLive("Publishing date sheet…");
    try {
      const state = await timetableService.publishDateSheet(selectedClass, dateSheetRows);
      setDateSheetRows(state.entries.map((entry) => ({ ...entry })));
      setDateSheetPublished(state.published);
      setDateSheetLive(
        `Date sheet v${state.version} published at ${formatDemoDate(state.publishedAtIso)}${live ? "" : " (demo session)"} — the portal reads this state.`,
      );
    } catch (error) {
      setDateSheetLive(
        `Date sheet not published: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return (
    <>
      <section className="panel" aria-labelledby="timetable-version-heading">
        <div className={styles.sectionHead}>
          <h2 id="timetable-version-heading" className="section-label">
            Class timetables
          </h2>
          {!live ? <span className="demo-badge">Demo data</span> : null}
        </div>

        {canManage ? (
          <div className={`field ${styles.classSelector}`}>
            <label className="sr-only" htmlFor="timetable-class-select">
              Class
            </label>
            <select
              id="timetable-class-select"
              className="select"
              value={selectedClass}
              onChange={(event) => selectClass(event.target.value)}
              disabled={publishing}
            >
            {availableClasses.map((className) => (
                <option key={className} value={className}>
                  {className}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {currentEntry === null ? (
          <div className="workspace-state">
            <p className="workspace-state-title">No versions yet</p>
            <p className="workspace-state-note">
              Class {selectedClass} has no published timetable{live ? "" : " in this demo"}. A timetable manager can publish the first
              version once the section&apos;s schedule is confirmed.
            </p>
          </div>
        ) : (
          <>
            <p className={styles.versionLine}>
              <strong>Class {selectedClass} timetable</strong> — v{currentEntry.version}, published{" "}
              {formatDemoDate(currentEntry.publishedAtIso)}
              {currentEntry.session === true ? " · this session" : ""}{live ? "" : " (demo)"}
            </p>

            {draftNotes.length > 0 ? (
              <>
                <h3 className={styles.changeHeading}>Resolution reasons — this draft</h3>
                <ol className={styles.changeLog}>
                  {draftNotes.map((note, index) => (
                    <li key={`${note.atIso}-${index}`} className={styles.changeRow}>
                      <span className={styles.changeVersion}>Note</span>
                      <span>
                        Resolved: {note.conflictMessage} — {note.reason}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}

            <h3 className={styles.changeHeading}>Change log</h3>
            <ol className={styles.changeLog}>
              {versions.map((entry) => (
                <li key={entry.version} className={styles.changeRow}>
                  <span className={styles.changeVersion}>v{entry.version}</span>
                  <span>
                    {entry.note}
                    {entry.session ? " · this session" : ""}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="timetable-conflicts-heading">
        <div className={styles.sectionHead}>
          <h2 id="timetable-conflicts-heading" className="section-label">
            Conflicts
          </h2>
          {!live ? <span className="demo-badge">Demo data</span> : null}
        </div>

        {isEmptyClass ? (
          <div className="workspace-state">
            <p className="workspace-state-title">No timetable yet</p>
            <p className="workspace-state-note">
              Class {selectedClass} has no published timetable{live ? "" : " in this demo"}. A timetable manager can publish the first
              version once the section&apos;s schedule is confirmed.
            </p>
          </div>
        ) : (
          <>
            <p className={styles.conflictIntro}>
              {live
                ? `The school timetable validator checks teacher and room assignments for Class ${selectedClass} against overlapping section schedules before publication.`
                : `Conflicts are detected live for the same teacher or room at the same day and time across Class ${selectedClass} and the peer fixture.`}{" "}
              A conflicting edit is blocked; resolving requires a reasoned change to the assignment.
            </p>

            {openConflicts.length === 0 ? <p className={styles.none}>No open conflicts.</p> : null}
            {openConflicts.map((conflict) => (
              <div key={conflict.id} className={`alert-strip alert-strip--warning ${styles.conflictStrip}`}>
                <div>
                  <p className={styles.conflictCopy}>{conflict.message}</p>
                  <p className={styles.conflictMeta}>
                    {conflict.kind === "claim" ? "Known fixture claim" : live ? "School validator" : "Live detection"} · {conflict.day}{" "}
                    {conflict.time}
                  </p>
                </div>
                <Button variant="quiet" onClick={() => openResolve(conflict)}>
                  Resolve
                </Button>
              </div>
            ))}

            {resolving !== null ? (
              <div className={styles.resolvePanel}>
                <h3 className="section-label">Resolve — {resolving.message}</h3>
                <p className={styles.resolveWhy}>{resolving.detail}</p>
                <p className={styles.resolveAssignment}>
                  Affected period: <strong>{resolving.day} {resolving.time}</strong> — {assignmentText(working, resolving.day, resolving.time)}
                </p>
                <p className={styles.resolveRule}>
                  Change the assignment in the table below so the conflict disappears, then record why. A resolve without a
                  change is rejected.
                </p>
                <div className={styles.resolveActions}>
                  {suggestion !== null ? (
                    <Button variant="primary" onClick={() => applySuggestion(resolving)}>
                      Apply suggested fix ({suggestion.field}: {suggestion.value})
                    </Button>
                  ) : null}
                  <label className={styles.reasonLabel} htmlFor="resolve-reason">
                    Reason for the change <span className={styles.required}>required</span>
                  </label>
                  <textarea
                    id="resolve-reason"
                    className={styles.reasonInput}
                    rows={2}
                    value={resolveReason}
                    onChange={(event) => setResolveReason(event.target.value)}
                    aria-required="true"
                    aria-describedby="resolve-feedback"
                  />
                  <div className={styles.resolveButtons}>
                    <Button variant="saffron" onClick={() => confirmResolve(resolving)}>
                      Confirm resolution
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setResolveId(null);
                        setResolveReason("");
                        setResolveFeedback("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            <p id="resolve-feedback" className={styles.live} role="status">
              {resolveFeedback}
            </p>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="timetable-editor-heading">
        <div className={styles.sectionHead}>
          <h2 id="timetable-editor-heading" className="section-label">
            Editor — Class {selectedClass}
          </h2>
          {!live ? <span className="demo-badge">Demo data</span> : null}
        </div>

        {isEmptyClass ? (
          <div className="workspace-state">
            <p className="workspace-state-title">No timetable yet</p>
            <p className="workspace-state-note">
              Class {selectedClass} has no published timetable{live ? "" : " in this demo"}. A timetable manager can publish the first
              version once the section&apos;s schedule is confirmed.
            </p>
          </div>
        ) : (
          <>
            <p className={styles.editorIntro}>
              Minimal scope: edit subject, teacher, and room per period. Period times are fixed by the {live ? "school configuration" : "published fixture"}.
              Edited periods are marked; save a draft or publish a new version (append-only — earlier versions stay listed).
            </p>

            <TimetableEditor
              timetable={working}
              baseline={baseline}
              weekDays={TIMETABLE_WEEK_DAYS}
              editedKeys={editedKeys}
              preview={preview}
              className={selectedClass}
              subjects={editorOptions.subjects}
              teachers={editorOptions.teachers}
              checkClientConflicts={!live}
              onEdit={applyEdit}
            />

            {canManage ? (
              <div className={styles.actionRow}>
                <Button variant="quiet" onClick={saveDraft} disabled={publishing}>
                  Save draft
                </Button>
                <Button variant="quiet" onClick={() => setPreview((current) => !current)} disabled={publishing}>
                  {preview ? "Back to editing" : "Preview draft"}
                </Button>
                <Button variant="saffron" onClick={openPublish} disabled={publishing || publishOpen}>
                  {currentEntry?.session === true ? `Correct timetable (v${targetVersion})` : "Publish timetable"}
                </Button>
                <p className={styles.live} role="status">
                  {draftFeedback}
                  {draftFeedback !== "" && publishFeedback !== "" ? " " : ""}
                  {publishFeedback}
                </p>
              </div>
            ) : (
              <p className={styles.readOnlyNote} role="status">
                View only — editing, drafts, and publishing require the Timetable manager workspace. Teachers can view
                their published schedules.
              </p>
            )}

            {publishOpen ? (
              <div className={styles.publishPanel}>
                <h3 className="section-label">Publish v{targetVersion} for Class {selectedClass}?</h3>
                <p className={styles.publishWhy}>
                  A new version is created on top of v{targetVersion - 1} — earlier versions remain in the change log (no
                  silent overwrite). The portal timetable will show this version for the session.
                </p>
                <label className={styles.reasonLabel} htmlFor="publish-note">
                  Change note for v{targetVersion} <span className={styles.required}>required</span>
                </label>
                <textarea
                  id="publish-note"
                  className={styles.reasonInput}
                  rows={3}
                  value={publishNote}
                  onChange={(event) => setPublishNote(event.target.value)}
                  aria-required="true"
                />
                <div className={styles.resolveButtons}>
                  <Button variant="saffron" onClick={confirmPublish} disabled={publishing}>
                    {publishing ? `Publishing v${targetVersion}…` : `Publish v${targetVersion}`}
                  </Button>
                  <Button variant="quiet" onClick={() => setPublishOpen(false)} disabled={publishing}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="timetable-overrides-heading">
        <div className={styles.sectionHead}>
          <h2 id="timetable-overrides-heading" className="section-label">
            Overrides — Class {selectedClass}
          </h2>
          {!live ? <span className="demo-badge">Demo data</span> : null}
        </div>

        {isEmptyClass ? (
          <div className="workspace-state">
            <p className="workspace-state-title">No timetable yet</p>
            <p className="workspace-state-note">
              Class {selectedClass} has no published timetable{live ? "" : " in this demo"}, so date-specific overrides cannot be
              applied yet.
            </p>
          </div>
        ) : (
          <>
            <p className={styles.conflictIntro}>
              A date-specific override replaces a teacher, room, subject, or the whole period on one date only — the
              published base timetable is never rewritten. Overrides stay in history after revocation.
            </p>

            {overrides.length === 0 ? (
              <p className={styles.none}>{live ? "No overrides are recorded for this section." : "No overrides recorded for this session."}</p>
            ) : (
              <ul className={styles.changeLog}>
                {overrides.map((override) => (
                  <li key={override.ref} className={styles.changeRow}>
                    <span className={styles.changeVersion}>{override.ref}</span>
                    <span>
                      <strong>{override.day} {override.time}</strong> · {override.kind} · v{override.version}
                      {override.teacher !== undefined ? ` · ${override.teacher}` : ""}
                      {override.subject !== undefined ? ` · ${override.subject}` : ""}
                      {override.room !== undefined ? ` · ${override.room}` : ""}
                      {" — "}{override.note}
                      {override.revokedAtIso !== null ? (
                        <span> · revoked{override.revocationReason ? ` — ${override.revocationReason}` : ""}</span>
                      ) : canManage ? (
                        <>
                          {" "}
                          <Button
                            variant="quiet"
                            disabled={revokingRef === override.ref || revokeTarget?.ref === override.ref}
                            onClick={() => {
                              setRevokeTarget(override);
                              setRevokeReason("");
                              setOverrideFeedback("");
                            }}
                          >
                            {revokingRef === override.ref ? "Revoking…" : revokeTarget?.ref === override.ref ? "Revoke form open" : "Revoke"}
                          </Button>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {canManage && revokeTarget !== null ? (
              <div className={styles.publishPanel}>
                <h3 className="section-label">Revoke {revokeTarget.ref}?</h3>
                <p className={styles.publishWhy}>
                  Class {selectedClass} · {revokeTarget.dateIso} · {revokeTarget.day} {revokeTarget.time}. The base
                  timetable will reapply, while this override and the revocation reason remain in history.
                </p>
                <label className={styles.reasonLabel} htmlFor="override-revoke-reason">
                  Revocation reason <span className={styles.required}>required</span>
                </label>
                <textarea
                  id="override-revoke-reason"
                  className={styles.reasonInput}
                  rows={2}
                  value={revokeReason}
                  onChange={(event) => setRevokeReason(event.target.value)}
                  aria-required="true"
                  aria-describedby="override-feedback"
                />
                <div className={styles.resolveButtons}>
                  <Button variant="saffron" onClick={() => void confirmRevokeOverride()} disabled={revokingRef !== null}>
                    {revokingRef === revokeTarget.ref ? "Revoking…" : "Confirm revocation"}
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={revokingRef !== null}
                    onClick={() => {
                      setRevokeTarget(null);
                      setRevokeReason("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {canManage ? (
              <>
                <div className={styles.publishRow}>
                  <Button variant="quiet" onClick={openOverrideForm} disabled={overrideOpen || savingOverride}>
                    {overrideOpen ? "Override form open" : "Add date-specific override"}
                  </Button>
                </div>

                {overrideOpen ? (
                  <div className={styles.publishPanel}>
                    <h3 className="section-label">Add an override for Class {selectedClass}</h3>
                    <p className={styles.publishWhy}>
                      Applies only on the chosen calendar date. The base timetable for every other date is unchanged.
                    </p>
                    <div className={styles.overrideFields}>
                      <div className="field">
                        <label htmlFor="override-date">Date</label>
                        <input
                          id="override-date"
                          className="input"
                          type="date"
                          value={overrideDate}
                          onChange={(event) => {
                            setOverrideDate(event.target.value);
                            setOverrideTime("");
                          }}
                          aria-required="true"
                        />
                        {overrideDate !== "" && timetableWeekdayForDate(overrideDate) !== null ? (
                          <p className="field-help">
                            {timetableWeekdayForDate(overrideDate)} · applies only on this date
                          </p>
                        ) : null}
                      </div>
                      <div className="field">
                        <label htmlFor="override-time">Period</label>
                        <select
                          id="override-time"
                          className="select"
                          value={overrideTime}
                          onChange={(event) => setOverrideTime(event.target.value)}
                        >
                          <option value="">Select a period…</option>
                          {(working[timetableWeekdayForDate(overrideDate) ?? "Monday"] ?? [])
                            .filter((period) => period.kind !== "break" && period.kind !== "assembly")
                            .map((period) => (
                              <option key={period.time} value={period.time}>
                                {period.time} — {period.subject} · {period.teacher}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="override-kind">Kind</label>
                        <select
                          id="override-kind"
                          className="select"
                          value={overrideKind}
                          onChange={(event) => setOverrideKind(event.target.value as TimetableOverrideKind)}
                        >
                          <option value="substitute">Substitute teacher</option>
                          <option value="room">Room change</option>
                          <option value="cancellation">Cancellation</option>
                          <option value="special">Special period</option>
                        </select>
                      </div>
                      {overrideKind === "substitute" ? (
                        <>
                          <div className="field">
                            <label htmlFor="override-teacher">Substitute teacher</label>
                            <input
                              id="override-teacher"
                              className="input"
                              type="text"
                              value={overrideTeacher}
                              onChange={(event) => setOverrideTeacher(event.target.value)}
                              aria-required="true"
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="override-subject">Subject</label>
                            <input
                              id="override-subject"
                              className="input"
                              type="text"
                              value={overrideSubject}
                              onChange={(event) => setOverrideSubject(event.target.value)}
                              aria-required="true"
                            />
                          </div>
                        </>
                      ) : null}
                      {overrideKind === "room" ? (
                        <div className="field">
                          <label htmlFor="override-room">Room</label>
                          <input
                            id="override-room"
                            className="input"
                            type="text"
                            value={overrideRoom}
                            onChange={(event) => setOverrideRoom(event.target.value)}
                            aria-required="true"
                          />
                        </div>
                      ) : null}
                      <div className={`field ${styles.overrideNoteField}`}>
                        <label htmlFor="override-note">Reason {overrideKind === "cancellation" ? "and what students should know" : ""}</label>
                        <textarea
                          id="override-note"
                          className={styles.reasonInput}
                          rows={2}
                          value={overrideNote}
                          onChange={(event) => setOverrideNote(event.target.value)}
                          aria-required="true"
                          aria-describedby="override-feedback"
                        />
                      </div>
                    </div>
                    <div className={styles.resolveButtons}>
                      <Button variant="saffron" onClick={() => void confirmOverride()} disabled={savingOverride}>
                        {savingOverride ? "Saving…" : "Record override"}
                      </Button>
                      <Button variant="quiet" onClick={() => setOverrideOpen(false)} disabled={savingOverride}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                <p id="override-feedback" className={styles.live} role="status">
                  {overrideFeedback}
                </p>
              </>
            ) : (
              <p className={styles.readOnlyNote} role="status">
                View only — recording overrides requires the Timetable manager workspace.
              </p>
            )}
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="datesheet-heading">
        <div className={styles.sectionHead}>
          <h2 id="datesheet-heading" className="section-label">
            Exam date sheet — Mid-term
          </h2>
          {!live ? <span className="demo-badge">Demo data</span> : null}
        </div>

        <div className="table--scroll">
          <table className={`table ${styles.dateSheetTable}`}>
            <thead>
              <tr>
                <th scope="col" className="num">Date</th>
                <th scope="col">Day</th>
                <th scope="col">Subject</th>
                <th scope="col" className="num">Time</th>
                <th scope="col">Room</th>
              </tr>
            </thead>
            <tbody>
              {dateSheetRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>No published exam dates are available for this section.</td>
                </tr>
              ) : dateSheetRows.map((slot) => (
                <tr key={`${slot.dateIso}-${slot.subject}`}>
                  <td className="num">{slot.dateLabel}</td>
                  <td>{slot.dayLabel}</td>
                  <td>{slot.subject}</td>
                  <td className="num">{slot.time}</td>
                  <td>{slot.room}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canManage ? (
          <div className={styles.publishRow}>
            <Button variant="primary" disabled={dateSheetPublished || dateSheetRows.length === 0} onClick={publishDateSheet}>
              {dateSheetPublished ? (live ? "Published" : "Published (demo)") : "Publish date sheet"}
            </Button>
            <p className={styles.live} role="status">
              {dateSheetLive}
            </p>
          </div>
        ) : null}
      </section>
    </>
  );
}
