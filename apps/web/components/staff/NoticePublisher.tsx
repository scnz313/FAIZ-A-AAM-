"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useStaffContext } from "@/components/staff/StaffContextProvider";
import Button from "@/components/ui/Button";
import { EmptyState, ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  contentService,
  noticeCategories,
  type ContentActor,
  type ContentNotice,
  type ContentResult,
  type NoticeCategory,
} from "@/modules/services/content";
import { canAnyRole } from "@/modules/services/staff-profiles";

import styles from "./NoticePublisher.module.css";

type RowStatus = "Published" | "Draft" | "In review" | "Approved" | "Scheduled" | "Expired" | "Archived";

type NoticeRow = {
  key: string;
  title: string;
  category: NoticeCategory;
  audience: ContentNotice["audience"];
  status: RowStatus;
  publishedLabel: string;
  owner: string;
  reviewDue: string;
  pinned: boolean;
  version: number;
  itemVersion: number;
  authorAccountId: string | null;
  publishNote?: string;
};

const STATUS_TONE: Record<RowStatus, "good" | "neutral" | "watch" | "alert"> = {
  Published: "good",
  Draft: "neutral",
  "In review": "watch",
  Approved: "watch",
  Scheduled: "watch",
  Expired: "alert",
  Archived: "neutral",
};

const AUDIENCE_LABEL: Record<ContentNotice["audience"], string> = {
  public: "Public",
  family: "Family",
};

function rowStatus(notice: ContentNotice): RowStatus {
  if (notice.status === "expired") return "Expired";
  if (notice.status === "archived") return "Archived";
  if (notice.status === "scheduled") return "Scheduled";
  if (notice.status === "published") return "Published";
  if (notice.reviewStatus === "in_review") return "In review";
  if (notice.reviewStatus === "approved") return "Approved";
  return "Draft";
}

function dateLabel(notice: ContentNotice): string {
  const value = notice.status === "scheduled" ? notice.scheduledForIso : notice.status === "published" ? notice.dateIso : null;
  if (!value) return "—";
  try {
    return formatKolkata(value, { format: "day" });
  } catch {
    return "—";
  }
}

function toRows(notices: ContentNotice[]): NoticeRow[] {
  return notices.map((notice) => ({
    key: notice.slug,
    title: notice.title,
    category: notice.category,
    audience: notice.audience,
    status: rowStatus(notice),
    publishedLabel: dateLabel(notice),
    owner: notice.authorAccountId ? "Recorded editor" : "Content team",
    reviewDue: notice.reviewDue,
    pinned: notice.pinned === true,
    version: notice.version,
    itemVersion: notice.itemVersion,
    authorAccountId: notice.authorAccountId,
    publishNote: notice.publishNote,
  }));
}

type Errors = { title?: string; body?: string; note?: string };

type NoticePublisherProps = {
  notices: ContentNotice[];
};

/**
 * Canonical content maker/checker workspace. An editor saves immutable draft
 * versions and requests review. A different publisher approves that exact
 * version, then publishes or schedules it. Every successful mutation reloads
 * the authoritative staff projection rather than fabricating a local version.
 */
