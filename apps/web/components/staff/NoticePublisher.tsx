"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { contentService, noticeCategories, type ContentNotice, type NoticeCategory } from "@/modules/services/content";
import { formatKolkata } from "@/modules/iot/domain";
import { canRole } from "@/modules/services/staff-authorization";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./NoticePublisher.module.css";

type RowStatus = "Published" | "Draft" | "Scheduled" | "Expired";

type NoticeRow = {
  key: string;
  title: string;
  category: NoticeCategory;
  status: RowStatus;
  publishedLabel: string;
  owner: string;
  reviewDue: string;
};

const STATUS_TONE: Record<RowStatus, "good" | "neutral" | "watch" | "alert"> = {
  Published: "good",
  Draft: "neutral",
  Scheduled: "watch",
  Expired: "alert",
};

/** Note recorded when a row is (re)published directly from the list. */
const LIST_REPUBLISH_NOTE = "Published from the notices list (demo)";

function rowStatus(notice: ContentNotice): RowStatus {
  if (notice.status === "expired") return "Expired";
  if (notice.status === "draft") return "Draft";
  if (notice.scheduledForIso !== null && notice.scheduledForIso > new Date().toISOString()) return "Scheduled";
  return "Published";
}

function toRows(notices: ContentNotice[]): NoticeRow[] {
  return notices.map((notice) => ({
    key: notice.slug,
    title: notice.title,
    category: notice.category,
    status: rowStatus(notice),
    publishedLabel: notice.status === "published" ? formatKolkata(notice.dateIso, { format: "day" }) : "—",
    owner: "A. Lone",
    reviewDue: notice.reviewDue,
  }));
}

type Errors = { title?: string; body?: string; note?: string };

type NoticePublisherProps = {
  notices: ContentNotice[];
};

/**
 * Demo notice publisher: the notice list plus the draft/schedule/publish
 * form. Every write goes through the content service, so a published notice
 * immediately reaches the public and portal lists and the version bumps with
 * a recorded publish note. Real scheduling and delivery arrive with the CMS
 * backend; nothing here is persisted beyond the demo session.
 */
