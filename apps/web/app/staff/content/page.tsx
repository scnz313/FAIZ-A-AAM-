"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { EmptyState, ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import {
  contentService,
  type ContentActor,
  type ContentNotice,
  type NoticeStatus,
  type PublicPageReviewStatus,
  type PublicPageRow,
} from "@/modules/services/content";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";

import styles from "./page.module.css";

const PAGE_STATUS_TONE: Record<PublicPageReviewStatus, "good" | "neutral" | "watch"> = {
  Published: "good",
  Scheduled: "watch",
  Approved: "good",
  Draft: "neutral",
  "Needs review": "watch",
  "In review": "watch",
  Archived: "neutral",
};

const NOTICE_STATUS_TONE: Record<NoticeStatus, "good" | "neutral" | "alert"> = {
  published: "good",
  scheduled: "neutral",
  draft: "neutral",
  expired: "alert",
  archived: "neutral",
};

/** Same display casing as the notices register (no raw enum values in UI). */
const NOTICE_STATUS_LABEL: Record<NoticeStatus, string> = {
  published: "Published",
  scheduled: "Scheduled",
  draft: "Draft",
  expired: "Expired",
  archived: "Archived",
};

const AUDIENCE_LABEL: Record<ContentNotice["audience"], string> = {
  public: "Public",
  family: "Family",
};

type PageAction = { next: PublicPageReviewStatus; label: string };

/** Scheduled pages show the effective instant as quiet supporting copy. */
function pageScheduleNote(iso: string | null): string | null {
  if (iso === null || iso === "") return null;
  try {
    return formatKolkata(iso, { format: "full" });
  } catch {
    return null;
  }
}

function pageActions(row: PublicPageRow, canDraft: boolean, canPublish: boolean): PageAction[] {
  if (row.reviewStatus === "draft" && row.currentStatus === "draft" && canDraft) {
    return [{ next: "In review", label: "Request review" }];
  }
  if (row.reviewStatus === "in_review" && canPublish) {
    return [{ next: "Approved", label: "Approve" }];
  }
  if (row.reviewStatus === "approved" && row.currentStatus === "draft" && canPublish) {
    return [
      { next: "Published", label: "Publish" },
      { next: "Scheduled", label: "Schedule" },
    ];
  }
  return [];
}

type DraftPreviewBody = {
  title: string;
  body: string[];
  updatedAtIso: string | null;
};

/* Read-only draft preview. It renders the stored draft through the public
   typography (serif title, ruled meta, lede plus body) so publishers see
   what approval would release. It never writes, never publishes, and never
   links to a public route. Focus is trapped by the modal dialog, Escape
   closes via onCancel, and closing returns focus to the invoking button. */