export function NoticePublisher({ notices }: NoticePublisherProps) {
  const [records, setRecords] = useState<ContentNotice[]>(() => notices.map((notice) => ({ ...notice, body: [...notice.body] })));
  const { summary } = useStaffContext();
  const canPublish = canAnyRole(summary?.roles ?? [], "content.publish");
  const canDraft = canAnyRole(summary?.roles ?? [], "content.draft");
  const actor: ContentActor | null = summary
    ? { accountId: summary.accountId, displayName: summary.displayName, role: summary.role }
    : null;
  const isSupabase = clientAdapterMode() === "supabase";
  const rows = toRows(records);

  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<NoticeCategory>("General");
  const [audience, setAudience] = useState<ContentNotice["audience"]>("public");
  const [body, setBody] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [pinnedNotice, setPinnedNotice] = useState(false);
  const [reviewDue, setReviewDue] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState<NoticeCategory>("General");
  const [editAudience, setEditAudience] = useState<ContentNotice["audience"]>("public");
  const [editBody, setEditBody] = useState("");
  const [editReviewNote, setEditReviewNote] = useState("");
  const [editPinned, setEditPinned] = useState(false);
  const [editReviewDue, setEditReviewDue] = useState("");
  const [releaseSlug, setReleaseSlug] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  /* Unpublishing archives the current item, so the destructive control asks
     for confirmation in place instead of firing on the first click. Focus
     moves to the safe choice and returns to the trigger when cancelled. */
  const [confirmUnpublishSlug, setConfirmUnpublishSlug] = useState<string | null>(null);
  const [restoreUnpublishFocusSlug, setRestoreUnpublishFocusSlug] = useState<string | null>(null);
  const unpublishTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (confirmUnpublishSlug !== null || restoreUnpublishFocusSlug === null) return;
    unpublishTriggerRefs.current[restoreUnpublishFocusSlug]?.focus();
    setRestoreUnpublishFocusSlug(null);
  }, [confirmUnpublishSlug, restoreUnpublishFocusSlug]);

  const releaseCandidates = records.filter(
    (notice) =>
      notice.status === "draft" &&
      notice.reviewStatus === "approved" &&
      notice.authorAccountId !== summary?.accountId,
  );
  const selectedReleaseSlug = releaseCandidates.some((notice) => notice.slug === releaseSlug)
    ? releaseSlug
    : (releaseCandidates[0]?.slug ?? "");
  const selectedRelease = releaseCandidates.find((notice) => notice.slug === selectedReleaseSlug) ?? null;

  /* Server Components cannot read the browser-only demo session store.  The
     initial prop therefore contains the deterministic seed; hydrate once
     from the owning adapter so writes made on another staff route remain
     visible after a canonical-route navigation.  Supabase performs the same
     authoritative refresh through its authenticated adapter branch. */
  useEffect(() => {
    let active = true;
    setHydrating(true);
    void contentService.listForStaff()
      .then((list) => {
        if (!active) return;
        setRecords(list.map((notice) => ({ ...notice, body: [...notice.body] })));
        setListError(null);
      })
      .catch(() => {
        /* The server snapshot stays visible, but the failed refresh is surfaced
           with a retry instead of being swallowed. */
        if (active) setListError("The notice list could not be refreshed. The snapshot below may be out of date.");
      })
      .finally(() => {
        if (active) setHydrating(false);
      });
    return () => {
      active = false;
    };
  }, [summary?.accountId]);

  async function retryList() {
    setHydrating(true);
    setListError(null);
    try {
      await refreshRows();
    } catch (error) {
      setListError(error instanceof Error ? error.message : "The notice list could not be refreshed. Try again.");
    } finally {
      setHydrating(false);
    }
  }

  function announce(text: string) {
    setAnnouncement((previous) => ({ key: (previous?.key ?? 0) + 1, text }));
  }

  function persistenceSuffix(): string {
    return isSupabase ? "" : " in this demo session";
  }

  /** Re-read the service list so state and version come from the owning source. */
  async function refreshRows(): Promise<void> {
    const list = await contentService.listForStaff();
    setRecords(list.map((notice) => ({ ...notice, body: [...notice.body] })));
    setListError(null);
  }

  async function surfaceFailure<T>(result: Extract<ContentResult<T>, { ok: false }>): Promise<void> {
    announce(result.message);
    if (result.code === "stale-version") {
      try {
        await refreshRows();
      } catch {
        announce(`${result.message} The latest content could not be reloaded; retry the page.`);
      }
    }
  }

  function validateDraft(): boolean {
    const next: Errors = {
      title: title.trim() ? undefined : "Title is required.",
      body: body.trim() ? undefined : "Body is required.",
    };
    setErrors(next);
    return next.title === undefined && next.body === undefined;
  }

  function clearError(field: keyof Errors) {
    setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));
  }

  function resetDraftForm() {
    setTitle("");
    setBody("");
    setReviewNote("");
    setUrgent(false);
    setPinnedNotice(false);
    setReviewDue("");
    setAudience("public");
  }

  async function handleSaveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || actor === null || !canDraft || !validateDraft()) return;
    setBusy(true);
    try {
      await contentService.createNotice({
        title,
        category,
        body: [body.trim()],
        urgent,
        audience,
        pinned: pinnedNotice,
        reviewDue: reviewDue || null,
        publishNote: reviewNote,
        actor,
      });
      await refreshRows();
      resetDraftForm();
      announce(`Draft saved${persistenceSuffix()}. Add a review note if needed, then request publisher review.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "The draft could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function requestReview(row: NoticeRow) {
    if (busy || actor === null || !canDraft) return;
    setBusy(true);
    try {
      const result = await contentService.requestReview(row.key, {
        actor,
        expectedVersion: row.version,
      });
      if (!result.ok) {
        await surfaceFailure(result);
        return;
      }
      await refreshRows();
      announce(`Notice "${row.title}" sent for review${persistenceSuffix()}. A different publisher must approve it.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "Review could not be requested. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(row: NoticeRow) {
    if (busy || actor === null || !canPublish) return;
    setBusy(true);
    try {
      const result = await contentService.approveVersion(row.key, {
        actor,
        expectedVersion: row.version,
      });
      if (!result.ok) {
        await surfaceFailure(result);
        return;
      }
      await refreshRows();
      setReleaseSlug(row.key);
      announce(`Version ${result.value.version} of "${row.title}" approved${persistenceSuffix()}. Publish or schedule it next.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "The version could not be approved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function release(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || actor === null || !canPublish || selectedRelease === null) return;
    if (!selectedRelease.publishNote?.trim()) {
      setErrors((previous) => ({ ...previous, note: "The approved version has no publish note. Return it to an editor." }));
      return;
    }
    setBusy(true);
    try {
      const scheduledForIso = scheduleDate ? `${scheduleDate}T00:00:00+05:30` : null;
      const result = await contentService.publishVersionV2(selectedRelease.slug, {
        actor,
        expectedVersion: selectedRelease.version,
        note: selectedRelease.publishNote,
        scheduledForIso,
      });
      if (!result.ok) {
        await surfaceFailure(result);
        return;
      }
      await refreshRows();
      setReleaseSlug("");
      setScheduleDate("");
      setErrors((previous) => ({ ...previous, note: undefined }));
      announce(
        scheduledForIso
          ? `Notice "${selectedRelease.title}" scheduled${persistenceSuffix()}.`
          : `Notice "${selectedRelease.title}" published${persistenceSuffix()}.`,
      );
    } catch (error) {
      announce(error instanceof Error ? error.message : "The approved notice could not be released. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish(row: NoticeRow) {
    if (busy || actor === null || !canPublish) return;
    setBusy(true);
    try {
      const result = await contentService.unpublishNotice(row.key, {
        actor,
        expectedVersion: row.itemVersion,
        reason: "Archived from the notices workspace.",
      });
      if (!result.ok) {
        await surfaceFailure(result);
        return;
      }
      await refreshRows();
      setConfirmUnpublishSlug(null);
      announce(`Notice "${row.title}" archived${persistenceSuffix()}.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "The notice could not be archived. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function cancelUnpublish() {
    setRestoreUnpublishFocusSlug(confirmUnpublishSlug);
    setConfirmUnpublishSlug(null);
  }

  function editRow(row: NoticeRow) {
    const notice = records.find((candidate) => candidate.slug === row.key);
    if (!notice) return;
    setEditingSlug(row.key);
    setEditTitle(notice.title);
    setEditCategory(notice.category);
    setEditAudience(notice.audience);
    setEditBody(notice.body.join("\n"));
    setEditReviewNote(notice.publishNote ?? "");
    setEditPinned(notice.pinned === true);
    setEditReviewDue(notice.reviewDue === "—" ? "" : notice.reviewDue);
  }

  async function saveEdit() {
    if (busy || editingSlug === null || actor === null || !canDraft) return;
    if (!editTitle.trim() || !editBody.trim()) {
      announce("Title and body are required to save edits.");
      return;
    }
    const current = records.find((notice) => notice.slug === editingSlug);
    if (!current) {
      announce("The notice is no longer in the current list. Reload and try again.");
      return;
    }
    setBusy(true);
    try {
      const result = await contentService.editNotice(editingSlug, {
        title: editTitle.trim(),
        category: editCategory,
        audience: editAudience,
        body: editBody.split("\n").map((line) => line.trim()).filter(Boolean),
        publishNote: editReviewNote,
        pinned: editPinned,
        reviewDue: editReviewDue || null,
        actor,
        expectedVersion: current.itemVersion,
      });
      if (!result.ok) {
        await surfaceFailure(result);
        return;
      }
      await refreshRows();
      announce(`Draft "${editTitle.trim()}" saved as version ${result.value.version}${persistenceSuffix()}.`);
      cancelEdit();
    } catch (error) {
      announce(error instanceof Error ? error.message : "The draft changes could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit() {
    setEditingSlug(null);
    setEditTitle("");
    setEditCategory("General");
    setEditAudience("public");
    setEditBody("");
    setEditReviewNote("");
    setEditPinned(false);
    setEditReviewDue("");
  }

  return (
    <div className={styles.publisherGrid}>
      <section className="panel" aria-labelledby="notice-list-heading">
        <div className={styles.panelHead}>
          <h2 id="notice-list-heading" className={styles.panelTitle}>
            Notices
          </h2>
          {!isSupabase ? <span className="demo-badge">Demo data</span> : null}
        </div>

        {announcement && (
          <p key={announcement.key} className={styles.liveNote} aria-live="polite">
            {announcement.text}
          </p>
        )}

        {listError !== null ? (
          <ErrorPanel title="Notices could not be refreshed." note={listError}>
            <Button variant="quiet" type="button" disabled={busy} onClick={() => void retryList()}>
              Try again
            </Button>
          </ErrorPanel>
        ) : null}

        {rows.length === 0 && hydrating ? <LoadingSkeleton lines={4} label="Loading notices…" /> : null}

        {rows.length === 0 && !hydrating && listError === null ? (
          <EmptyState
            title="No notices yet"
            note="Notices appear here once the first draft is saved. Archived notices remain in this list; nothing is hard-deleted."
          />
        ) : null}

        {rows.length > 0 ? (
        <div className={`table--scroll ${styles.tableShell}`}>
          <table className={`table ${styles.table}`}>
            <caption className="sr-only">Notices with pinned state, audience, workflow status, version, owner, review note and due date</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col" className={styles.colMore}>Category</th>
                <th scope="col">Audience</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.colMore}>Pinned</th>
                <th scope="col" className={`num ${styles.colMore}`}>Version</th>
                <th scope="col" className="num">Publish date</th>
                <th scope="col" className={styles.colOptional}>Owner</th>
                <th scope="col" className={styles.colOptional}>Review note</th>
                <th scope="col" className={`num ${styles.colOptional}`}>Review due</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selfAuthored = row.authorAccountId !== null && row.authorAccountId === summary?.accountId;
                const editorCanRevise = row.status === "Draft" || row.status === "Archived" || row.status === "Expired";
                return (
                  <tr key={row.key}>
                    <td className={styles.cellTitle}>{row.title}</td>
                    <td className={styles.colMore}>{row.category}</td>
                    <td>{AUDIENCE_LABEL[row.audience]}</td>
                    <td>
                      <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>
                    </td>
                    <td className={styles.colMore}>{row.pinned ? "Pinned" : "—"}</td>
                    <td className={`num ${styles.colMore}`}>v{row.version}</td>
                    <td className="num">{row.publishedLabel}</td>
                    <td className={styles.colOptional}>{row.owner}</td>
                    <td className={styles.colOptional}>{row.publishNote ?? "Not added"}</td>
                    <td className={`num ${styles.colOptional}`}>{row.reviewDue}</td>
                    <td className={styles.cellActions}>
                      {canDraft && editorCanRevise ? (
                        <Button variant="quiet" type="button" onClick={() => editRow(row)} disabled={busy || editingSlug !== null}>
                          {row.status === "Draft" ? "Edit" : "Start revision"}
                        </Button>
                      ) : null}
                      {canDraft && row.status === "Draft" ? (
                        <Button variant="quiet" type="button" disabled={busy} onClick={() => void requestReview(row)}>
                          Request review
                        </Button>
                      ) : null}
                      {canPublish && row.status === "In review" ? (
                        selfAuthored ? (
                          <span>A different publisher must approve</span>
                        ) : (
                          <Button variant="quiet" type="button" disabled={busy} onClick={() => void approve(row)}>
                            Approve
                          </Button>
                        )
                      ) : null}
                      {canPublish && row.status === "Approved" ? (
                        selfAuthored ? (
                          <span>A different publisher must publish</span>
                        ) : (
                          <Button variant="quiet" type="button" disabled={busy} onClick={() => setReleaseSlug(row.key)}>
                            Prepare release
                          </Button>
                        )
                      ) : null}
                      {canPublish && (row.status === "Published" || row.status === "Scheduled") ? (
                        confirmUnpublishSlug === row.key ? (
                          <div
                            className={styles.confirmInline}
                            role="group"
                            aria-label={`Confirm ${row.status === "Scheduled" ? "cancelling the schedule" : "unpublishing"} ${row.title}`}
                          >
                            <span className={styles.confirmText}>
                              {row.status === "Scheduled"
                                ? "Cancel this scheduled release? The approved version is archived before it publishes and nothing appears on the public board."
                                : "Unpublish and archive this notice? It leaves the public board and the guardian portal immediately; republishing needs a new reviewed version."}
                            </span>
                            <div className={styles.confirmButtons}>
                              <button
                                type="button"
                                className="btn btn-quiet"
                                disabled={busy}
                                autoFocus
                                onClick={cancelUnpublish}
                              >
                                Keep {row.status === "Scheduled" ? "scheduled" : "published"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger"
                                disabled={busy}
                                onClick={() => void unpublish(row)}
                              >
                                {row.status === "Scheduled" ? "Cancel schedule" : "Unpublish"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-quiet"
                            disabled={busy}
                            ref={(element) => {
                              unpublishTriggerRefs.current[row.key] = element;
                            }}
                            onClick={() => setConfirmUnpublishSlug(row.key)}
                          >
                            {row.status === "Scheduled" ? "Cancel schedule" : "Unpublish"}
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        ) : null}

        {editingSlug !== null && (
          <div className={styles.editPanel} aria-label={`Editing notice ${editTitle}`}>
            <h3 className={styles.panelTitle}>Edit draft version</h3>
            <div className="field">
              <label htmlFor="edit-title">Title</label>
              <input
                id="edit-title"
                className="input"
                type="text"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-category">Category</label>
              <select
                id="edit-category"
                className="select"
                value={editCategory}
                onChange={(event) => setEditCategory(event.target.value as NoticeCategory)}
              >
                {noticeCategories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="edit-audience">Audience</label>
              <select
                id="edit-audience"
                className="select"
                value={editAudience}
                onChange={(event) => setEditAudience(event.target.value as ContentNotice["audience"])}
              >
                <option value="public">Public</option>
                <option value="family">Family</option>
              </select>
              <p className="field-help">Public notices appear on the school website; family notices appear only in the guardian portal.</p>
            </div>
            <div className="field">
              <label htmlFor="edit-body">Body</label>
              <textarea
                id="edit-body"
                className="textarea"
                value={editBody}
                onChange={(event) => setEditBody(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-review-note">Review and publish note</label>
              <input
                id="edit-review-note"
                className="input"
                type="text"
                value={editReviewNote}
                onChange={(event) => setEditReviewNote(event.target.value)}
                placeholder="What changed and why it should be published."
              />
              <p className="field-help">Required before review; it becomes part of the immutable reviewed version.</p>
            </div>
            <div className="field">
              <label htmlFor="edit-review-due">Review due (optional)</label>
              <input
                id="edit-review-due"
                className="input"
                type="date"
                value={editReviewDue}
                onChange={(event) => setEditReviewDue(event.target.value)}
              />
              <p className="field-help">The date the content team should review this notice again. Leave blank to clear it.</p>
            </div>
            <label className={styles.checkRow}>
              <input
                className={styles.check}
                type="checkbox"
                checked={editPinned}
                onChange={(event) => setEditPinned(event.target.checked)}
              />
              <span>Pin this notice</span>
            </label>
            <p className="field-help">A version already in review or approved cannot be changed. Save a new draft revision instead.</p>
            <div className={styles.formActions}>
              <Button variant="primary" type="button" disabled={busy} onClick={() => void saveEdit()}>
                Save changes
              </Button>
              <Button variant="quiet" type="button" disabled={busy} onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="publisher-heading">
        {canDraft ? (
          <>
            <h2 id="publisher-heading" className={styles.panelTitle}>Create a notice draft</h2>
            <form className={styles.form} onSubmit={(event) => void handleSaveDraft(event)} noValidate>
              <div className={`field ${errors.title ? "field--invalid" : ""}`}>
                <label htmlFor="notice-title">Title</label>
                <input
                  id="notice-title"
                  className="input"
                  type="text"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    clearError("title");
                  }}
                  placeholder="e.g. School photograph day"
                  aria-invalid={errors.title !== undefined}
                  aria-describedby={errors.title ? "notice-title-error" : undefined}
                />
                {errors.title && <p className="field-error" id="notice-title-error">{errors.title}</p>}
              </div>

              <div className="field">
                <label htmlFor="notice-category">Category</label>
                <select
                  id="notice-category"
                  className="select"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as NoticeCategory)}
                >
                  {noticeCategories.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="notice-audience">Audience</label>
                <select
                  id="notice-audience"
                  className="select"
                  value={audience}
                  onChange={(event) => setAudience(event.target.value as ContentNotice["audience"])}
                >
                  <option value="public">Public</option>
                  <option value="family">Family</option>
                </select>
                <p className="field-help">Public notices appear on the school website; family notices appear only in the guardian portal.</p>
              </div>

              <div className={`field ${errors.body ? "field--invalid" : ""}`}>
                <label htmlFor="notice-body">Body</label>
                <textarea
                  id="notice-body"
                  className="textarea"
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                    clearError("body");
                  }}
                  placeholder="What families need to know."
                  aria-invalid={errors.body !== undefined}
                  aria-describedby={errors.body ? "notice-body-error" : undefined}
                />
                {errors.body && <p className="field-error" id="notice-body-error">{errors.body}</p>}
              </div>

              <div className="field">
                <label htmlFor="notice-note">Review and publish note</label>
                <input
                  id="notice-note"
                  className="input"
                  type="text"
                  value={reviewNote}
                  onChange={(event) => {
                    setReviewNote(event.target.value);
                    clearError("note");
                  }}
                  placeholder="What changed and why it should be published."
                />
                <p className="field-help">You may save without it, but a note is required before requesting review.</p>
              </div>

              <label className={styles.checkRow}>
                <input
                  className={styles.check}
                  type="checkbox"
                  checked={urgent}
                  onChange={(event) => setUrgent(event.target.checked)}
                />
                <span>Mark as urgent</span>
              </label>

              <label className={styles.checkRow}>
                <input
                  className={styles.check}
                  type="checkbox"
                  checked={pinnedNotice}
                  onChange={(event) => setPinnedNotice(event.target.checked)}
                />
                <span>Pin this notice</span>
              </label>

              <div className="field">
                <label htmlFor="notice-review-due">Review due (optional)</label>
                <input
                  id="notice-review-due"
                  className="input"
                  type="date"
                  value={reviewDue}
                  onChange={(event) => setReviewDue(event.target.value)}
                />
                <p className="field-help">The date the content team should review this notice again. Leave blank when no review date is set.</p>
              </div>

              <div className={styles.formActions}>
                <Button variant="primary" type="submit" disabled={busy}>Save draft</Button>
              </div>
            </form>
          </>
        ) : canPublish ? (
          <>
            <h2 id="publisher-heading" className={styles.panelTitle}>Release an approved notice</h2>
            {releaseCandidates.length === 0 ? (
              <p className="field-help">No approved notice from another editor is ready. Approve an in-review version first.</p>
            ) : (
              <form className={styles.form} onSubmit={(event) => void release(event)} noValidate>
                <div className="field">
                  <label htmlFor="release-notice">Approved notice</label>
                  <select
                    id="release-notice"
                    className="select"
                    value={selectedReleaseSlug}
                    onChange={(event) => {
                      setReleaseSlug(event.target.value);
                      setErrors((previous) => ({ ...previous, note: undefined }));
                    }}
                  >
                    {releaseCandidates.map((notice) => (
                      <option key={notice.slug} value={notice.slug}>v{notice.version} · {notice.title}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <span>Approved publish note</span>
                  <p>{selectedRelease?.publishNote ?? "No note recorded"}</p>
                  {errors.note && <p className="field-error" role="alert">{errors.note}</p>}
                </div>
                <div className="field">
                  <span>Approved audience</span>
                  <p>{selectedRelease ? AUDIENCE_LABEL[selectedRelease.audience] : "—"}</p>
                  <p className="field-help">The approved audience is locked for this release.</p>
                </div>
                <div className="field">
                  <label htmlFor="notice-schedule">Schedule publish (optional)</label>
                  <input
                    id="notice-schedule"
                    className="input"
                    type="date"
                    value={scheduleDate}
                    onChange={(event) => setScheduleDate(event.target.value)}
                  />
                  <p className="field-help">The selected date begins at 00:00 in Asia/Kolkata. Leave blank to publish now.</p>
                </div>
                <div className={styles.formActions}>
                  <Button variant="primary" type="submit" disabled={busy}>
                    {scheduleDate ? "Schedule publication" : "Publish now"}
                  </Button>
                </div>
              </form>
            )}
          </>
        ) : (
          <>
            <h2 id="publisher-heading" className={styles.panelTitle}>Notice workflow</h2>
            <p className="field-help">This workspace is read-only for the active role.</p>
          </>
        )}

        <p className="field-help">
          {isSupabase
            ? "Draft, review, approval and release use immutable content versions. The approved publish note and audience cannot be changed during release."
            : "Demo writes persist for this browser session. A different account is still required for approval; switching only the same account's role does not satisfy maker/checker."}
        </p>
      </section>
    </div>
  );
}
