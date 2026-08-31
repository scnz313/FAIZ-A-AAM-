"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import PageIntro from "@/components/public/PageIntro";
import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { contentService, noticeCategories, type ContentNotice, type DownloadItem, type NoticeCategory } from "@/modules/services/content";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./page.module.css";

const CATEGORY_TONE: Record<NoticeCategory, "alert" | "watch" | "neutral"> = {
  Admissions: "watch",
  Examination: "watch",
  Holiday: "neutral",
  General: "neutral",
  Sports: "neutral",
  Environment: "alert",
};

type DemoFileState = "demo-preview" | "missing" | "access-denied";

type PreviewDocument = {
  id: string;
  title: string;
  fileName: string;
  format: string;
  size: string;
  updated: string;
  description: string;
};

const FILE_STATES: ReadonlyArray<{ value: DemoFileState; label: string }> = [
  { value: "demo-preview", label: "Demo preview — metadata only" },
  { value: "missing", label: "Missing file" },
  { value: "access-denied", label: "Access denied" },
];

const STATE_COPY: Record<DemoFileState, { title: string; description: string }> = {
  "demo-preview": {
    title: "Demo preview only",
    description: "This sheet shows fictional metadata. No public file is served by the frontend demo.",
  },
  missing: {
    title: "File not available",
    description: "The notice has metadata, but no file is attached to this demo record yet. Ask the school office to provide it.",
  },
  "access-denied": {
    title: "Access denied",
    description: "This simulates a server authorization response. Return to the notice or contact the school office. No file was requested or exposed.",
  },
};

const DOWNLOAD_COPY: Record<DemoFileState, string> = {
  "demo-preview": "Demo file not provided — this preview contains metadata only, so no download started.",
  missing: "Demo file not provided — this record has no attached file. Ask the school office to upload it.",
  "access-denied": "Demo download blocked — access denied. No file was requested or exposed.",
};