function DraftPreviewDialog({
  row,
  body,
  loading,
  error,
  trigger,
  onClose,
}: {
  row: PublicPageRow;
  body: DraftPreviewBody | null;
  loading: boolean;
  error: string | null;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  function closeDialog() {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    onClose();
    trigger?.focus();
  }

  const paragraphs = body?.body ?? [];
  const [lede, ...rest] = paragraphs;

  return (
    <dialog
      ref={dialogRef}
      className={styles.previewDialog}
      aria-labelledby="page-draft-preview-title"
      aria-describedby="page-draft-preview-guard"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
    >
      <div className={styles.previewContent}>
        <div className={styles.previewHeader}>
          <div>
            <p className="section-label">Draft preview · not published</p>
            <h2 id="page-draft-preview-title" className={styles.previewTitle}>
              {body?.title ?? row.label}
            </h2>
          </div>
          <button ref={closeRef} type="button" className="btn btn-quiet" onClick={closeDialog}>
            <span className="msym" aria-hidden="true" style={{ fontSize: 16 }}>close</span>Close
          </button>
        </div>

        <p className={styles.previewMeta}>
          <span className="num">/{row.key}</span>
          <span>{row.status}</span>
          <span>{row.owner}</span>
          <span className="num">Last reviewed {row.lastReviewed}</span>
        </p>

        <hr className={styles.previewRule} />

        {loading ? (
          <div role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">Loading draft preview…</span>
            <span className="skeleton-rule" aria-hidden="true" />
            <span className="skeleton-bar" style={{ width: "72%" }} aria-hidden="true" />
            <span className="skeleton-bar" style={{ width: "88%" }} aria-hidden="true" />
            <span className="skeleton-bar" style={{ width: "61%" }} aria-hidden="true" />
          </div>
        ) : error !== null ? (
          <p className={styles.previewError} role="alert">{error}</p>
        ) : paragraphs.length === 0 ? (
          <p className={styles.previewError} role="status">No draft paragraphs are stored for this page yet.</p>
        ) : (
          <div>
            {lede !== undefined ? <p className={styles.previewLede}>{lede}</p> : null}
            <div className={styles.previewProse}>
              {rest.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </div>
        )}

        {row.publishNote ? (
          <div className={styles.previewReviewNote}>
            <p className="section-label">Review note · not published</p>
            <p>{row.publishNote}</p>
          </div>
        ) : null}

        <p id="page-draft-preview-guard" className={styles.previewGuard}>
          Draft preview only · this view never publishes and never appears on public routes. Approve and publish from the workflow table.
        </p>
      </div>
    </dialog>
  );
}

export default function ContentPage() {
  const [pages, setPages] = useState<PublicPageRow[] | null>(null);
  const [notices, setNotices] = useState<ContentNotice[] | null>(null);
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);
  /* Inline page scheduling: the approved page row opens a datetime field;
     nothing publishes until the publisher confirms. */
  const [scheduleKey, setScheduleKey] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const { summary } = useStaffContext();
  const actor: ContentActor | null = summary
    ? { accountId: summary.accountId, displayName: summary.displayName, role: summary.role }
    : null;
  const canDraft = canAnyRole(summary?.roles ?? [], "content.draft");
  const canPublish = canAnyRole(summary?.roles ?? [], "content.publish");
  const isDemo = clientAdapterMode() !== "supabase";

  /* Public-page editor state. */
  const [editingPage, setEditingPage] = useState<string | null>(null);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState("");
  const [pageSlug, setPageSlug] = useState("");
  const [pageBody, setPageBody] = useState("");
  const [pageNote, setPageNote] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSaving, setPageSaving] = useState(false);

  /* Draft preview state — read-only; opening a preview never publishes. */
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewBody, setPreviewBody] = useState<DraftPreviewBody | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTrigger, setPreviewTrigger] = useState<HTMLButtonElement | null>(null);

  /* Both tables read through the content service — the notice rows include
     draft and expired states alongside the published list. A failed read is
     surfaced with a retry that repeats the same load, never a silent empty. */
  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setNotices(null);
    setLoadError(null);
    void Promise.all([contentService.listPublicPages(), contentService.listForStaff()])
      .then(([pageRows, noticeRows]) => {
        if (cancelled) return;
        setPages(pageRows);
        setNotices(noticeRows);
      })
      .catch(() => {
        if (cancelled) return;
        setPages([]);
        setNotices([]);
        setLoadError("Content could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function retryLoad() {
    setReloadToken((token) => token + 1);
  }

  function announce(text: string) {
    setAnnouncement((prev) => ({ key: (prev?.key ?? 0) + 1, text }));
  }

  async function advancePage(row: PublicPageRow, action: PageAction) {
    if (pages === null || busy || actor === null) return;
    let scheduledForIso: string | null = null;
    if (action.next === "Scheduled") {
      if (scheduleAt === "") {
        announce("Choose a future date and time to schedule this page.");
        return;
      }
      scheduledForIso = `${scheduleAt}:00+05:30`;
    }
    setBusy(true);
    try {
      const result = await contentService.setPublicPageStatus(row.key, action.next, actor, {
        expectedVersion: row.version,
        scheduledForIso,
      });
      if (result.ok) {
        setPages((previous) =>
          previous ? previous.map((candidate) => (candidate.key === row.key ? result.value : candidate)) : previous,
        );
        if (action.next === "Scheduled") {
          setScheduleKey(null);
          setScheduleAt("");
        }
        announce(`Page "${row.label}" advanced to ${action.next.toLowerCase()}${isDemo ? " in this demo session" : ""}.`);
      } else {
        announce(result.message);
        if (result.code === "stale-version") {
          const latest = await contentService.listPublicPages();
          setPages(latest);
        }
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : "The page workflow could not be updated. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function openNewPage() {
    setEditingPage(null);
    setPageTitle("");
    setPageSlug("");
    setPageBody("");
    setPageNote("");
    setPageError(null);
    setNewPageOpen(true);
  }

  async function openEditPage(row: PublicPageRow) {
    setPageError(null);
    setPageSaving(true);
    try {
      const body = await contentService.getPublicPageBody(row.key);
      setEditingPage(row.key);
      setPageTitle(body?.title ?? row.label);
      setPageSlug(row.key);
      setPageBody((body?.body ?? []).join("\n\n"));
      setPageNote(row.publishNote ?? "");
      setNewPageOpen(false);
    } catch {
      setPageError("The page body could not be loaded. Try again.");
    } finally {
      setPageSaving(false);
    }
  }

  async function savePage() {
    if (actor === null || pageSaving) return;
    const title = pageTitle.trim();
    const body = pageBody.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
    if (title === "" || body.length === 0) {
      setPageError("A title and at least one body paragraph are required.");
      return;
    }
    setPageSaving(true);
    setPageError(null);
    try {
      if (editingPage === null) {
        const slug = pageSlug.trim().replace(/^\/+/, "").replace(/[^a-z0-9-]+/g, "-").replace(/-+$/g, "");
        if (slug === "") {
          setPageError("A route slug is required for a new page.");
          setPageSaving(false);
          return;
        }
        const result = await contentService.createPublicPage({ slug, title, body, publishNote: pageNote, actor });
        if (!result.ok) {
          setPageError(result.message);
          return;
        }
        setPages((previous) => (previous ? [...previous, result.value] : previous));
        announce(`Page "/${slug}" draft created${isDemo ? " in this demo session" : ""}.`);
      } else {
        const row = pages?.find((candidate) => candidate.key === editingPage);
        const result = await contentService.editPublicPage(editingPage, {
          title,
          body,
          publishNote: pageNote,
          actor,
          expectedVersion: row?.itemVersion,
        });
        if (!result.ok) {
          setPageError(result.message);
          if (result.code === "stale-version") {
            const latest = await contentService.listPublicPages();
            setPages(latest);
          }
          return;
        }
        setPages((previous) =>
          previous ? previous.map((candidate) => (candidate.key === editingPage ? result.value : candidate)) : previous,
        );
        announce(`Page "${title}" draft updated${isDemo ? " in this demo session" : ""}.`);
      }
      setEditingPage(null);
      setNewPageOpen(false);
      setPageTitle("");
      setPageSlug("");
      setPageBody("");
      setPageNote("");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "The page draft could not be saved.");
    } finally {
      setPageSaving(false);
    }
  }

  function closePageEditor() {
    setEditingPage(null);
    setNewPageOpen(false);
    setPageError(null);
  }

  /* Preview reads the stored draft through the existing body loader. It
     never writes, so it cannot publish or leak the draft anywhere. */
  async function openPreview(row: PublicPageRow, trigger: HTMLButtonElement | null) {
    setPreviewKey(row.key);
    setPreviewTrigger(trigger);
    setPreviewBody(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const result = await contentService.getPublicPageBody(row.key);
      if (result === null) {
        setPreviewError("No draft body is stored for this page yet. The published record is unchanged.");
      } else {
        setPreviewBody(result);
        announce(`Draft preview opened for "${result.title}". This preview does not publish.`);
      }
    } catch {
      setPreviewError("The draft body could not be loaded. Try again.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewKey(null);
    setPreviewBody(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }

  const previewRow = previewKey === null ? null : (pages?.find((candidate) => candidate.key === previewKey) ?? null);

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Content</h1>
          <p className="ph-sub">Public pages and their review status; notice publishing states.</p>
        </div>
      </div>

      <section className="panel" aria-labelledby="content-list-heading">
        <div className={styles.panelHead}>
          <h2 id="content-list-heading" className={styles.panelTitle}>
            Public pages
          </h2>
          <div className={styles.panelActions}>
            {isDemo ? <span className="demo-badge">Demo data</span> : null}
            {canDraft ? (
              <Button variant="quiet" onClick={openNewPage} disabled={busy || pageSaving}>
                New page draft
              </Button>
            ) : null}
          </div>
        </div>

        {(newPageOpen || editingPage !== null) && canDraft ? (
          <div className={`panel ${styles.pageEditor}`} aria-labelledby="page-editor-heading">
            <div className={styles.editorHead}>
              <h3 id="page-editor-heading" className="section-label">
                {editingPage === null ? "New public page" : `Edit page /${editingPage}`}
              </h3>
              <Button variant="quiet" onClick={closePageEditor} disabled={pageSaving}>
                Close
              </Button>
            </div>
            <div className={styles.editorFields}>
              <div className="field">
                <label htmlFor="page-title">Title</label>
                <input
                  id="page-title"
                  className="input"
                  type="text"
                  value={pageTitle}
                  onChange={(event) => setPageTitle(event.target.value)}
                  disabled={pageSaving}
                />
              </div>
              {editingPage === null ? (
                <div className="field">
                  <label htmlFor="page-slug">Route slug</label>
                  <input
                    id="page-slug"
                    className="input"
                    type="text"
                    value={pageSlug}
                    onChange={(event) => setPageSlug(event.target.value)}
                    placeholder="e.g. school-history"
                    disabled={pageSaving}
                  />
                  <p className="field-help">The public URL becomes /{pageSlug || "…"}. Use lowercase letters, numbers, and dashes.</p>
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="page-body">Body paragraphs</label>
                <textarea
                  id="page-body"
                  className="textarea"
                  rows={8}
                  value={pageBody}
                  onChange={(event) => setPageBody(event.target.value)}
                  placeholder="Separate paragraphs with a blank line."
                  disabled={pageSaving}
                />
              </div>
              <div className="field">
                <label htmlFor="page-note">Review and publish note</label>
                <textarea
                  id="page-note"
                  className="textarea"
                  rows={2}
                  value={pageNote}
                  onChange={(event) => setPageNote(event.target.value)}
                  placeholder="What changed and why it should be published."
                  disabled={pageSaving}
                />
              </div>
              {pageError ? <p className="field-error" role="alert">{pageError}</p> : null}
              <div className={styles.editorActions}>
                <Button variant="primary" onClick={() => void savePage()} disabled={pageSaving || actor === null}>
                  {pageSaving ? "Saving…" : editingPage === null ? "Create draft" : "Save draft"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {loadError !== null ? (
          <ErrorPanel title="Content could not be loaded." note={`${loadError} No content was changed.`}>
            <Button variant="quiet" disabled={busy} onClick={retryLoad}>
              Try again
            </Button>
          </ErrorPanel>
        ) : null}

        {announcement && (
          <p key={announcement.key} className={styles.liveNote} aria-live="polite">
            {announcement.text}
          </p>
        )}

        {pages === null ? (
          <LoadingSkeleton lines={4} label="Loading public pages…" />
        ) : pages.length === 0 && loadError === null ? (
          <EmptyState
            title="No public pages"
            note="Pages appear here once the first draft is created. Archived pages stay in this list; nothing is hard-deleted."
          />
        ) : pages.length > 0 ? (
          <div className={`table--scroll ${styles.tableShell}`} role="region" aria-label="Public pages table" tabIndex={0}>
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Public pages with status, last review and owner</caption>
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Last reviewed</th>
                  <th scope="col">Owner</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pages.map((row) => {
                  const actions = pageActions(row, canDraft, canPublish);
                  const scheduleNote = pageScheduleNote(row.scheduledForIso);
                  const draftAction = actions.find((action) => action.next === "In review") ?? null;
                  const publisherActions = actions.filter((action) => action.next !== "In review");
                  const selfAuthored = row.authorAccountId !== null && row.authorAccountId === actor?.accountId;
                  const canEditRow =
                    canDraft &&
                    (row.reviewStatus === "draft" || row.currentStatus === "archived" || row.currentStatus === "expired");
                  return (
                    <tr key={row.key}>
                      <td>
                        <Link prefetch={false} className={styles.pageLink} href={row.href}>
                          {row.label}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge tone={PAGE_STATUS_TONE[row.status]}>{row.status}</StatusBadge>
                        {scheduleNote !== null ? <span className={styles.scheduleNote}>{scheduleNote}</span> : null}
                      </td>
                      <td className="num">{row.lastReviewed}</td>
                      <td>{row.owner}</td>
                      <td className={styles.cellAction}>
                        {row.key === "school-life" ? (
                          <Link
                            prefetch={false}
                            className="btn btn-quiet"
                            href={canonicalStaffUrl(summary?.profileCode ?? null, "/content/pages/school-life")}
                          >
                            Edit page
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-quiet"
                          disabled={busy || pageSaving}
                          onClick={(event) => void openPreview(row, event.currentTarget)}
                        >
                          <span className="msym" aria-hidden="true" style={{ fontSize: 16 }}>visibility</span>Preview
                        </button>
                        {draftAction !== null ? (
                          <Button variant="quiet" disabled={busy} onClick={() => void advancePage(row, draftAction)}>
                            {draftAction.label}
                          </Button>
                        ) : null}
                        {publisherActions.length > 0 ? (
                          selfAuthored ? (
                            <span>A different publisher is required</span>
                          ) : (
                            publisherActions.map((action) =>
                              action.next === "Scheduled" ? (
                                scheduleKey === row.key ? (
                                  <span key="page-schedule" className={styles.scheduleForm}>
                                    <label className="sr-only" htmlFor={`page-schedule-${row.key}`}>
                                      Schedule publication for {row.label}
                                    </label>
                                    <input
                                      id={`page-schedule-${row.key}`}
                                      className="input"
                                      type="datetime-local"
                                      value={scheduleAt}
                                      onChange={(event) => setScheduleAt(event.target.value)}
                                      disabled={busy}
                                    />
                                    <Button
                                      variant="quiet"
                                      disabled={busy || scheduleAt === ""}
                                      onClick={() => void advancePage(row, action)}
                                    >
                                      Set schedule
                                    </Button>
                                    <Button
                                      variant="quiet"
                                      disabled={busy}
                                      onClick={() => {
                                        setScheduleKey(null);
                                        setScheduleAt("");
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                  </span>
                                ) : (
                                  <Button
                                    key="page-schedule-open"
                                    variant="quiet"
                                    disabled={busy}
                                    onClick={() => {
                                      setScheduleKey(row.key);
                                      setScheduleAt("");
                                    }}
                                  >
                                    Schedule
                                  </Button>
                                )
                              ) : (
                                <Button key={action.label} variant="quiet" disabled={busy} onClick={() => void advancePage(row, action)}>
                                  {action.label}
                                </Button>
                              ),
                            )
                          )
                        ) : null}
                        {canEditRow ? (
                          <Button variant="quiet" disabled={busy || pageSaving} onClick={() => void openEditPage(row)}>
                            Edit
                          </Button>
                        ) : null}
                        {actions.length === 0 && !canEditRow ? (
                          <span aria-label="No action available">—</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="notice-status-heading">
        <div className={styles.panelHead}>
          <h2 id="notice-status-heading" className={styles.panelTitle}>
            Notice status
          </h2>
          {isDemo ? <span className="demo-badge">Demo data</span> : null}
        </div>

        {notices === null ? (
          <LoadingSkeleton lines={4} label="Loading notice status…" />
        ) : notices.length === 0 && loadError === null ? (
          <EmptyState
            title="No notices"
            note="Published, scheduled and draft notices appear here with their audiences and versions. Archived notices remain in this list; nothing is hard-deleted."
          />
        ) : notices.length > 0 ? (
          <div className={`table--scroll ${styles.tableShell}`} role="region" aria-label="Notice status table" tabIndex={0}>
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Notices with pinned state, status, audience, version and review due date</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col" className={styles.colMore}>Category</th>
                  <th scope="col">Audience</th>
                  <th scope="col">Status</th>
                  <th scope="col" className={styles.colMore}>Pinned</th>
                  <th scope="col" className={`num ${styles.colMore}`}>
                    Version
                  </th>
                  <th scope="col" className="num">Published</th>
                  <th scope="col" className={`num ${styles.colOptional}`}>Review due</th>
                </tr>
              </thead>
              <tbody>
                {notices.map((notice) => (
                  <tr key={notice.slug}>
                    <td>
                      <strong>{notice.title}</strong>
                    </td>
                    <td className={styles.colMore}>{notice.category}</td>
                    <td>{AUDIENCE_LABEL[notice.audience]}</td>
                    <td>
                      <StatusBadge tone={NOTICE_STATUS_TONE[notice.status]}>{NOTICE_STATUS_LABEL[notice.status]}</StatusBadge>
                    </td>
                    <td className={styles.colMore}>{notice.pinned ? "Pinned" : "—"}</td>
                    <td className={`num ${styles.colMore}`}>{notice.version}</td>
                    <td className="num">
                      {notice.status === "published" ? formatKolkata(notice.dateIso, { format: "day" }) : "—"}
                    </td>
                    <td className={`num ${styles.colOptional}`}>{notice.reviewDue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <p className={styles.note}>Content changes are versioned; public pages show only published current content. Archiving and unpublishing are terminal · nothing is hard-deleted.</p>
      {isDemo ? (
        <p className="demo-note">
          <span className="demo-badge">Demo data</span> {CONTENT_DEMO_NOTE}
        </p>
      ) : null}
      {previewRow !== null ? (
        <DraftPreviewDialog
          row={previewRow}
          body={previewBody}
          loading={previewLoading}
          error={previewError}
          trigger={previewTrigger}
          onClose={closePreview}
        />
      ) : null}
    </div>
  );
}