export function NoticePublisher({ notices }: NoticePublisherProps) {
  const [rows, setRows] = useState<NoticeRow[]>(() => toRows(notices));
  /* Phase-1 split: editors draft (content.draft), publishers review and
     publish (content.publish). Hidden controls stay hidden — the content
     service and later the backend enforce the grant. */
  const { summary } = useStaffContext();
  const canPublish = canRole(summary?.role ?? "", "content.publish");
  const canDraft = canRole(summary?.role ?? "", "content.draft");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<NoticeCategory>("General");
  const [body, setBody] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [publishNote, setPublishNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState<NoticeCategory>("General");
  const [editBody, setEditBody] = useState("");

  function announce(text: string) {
    setAnnouncement((prev) => ({ key: (prev?.key ?? 0) + 1, text }));
  }

  /** Re-read the service list so every consumer shows the same records. */
  async function refreshRows(): Promise<void> {
    const list = await contentService.listForStaff();
    setRows(toRows(list));
  }

  function validate(needsNote: boolean): boolean {
    const next: Errors = {
      title: title.trim() ? undefined : "Title is required.",
      body: body.trim() ? undefined : "Body is required.",
      note: needsNote && publishNote.trim() === "" ? "A publish note is required." : undefined,
    };
    setErrors(next);
    return next.title === undefined && next.body === undefined && next.note === undefined;
  }

  function clearError(field: keyof Errors) {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  function resetForm() {
    setTitle("");
    setBody("");
    setScheduleDate("");
    setPublishNote("");
    setUrgent(false);
  }

  async function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const immediate = scheduleDate.trim() === "";
    if (!validate(immediate)) return;
    setBusy(true);
    try {
      const created = await contentService.createNotice({
        title,
        category,
        body: [body.trim()],
        urgent,
        scheduledForIso: immediate ? null : `${scheduleDate.trim()}T00:00:00.000Z`,
      });
      if (immediate) {
        const result = await contentService.publishNotice(created.slug, {
          note: publishNote.trim(),
          audience: "public",
        });
        if (result.ok) {
          await refreshRows();
          resetForm();
          announce("Notice published (demo).");
        } else {
          setErrors({ note: result.message });
        }
      } else {
        await refreshRows();
        resetForm();
        announce("Notice scheduled (demo).");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft() {
    if (busy) return;
    if (!validate(false)) return;
    setBusy(true);
    try {
      await contentService.createNotice({ title, category, body: [body.trim()], urgent });
      await refreshRows();
      resetForm();
      announce("Draft saved (demo).");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(row: NoticeRow) {
    if (busy) return;
    setBusy(true);
    try {
      if (row.status === "Published" || row.status === "Scheduled") {
        const result = await contentService.unpublishNotice(row.key);
        if (result.ok) {
          await refreshRows();
          announce(`Notice "${row.title}" unpublished (demo).`);
        }
      } else {
        const result = await contentService.publishNotice(row.key, { note: LIST_REPUBLISH_NOTE });
        if (result.ok) {
          await refreshRows();
          announce(`Notice "${row.title}" published (demo).`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function editRow(row: NoticeRow) {
    setEditingSlug(row.key);
    setEditTitle(row.title);
    setEditCategory(row.category);
    const notice = notices.find((n) => n.slug === row.key);
    setEditBody(notice ? notice.body.join("\n") : "");
  }

  async function saveEdit() {
    if (busy || editingSlug === null) return;
    if (!editTitle.trim() || !editBody.trim()) {
      announce("Title and body are required to save edits.");
      return;
    }
    setBusy(true);
    try {
      const result = await contentService.editNotice(editingSlug, {
        title: editTitle.trim(),
        category: editCategory,
        body: editBody.split("\n").filter((line) => line.trim() !== ""),
      });
      if (result.ok) {
        await refreshRows();
        announce(`Notice "${editTitle.trim()}" updated (demo).`);
        cancelEdit();
      } else {
        announce(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit() {
    setEditingSlug(null);
    setEditTitle("");
    setEditCategory("General");
    setEditBody("");
  }

  return (
    <div className={styles.publisherGrid}>
      <section className="panel" aria-labelledby="notice-list-heading">
        <div className={styles.panelHead}>
          <h2 id="notice-list-heading" className={styles.panelTitle}>
            Notices
          </h2>
      <span className="demo-badge">{clientAdapterMode() === "supabase" ? "Live projection" : "Demo data"}</span>
        </div>

        {announcement && (
          <p key={announcement.key} className={styles.liveNote} aria-live="polite">
            {announcement.text}
          </p>
        )}

        <div className="table--scroll">
          <table className={`table ${styles.table}`}>
            <caption className="sr-only">Notices with status, owner and review due date</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Published</th>
                <th scope="col">Owner</th>
                <th scope="col" className="num">Review due</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className={styles.cellTitle}>{row.title}</td>
                  <td>{row.category}</td>
                  <td>
                    <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>
                  </td>
                  <td className="num">{row.publishedLabel}</td>
                  <td>{row.owner}</td>
                  <td className="num">{row.reviewDue}</td>
                  <td className={styles.cellActions}>
                    <Button variant="quiet" onClick={() => editRow(row)} disabled={busy || editingSlug !== null}>
                      Edit
                    </Button>
                    {canPublish ? (
                      <Button variant="quiet" disabled={busy} onClick={() => void toggleStatus(row)}>
                        {row.status === "Draft" || row.status === "Expired" ? "Publish" : "Unpublish"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingSlug !== null && (
          <div className={styles.editPanel} aria-label={`Editing notice ${editTitle}`}>
            <h3 className={styles.panelTitle}>Edit notice</h3>
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
              <label htmlFor="edit-body">Body</label>
              <textarea
                id="edit-body"
                className="textarea"
                value={editBody}
                onChange={(event) => setEditBody(event.target.value)}
              />
            </div>
            <p className="field-help">Only draft and scheduled notices can be edited. Published notices must be unpublished first.</p>
            <div className={styles.formActions}>
              <Button variant="primary" disabled={busy} onClick={() => void saveEdit()}>
                Save changes
              </Button>
              <Button variant="quiet" disabled={busy} onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="publisher-heading">
        <h2 id="publisher-heading" className={styles.panelTitle}>
          Publish a notice
        </h2>

        <form className={styles.form} onSubmit={(event) => void handlePublish(event)} noValidate>
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
            {errors.title && (
              <p className="field-error" id="notice-title-error">
                {errors.title}
              </p>
            )}
          </div>

          <div className={styles.formGrid}>
            <div className="field">
              <label htmlFor="notice-category">Category</label>
              <select
                id="notice-category"
                className="select"
                value={category}
                onChange={(event) => setCategory(event.target.value as NoticeCategory)}
              >
                {noticeCategories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            {canPublish ? (
              <div className="field">
                <label htmlFor="notice-schedule">Schedule publish (optional)</label>
                <input
                  id="notice-schedule"
                  className="input"
                  type="date"
                  value={scheduleDate}
                  onChange={(event) => setScheduleDate(event.target.value)}
                />
              </div>
            ) : null}
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
            {errors.body && (
              <p className="field-error" id="notice-body-error">
                {errors.body}
              </p>
            )}
          </div>

          {canPublish ? (
            <div className={`field ${errors.note ? "field--invalid" : ""}`}>
              <label htmlFor="notice-note">Publish note</label>
              <input
                id="notice-note"
                className="input"
                type="text"
                value={publishNote}
                onChange={(event) => {
                  setPublishNote(event.target.value);
                  clearError("note");
                }}
                placeholder="Why this notice is published now."
                aria-invalid={errors.note !== undefined}
                aria-describedby={errors.note ? "notice-note-error" : undefined}
              />
              {errors.note && (
                <p className="field-error" id="notice-note-error">
                  {errors.note}
                </p>
              )}
              <p className="field-help">Required for immediate publish — the note is recorded with the published version.</p>
            </div>
          ) : null}

          <label className={styles.checkRow}>
            <input
              className={styles.check}
              type="checkbox"
              checked={urgent}
              onChange={(event) => setUrgent(event.target.checked)}
            />
            <span>Mark as urgent</span>
          </label>

          <p className="field-help">A notice with a future date stays in Scheduled until it publishes.</p>

          <div className={styles.formActions}>
            {canPublish ? (
              <Button variant="primary" type="submit" disabled={busy}>
                Publish now
              </Button>
            ) : null}
            {canDraft ? (
              <Button variant="quiet" type="button" onClick={() => void handleSaveDraft()} disabled={busy}>
                Save draft
              </Button>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