function DocumentPreviewDialog({
  file,
  trigger,
  onClose,
}: {
  file: PreviewDocument;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [fileState, setFileState] = useState<DemoFileState>("demo-preview");
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

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

  function selectState(value: DemoFileState) {
    setFileState(value);
    setDownloadMessage(null);
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.previewDialog}
      aria-labelledby="notice-document-preview-title"
      aria-describedby="notice-document-preview-live-state"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
    >
      <div className={styles.previewContent}>
        <div className={styles.previewHeader}>
          <div>
            <p className="section-label">Public download · demo</p>
            <h2 id="notice-document-preview-title" className={styles.previewTitle}>
              {file.title}
            </h2>
          </div>
          <button ref={closeRef} type="button" className={`button button--quiet ${styles.previewClose}`} onClick={closeDialog}>
            Close
          </button>
        </div>

        <dl className={styles.previewMeta}>
          <div>
            <dt>Demo file label</dt>
            <dd className="num">{file.fileName}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{file.format}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{file.size}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd className="num">{file.updated}</dd>
          </div>
        </dl>

        <div className={styles.previewControl}>
          <label htmlFor="notice-document-preview-selector">Demo file state</label>
          <select
            id="notice-document-preview-selector"
            className="select"
            value={fileState}
            onChange={(event) => selectState(event.target.value as DemoFileState)}
          >
            {FILE_STATES.map((state) => (
              <option key={state.value} value={state.value}>
                {state.label}
              </option>
            ))}
          </select>
          <p className="field-help">State selector for review only — it does not request a public file.</p>
        </div>

        <section
          id="notice-document-preview-live-state"
          className={styles.previewState}
          data-state={fileState}
          role={fileState === "demo-preview" ? "status" : "alert"}
          aria-live="polite"
        >
          <p className={styles.previewStateTitle}>{STATE_COPY[fileState].title}</p>
          <p>{STATE_COPY[fileState].description}</p>
          <div className={styles.previewSheet} aria-label="Fictional demo document preview">
            <span className={styles.previewWatermark}>FICTIONAL DEMO · NOT AN OFFICIAL DOCUMENT</span>
            <strong>{file.title}</strong>
            <span>{file.description}</span>
          </div>
        </section>

        {downloadMessage ? (
          <p className={styles.downloadMessage} role="alert" aria-live="assertive">
            {downloadMessage}
          </p>
        ) : null}

        <div className={styles.previewActions}>
          <button type="button" className="button button--primary" onClick={() => setDownloadMessage(DOWNLOAD_COPY[fileState])}>
            Download demo
          </button>
          <button type="button" className="button button--quiet" onClick={closeDialog}>
            Close preview
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Interactive body of the notices page: the category filter reads the URL
 * search params, and the downloads register opens a metadata-only preview.
 * No files are served — delivery arrives with the document backend.
 */
function NoticesBody() {
  const searchParams = useSearchParams();
  const category = searchParams.get("category");
  const active = (noticeCategories as string[]).includes(category ?? "") ? (category as NoticeCategory) : null;
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [items, setItems] = useState<ContentNotice[] | null>(null);
  const [downloads, setDownloads] = useState<DownloadItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  /* The published, public notice list and the file register come from the
     content service — the same records the portal and staff workspaces read.
     A failed load shows a recoverable state; retry repeats the same read. */
  const load = useCallback(() => {
    setLoadFailed(false);
    let cancelled = false;
    void Promise.all([contentService.listForAudience("public"), contentService.listDownloads()])
      .then(([list, files]) => {
        if (cancelled) return;
        setItems(list);
        setDownloads(files);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  if (loadFailed) {
    return (
      <div className={styles.body}>
        <div className={`panel ${styles.errorPanel}`} role="alert">
          <p className={styles.emptyTitle}>Notices could not be loaded.</p>
          <p className={styles.empty}>
            The notice list did not load. Check your connection and try again — nothing was lost.
          </p>
          <div className={styles.errorActions}>
            <button type="button" className="button button--primary" onClick={load}>
              Try again
            </button>
            <Link className="link-arrow" href="/">
              Return to the school homepage →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (items === null || downloads === null) {
    return (
      <div className={styles.body}>
        <p className={styles.empty} role="status">
          Loading notices…
        </p>
      </div>
    );
  }

  const visible = active ? items.filter((notice) => notice.category === active) : items;
  const ordered = [...visible].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  function openPreview(file: PreviewDocument, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setPreview(file);
  }

  return (
    <div className={styles.body}>
      <nav className={styles.filters} aria-label="Filter notices by category">
        <Link
          className={active === null ? `${styles.filter} ${styles.active}` : styles.filter}
          href="/notices"
          aria-current={active === null ? "true" : undefined}
        >
          All
        </Link>
        {noticeCategories.map((item) => (
          <Link
            key={item}
            className={active === item ? `${styles.filter} ${styles.active}` : styles.filter}
            href={`/notices?category=${item}`}
            aria-current={active === item ? "true" : undefined}
          >
            {item}
          </Link>
        ))}
      </nav>

      <ul className={styles.list}>
        {ordered.map((notice) => (
          <li key={notice.slug} className={notice.urgent ? `${styles.row} ${styles.urgent}` : styles.row}>
            <div className={styles.rowMeta}>
              <span className="section-label">{notice.category}</span>
              <span className={`num ${styles.rowDate}`}>{formatKolkata(notice.dateIso, { format: "day" })}</span>
              {notice.urgent ? <span className="status-badge status-badge--alert">Urgent</span> : null}
              {notice.pinned ? <span className="status-badge status-badge--watch">Pinned</span> : null}
            </div>
            <Link className={styles.rowLink} href={`/notices/${notice.slug}`}>
              <strong>{notice.title}</strong>
              <span className={styles.rowExcerpt}>{notice.excerpt}</span>
            </Link>
          </li>
        ))}
      </ul>

      {ordered.length === 0 ? <p className={styles.empty}>No notices in this category yet.</p> : null}

      <section className={styles.downloads} aria-labelledby="downloads-heading">
        <div className={styles.sectionHead}>
          <div>
            <p className="section-label">Downloads</p>
            <h2 className={styles.downloadsTitle} id="downloads-heading">
              Forms and documents.
            </h2>
          </div>
          <span className="demo-badge">{clientAdapterMode() === "supabase" ? "Authoritative register" : "Demo data"}</span>
        </div>
        <div className="table--scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Format</th>
                <th scope="col" className="num">
                  Size
                </th>
                <th scope="col">Updated</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {downloads.map((file) => {
                const document: PreviewDocument = {
                  id: `public-download-${file.name}`,
                  title: file.name,
                  fileName: `${file.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.demo.pdf`,
                  format: `${file.kind} metadata preview`,
                  size: file.size,
                  updated: file.updated,
                  description: "A fictional public-download preview. The demo does not contain a downloadable file.",
                };
                return (
                  <tr key={file.name}>
                    <td>
                      <strong className={styles.downloadName}>{file.name}</strong>
                    </td>
                    <td>{file.kind}</td>
                    <td className="num">{file.size}</td>
                    <td className="num">{file.updated}</td>
                    <td>
                      <button
                        type="button"
                        className={`button button--quiet button--small ${styles.downloadButton}`}
                        onClick={(event) => openPreview(document, event.currentTarget)}
                      >
                        Preview (demo)
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={styles.downloadNote} aria-live="polite">
          Preview a row to inspect its fictional metadata and choose a safe demo state. No public file is served from this frontend.
        </p>
      </section>

      <p className={styles.note}>{CONTENT_DEMO_NOTE}</p>

      {preview ? (
        <DocumentPreviewDialog
          key={preview.id}
          file={preview}
          trigger={triggerRef.current}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

export default function NoticesPage() {
  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="School office"
        title="Notices & downloads"
        deck="Official notices are published here and dated; urgent items carry a mark."
      />
      <Suspense
        fallback={
          <div className={styles.body}>
            <p className={styles.empty}>Loading notices…</p>
          </div>
        }
      >
        <NoticesBody />
      </Suspense>
    </div>
  );
}
