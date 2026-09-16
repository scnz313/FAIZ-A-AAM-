"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_SCHOOL_LIFE_BODY,
  SCHOOL_LIFE_ART_KEYS,
  SCHOOL_LIFE_ICON_NAMES,
  SCHOOL_LIFE_LIMITS,
  parseSchoolLifePageBody,
  schoolLifePageBodySchema,
  type SchoolLifeArtKey,
  type SchoolLifeIconName,
  type SchoolLifePageBody,
} from "@fass/contracts";
import SchoolLifeContent, { SCHOOL_LIFE_ART, SCHOOL_LIFE_ART_LABEL } from "@/components/public/pages/SchoolLifeContent";
import Button from "@/components/ui/Button";
import { EmptyState, ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import RelativeTime from "@/components/ui/RelativeTime";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import {
  contentService,
  type ContentActor,
  type ContentReviewStatus,
  type ManagedPageState,
  type ManagedPageVersion,
} from "@/modules/services/content";
import { canAnyRole } from "@/modules/services/staff-profiles";

import styles from "./page.module.css";

const SLUG = "school-life";

const REVIEW_LABEL: Record<ContentReviewStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  published: "Published",
};

const REVIEW_TONE: Record<ContentReviewStatus, StatusTone> = {
  draft: "neutral",
  in_review: "watch",
  approved: "good",
  published: "good",
};

/** Icon select labels — human names for the subset glyphs. */
const ICON_LABEL: Record<SchoolLifeIconName, string> = {
  sports_cricket: "Sports",
  palette: "Arts",
  volunteer_activism: "Service",
  record_voice_over: "Assemblies",
  map: "Trips",
  science: "Science",
  calendar_month: "Calendar",
  campaign: "Announcements",
  article: "Reading",
  workspace_premium: "Achievement",
  group: "Community",
  history: "History",
};

let idCounter = 0;
function nextItemId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

type FieldErrors = Record<string, string>;

/** Map zod issues onto "section.field" / "section.index.field" keys. */
function collectFieldErrors(body: SchoolLifePageBody): FieldErrors {
  const parsed = schoolLifePageBodySchema.safeParse(body);
  if (parsed.success) return {};
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".");
    if (errors[key] === undefined) errors[key] = issue.message;
  }
  return errors;
}

function cloneBody(body: SchoolLifePageBody): SchoolLifePageBody {
  return JSON.parse(JSON.stringify(body)) as SchoolLifePageBody;
}

function Field({
  id,
  label,
  count,
  max,
  error,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  max?: number;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <label htmlFor={id}>{label}</label>
        {max !== undefined && count !== undefined ? (
          <span className={styles.counter}>
            {count}/{max}
          </span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type RemoveTarget = { section: "programmes" | "facilities" | "gallery"; id: string; label: string };

/**
 * The managed `/school-life` editor. The left column edits every section of
 * the structured page body; the right column renders the real public
 * composition live and lists the immutable version history. Saving appends a
 * new draft version through `content.saveDraft`; review, approval and
 * publication move through the same workspace transitions as every other
 * managed page — a publisher can never publish their own edit.
 */
export default function SchoolLifePageEditor() {
  const { summary } = useStaffContext();
  const roles = summary?.roles ?? [];
  const canDraftPages = canAnyRole(roles, "content.draft") || canAnyRole(roles, "content.publish");
  const canPublishPages = canAnyRole(roles, "content.publish");
  /* The effective role for service writes mirrors the server check: page
     drafts accept the publisher role as well as the editor role. */
  const actor: ContentActor | null = summary
    ? {
        accountId: summary.accountId,
        displayName: summary.displayName,
        role: canAnyRole(roles, "content.publish") ? "content_publisher" : "content_editor",
      }
    : null;

  const [state, setState] = useState<ManagedPageState | null>(null);
  const [body, setBody] = useState<SchoolLifePageBody>(() => cloneBody(DEFAULT_SCHOOL_LIFE_BODY));
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  /* Below the 1200px content container the form and preview swap through this
     toggle; at or above it both render side by side and CSS hides the seg. */
  const [view, setView] = useState<"edit" | "preview">("edit");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await contentService.getPage(SLUG);
      setState(next);
      const latest = next?.versions[0];
      const parsed = parseSchoolLifePageBody(latest?.body);
      setBody(parsed ? cloneBody(parsed) : cloneBody(DEFAULT_SCHOOL_LIFE_BODY));
      setDirty(false);
      setFieldErrors({});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The page record could not be loaded.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const latest: ManagedPageVersion | null = state?.versions[0] ?? null;
  const selfAuthored = latest !== null && actor !== null && latest.authorAccountId === actor.accountId;

  function mutate(recipe: (draft: SchoolLifePageBody) => void) {
    setBody((current) => {
      const next = cloneBody(current);
      recipe(next);
      return next;
    });
    setDirty(true);
  }

  function moveItem<K extends "programmes" | "facilities" | "gallery">(section: K, index: number, delta: -1 | 1) {
    mutate((draft) => {
      const list = draft[section] as Array<{ id: string }>;
      const target = index + delta;
      const item = list[index];
      if (item === undefined || target < 0 || target >= list.length) return;
      list.splice(index, 1);
      list.splice(target, 0, item);
    });
  }

  function confirmRemove() {
    if (removeTarget === null) return;
    const { section, id } = removeTarget;
    mutate((draft) => {
      const list = draft[section] as Array<{ id: string }>;
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) list.splice(index, 1);
    });
    setAnnouncement(`${removeTarget.label} removed. Save the draft to keep this change.`);
    setRemoveTarget(null);
  }

  async function saveDraft() {
    if (actor === null || !canDraftPages) return;
    const errors = collectFieldErrors(body);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setActionError("Resolve the highlighted fields before saving the draft.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await contentService.savePageDraft(SLUG, {
        title: body.intro.title.trim() || "School life",
        body,
        expectedVersion: state?.itemVersion ?? 0,
        actor,
      });
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      setState(result.value);
      setDirty(false);
      setAnnouncement(
        result.replayed
          ? `Draft version ${result.value.itemVersion} was already saved · nothing changed.`
          : `Draft version ${result.value.itemVersion} saved.`,
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(next: "In review" | "Approved" | "Published") {
    if (actor === null || latest === null) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await contentService.setPublicPageStatus(SLUG, next, actor, {
        expectedVersion: latest.version,
      });
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      const refreshed = await contentService.getPage(SLUG);
      if (refreshed !== null) setState(refreshed);
      setAnnouncement(`Page marked ${next.toLowerCase()} · version ${result.value.version}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The page status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  function discardChanges() {
    const parsed = parseSchoolLifePageBody(latest?.body);
    setBody(parsed ? cloneBody(parsed) : cloneBody(DEFAULT_SCHOOL_LIFE_BODY));
    setFieldErrors({});
    setDirty(false);
    setAnnouncement("Unsaved changes discarded · the editor shows the last saved version.");
  }

  function restoreVersion(version: ManagedPageVersion) {
    const parsed = parseSchoolLifePageBody(version.body);
    setBody(parsed ? cloneBody(parsed) : cloneBody(DEFAULT_SCHOOL_LIFE_BODY));
    setDirty(true);
    setFieldErrors({});
    setAnnouncement(
      parsed
        ? `Version ${version.version} loaded into the editor · save to make it a new draft.`
        : `Version ${version.version} predates the structured format · the default copy is loaded instead.`,
    );
  }

  const eyebrow = summary?.profileLabel ?? summary?.roleLabel ?? "Staff";

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">{eyebrow} · Content</p>
          <h1>School life page</h1>
          <p className="ph-sub">
            Edit the public School life page · drafts are reviewed and published by a content publisher who did not
            write them.
          </p>
        </div>
      </div>

      {!loaded ? (
        <LoadingSkeleton lines={5} label="Loading the School life page record…" />
      ) : loadError !== null ? (
        <ErrorPanel title="The page record could not be loaded" note={loadError}>
          <Button variant="quiet" onClick={() => void load()}>
            Try again
          </Button>
        </ErrorPanel>
      ) : (
        <>
          <div className={styles.statusStrip}>
            {latest !== null ? (
              <>
                <StatusBadge tone={REVIEW_TONE[latest.reviewStatus]}>
                  {REVIEW_LABEL[latest.reviewStatus]} · v{latest.version}
                </StatusBadge>
                <span className={styles.statusMeta}>
                  {latest.authorAccountId !== null && latest.authorAccountId === actor?.accountId
                    ? "Last saved by you"
                    : `Last saved by ${latest.authorDisplayName ?? "staff"}`}
                  {" · "}
                  <RelativeTime iso={latest.createdAt} />
                </span>
              </>
            ) : (
              <StatusBadge tone="neutral">Not yet managed</StatusBadge>
            )}
            {dirty ? <span className={styles.dirtyNote}>Unsaved changes</span> : null}
            <div className={`seg ${styles.viewToggle}`} role="group" aria-label="Editor view">
              <button
                type="button"
                className={view === "edit" ? "on" : undefined}
                aria-pressed={view === "edit"}
                onClick={() => setView("edit")}
              >
                Edit
              </button>
              <button
                type="button"
                className={view === "preview" ? "on" : undefined}
                aria-pressed={view === "preview"}
                onClick={() => setView("preview")}
              >
                Preview
              </button>
            </div>
            <div className={styles.statusActions}>
              {canDraftPages ? (
                <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={() => void saveDraft()}>
                  Save draft
                </Button>
              ) : null}
              {latest !== null && latest.reviewStatus === "draft" && selfAuthored ? (
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => void transition("In review")}>
                  Submit for review
                </Button>
              ) : null}
              {latest !== null && latest.reviewStatus === "in_review" && canPublishPages && !selfAuthored ? (
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => void transition("Approved")}>
                  Approve
                </Button>
              ) : null}
              {latest !== null && latest.reviewStatus === "approved" && canPublishPages && !selfAuthored ? (
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => void transition("Published")}>
                  Publish
                </Button>
              ) : null}
              {latest !== null && latest.reviewStatus !== "published" && canPublishPages && selfAuthored ? (
                <span title="Another content publisher must publish your own edit">
                  <Button variant="quiet" size="sm" disabled>
                    Publish
                  </Button>
                </span>
              ) : null}
              {dirty ? (
                <Button variant="quiet" size="sm" disabled={busy} onClick={discardChanges}>
                  Discard unsaved changes
                </Button>
              ) : null}
            </div>
          </div>

          {announcement !== null ? (
            <p className={styles.statusMeta} aria-live="polite" style={{ margin: "0 0 12px" }}>
              {announcement}
            </p>
          ) : null}
          {actionError !== null ? (
            <p className="field-error" role="alert" style={{ margin: "0 0 12px" }}>
              {actionError}
            </p>
          ) : null}

          {!canDraftPages ? (
            <EmptyState
              title="Read-only for this workspace"
              note="The content editor or content publisher role is required to change this page."
            />
          ) : null}

          <div className={styles.grid} data-view={view}>
            <div className={`${styles.sectionList} ${styles.formColumn}`}>
              <section className={styles.sectionPanel} aria-labelledby="intro-heading">
                <div className={styles.sectionHead}>
                  <h2 id="intro-heading" className={styles.sectionTitle}>
                    Introduction
                  </h2>
                  <span className={styles.sectionHint}>Eyebrow, title and deck</span>
                </div>
                <div className={styles.sectionBody}>
                  <Field
                    id="sl-eyebrow"
                    label="Eyebrow"
                    count={body.intro.eyebrow.length}
                    max={SCHOOL_LIFE_LIMITS.introEyebrow.max}
                    error={fieldErrors["intro.eyebrow"]}
                  >
                    <input
                      id="sl-eyebrow"
                      className="input"
                      value={body.intro.eyebrow}
                      onChange={(event) => mutate((draft) => void (draft.intro.eyebrow = event.target.value))}
                      disabled={busy || !canDraftPages}
                    />
                  </Field>
                  <Field
                    id="sl-title"
                    label="Title"
                    count={body.intro.title.length}
                    max={SCHOOL_LIFE_LIMITS.introTitle.max}
                    error={fieldErrors["intro.title"]}
                  >
                    <input
                      id="sl-title"
                      className="input"
                      value={body.intro.title}
                      onChange={(event) => mutate((draft) => void (draft.intro.title = event.target.value))}
                      disabled={busy || !canDraftPages}
                    />
                  </Field>
                  <Field
                    id="sl-deck"
                    label="Deck"
                    count={body.intro.deck.length}
                    max={SCHOOL_LIFE_LIMITS.introDeck.max}
                    error={fieldErrors["intro.deck"]}
                  >
                    <textarea
                      id="sl-deck"
                      className="textarea"
                      rows={3}
                      value={body.intro.deck}
                      onChange={(event) => mutate((draft) => void (draft.intro.deck = event.target.value))}
                      disabled={busy || !canDraftPages}
                    />
                  </Field>
                </div>
              </section>

              <SectionListEditor
                idPrefix="programme"
                heading="Programmes"
                hint={`${body.programmes.length} of ${SCHOOL_LIFE_LIMITS.programmes.max}`}
                items={body.programmes}
                error={fieldErrors["programmes"]}
                canEdit={canDraftPages && !busy}
                removeTarget={removeTarget}
                onRequestRemove={(item) => setRemoveTarget({ section: "programmes", id: item.id, label: item.title || "Programme" })}
                onConfirmRemove={confirmRemove}
                onCancelRemove={() => setRemoveTarget(null)}
                onMove={(index, delta) => moveItem("programmes", index, delta)}
                onAdd={() =>
                  mutate((draft) => {
                    if (draft.programmes.length >= SCHOOL_LIFE_LIMITS.programmes.max) return;
                    draft.programmes.push({ id: nextItemId("programme"), icon: "group", title: "", line: "" });
                  })
                }
                addDisabled={body.programmes.length >= SCHOOL_LIFE_LIMITS.programmes.max}
                addLabel="Add programme"
                renderItem={(item, index) => (
                  <>
                    <div className={styles.fieldRow}>
                      <Field id={`programme-icon-${item.id}`} label="Icon" error={fieldErrors[`programmes.${index}.icon`]}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
                            {item.icon}
                          </span>
                          <select
                            id={`programme-icon-${item.id}`}
                            className="select"
                            value={item.icon}
                            onChange={(event) =>
                              mutate((draft) => {
                                const target = draft.programmes.find((entry) => entry.id === item.id);
                                if (target) target.icon = event.target.value as SchoolLifeIconName;
                              })
                            }
                            disabled={busy || !canDraftPages}
                          >
                            {SCHOOL_LIFE_ICON_NAMES.map((name) => (
                              <option key={name} value={name}>
                                {ICON_LABEL[name]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </Field>
                      <Field
                        id={`programme-title-${item.id}`}
                        label="Title"
                        count={item.title.length}
                        max={SCHOOL_LIFE_LIMITS.programmeTitle.max}
                        error={fieldErrors[`programmes.${index}.title`]}
                      >
                        <input
                          id={`programme-title-${item.id}`}
                          className="input"
                          value={item.title}
                          onChange={(event) =>
                            mutate((draft) => {
                              const target = draft.programmes.find((entry) => entry.id === item.id);
                              if (target) target.title = event.target.value;
                            })
                          }
                          disabled={busy || !canDraftPages}
                        />
                      </Field>
                    </div>
                    <Field
                      id={`programme-line-${item.id}`}
                      label="Line"
                      count={item.line.length}
                      max={SCHOOL_LIFE_LIMITS.programmeLine.max}
                      error={fieldErrors[`programmes.${index}.line`]}
                    >
                      <textarea
                        id={`programme-line-${item.id}`}
                        className="textarea"
                        rows={2}
                        value={item.line}
                        onChange={(event) =>
                          mutate((draft) => {
                            const target = draft.programmes.find((entry) => entry.id === item.id);
                            if (target) target.line = event.target.value;
                          })
                        }
                        disabled={busy || !canDraftPages}
                      />
                    </Field>
                  </>
                )}
              />

              <SectionListEditor
                idPrefix="facility"
                heading="Facilities"
                hint={`${body.facilities.length} of ${SCHOOL_LIFE_LIMITS.facilities.max}`}
                items={body.facilities}
                error={fieldErrors["facilities"]}
                canEdit={canDraftPages && !busy}
                removeTarget={removeTarget}
                onRequestRemove={(item) => setRemoveTarget({ section: "facilities", id: item.id, label: item.title || "Facility" })}
                onConfirmRemove={confirmRemove}
                onCancelRemove={() => setRemoveTarget(null)}
                onMove={(index, delta) => moveItem("facilities", index, delta)}
                onAdd={() =>
                  mutate((draft) => {
                    if (draft.facilities.length >= SCHOOL_LIFE_LIMITS.facilities.max) return;
                    draft.facilities.push({ id: nextItemId("facility"), title: "", line: "" });
                  })
                }
                addDisabled={body.facilities.length >= SCHOOL_LIFE_LIMITS.facilities.max}
                addLabel="Add facility"
                renderItem={(item, index) => (
                  <>
                    <Field
                      id={`facility-title-${item.id}`}
                      label="Title"
                      count={item.title.length}
                      max={SCHOOL_LIFE_LIMITS.facilityTitle.max}
                      error={fieldErrors[`facilities.${index}.title`]}
                    >
                      <input
                        id={`facility-title-${item.id}`}
                        className="input"
                        value={item.title}
                        onChange={(event) =>
                          mutate((draft) => {
                            const target = draft.facilities.find((entry) => entry.id === item.id);
                            if (target) target.title = event.target.value;
                          })
                        }
                        disabled={busy || !canDraftPages}
                      />
                    </Field>
                    <Field
                      id={`facility-line-${item.id}`}
                      label="Line"
                      count={item.line.length}
                      max={SCHOOL_LIFE_LIMITS.facilityLine.max}
                      error={fieldErrors[`facilities.${index}.line`]}
                    >
                      <textarea
                        id={`facility-line-${item.id}`}
                        className="textarea"
                        rows={2}
                        value={item.line}
                        onChange={(event) =>
                          mutate((draft) => {
                            const target = draft.facilities.find((entry) => entry.id === item.id);
                            if (target) target.line = event.target.value;
                          })
                        }
                        disabled={busy || !canDraftPages}
                      />
                    </Field>
                  </>
                )}
              />

              <SectionListEditor
                idPrefix="gallery"
                heading="Gallery"
                hint={`${body.gallery.length} of ${SCHOOL_LIFE_LIMITS.gallery.max}`}
                items={body.gallery}
                error={fieldErrors["gallery"]}
                canEdit={canDraftPages && !busy}
                removeTarget={removeTarget}
                onRequestRemove={(item) => setRemoveTarget({ section: "gallery", id: item.id, label: item.caption || "Tile" })}
                onConfirmRemove={confirmRemove}
                onCancelRemove={() => setRemoveTarget(null)}
                onMove={(index, delta) => moveItem("gallery", index, delta)}
                onAdd={() =>
                  mutate((draft) => {
                    if (draft.gallery.length >= SCHOOL_LIFE_LIMITS.gallery.max) return;
                    draft.gallery.push({ id: nextItemId("gallery"), art: "campus", caption: "" });
                  })
                }
                addDisabled={body.gallery.length >= SCHOOL_LIFE_LIMITS.gallery.max}
                addLabel="Add tile"
                renderItem={(item, index) => (
                  <>
                    <div className="field" role="radiogroup" aria-label={`Artwork for tile ${index + 1}`}>
                      <span className={styles.artworkLabel}>Artwork</span>
                      <div className={styles.artChoices}>
                        {SCHOOL_LIFE_ART_KEYS.map((key) => {
                          const Art = SCHOOL_LIFE_ART[key];
                          return (
                            <label
                              key={key}
                              className={`${styles.artChoice} ${item.art === key ? styles.artChoiceSelected : ""}`}
                            >
                              <input
                                type="radio"
                                name={`art-${item.id}`}
                                className="sr-only"
                                checked={item.art === key}
                                onChange={() =>
                                  mutate((draft) => {
                                    const target = draft.gallery.find((entry) => entry.id === item.id);
                                    if (target) target.art = key as SchoolLifeArtKey;
                                  })
                                }
                                disabled={busy || !canDraftPages}
                              />
                              <span className={styles.artThumb} aria-hidden="true">
                                <Art ariaHidden />
                              </span>
                              <span className={styles.artName}>{SCHOOL_LIFE_ART_LABEL[key]}</span>
                            </label>
                          );
                        })}
                      </div>
                      {fieldErrors[`gallery.${index}.art`] ? (
                        <p className="field-error" role="alert">
                          {fieldErrors[`gallery.${index}.art`]}
                        </p>
                      ) : null}
                    </div>
                    <Field
                      id={`gallery-caption-${item.id}`}
                      label="Caption"
                      count={item.caption.length}
                      max={SCHOOL_LIFE_LIMITS.galleryCaption.max}
                      error={fieldErrors[`gallery.${index}.caption`]}
                    >
                      <input
                        id={`gallery-caption-${item.id}`}
                        className="input"
                        value={item.caption}
                        onChange={(event) =>
                          mutate((draft) => {
                            const target = draft.gallery.find((entry) => entry.id === item.id);
                            if (target) target.caption = event.target.value;
                          })
                        }
                        disabled={busy || !canDraftPages}
                      />
                    </Field>
                  </>
                )}
              />

              <section className={styles.sectionPanel} aria-labelledby="note-heading">
                <div className={styles.sectionHead}>
                  <h2 id="note-heading" className={styles.sectionTitle}>
                    Concept note
                  </h2>
                  <span className={styles.sectionHint}>Shown only in development builds · not visible to the public</span>
                </div>
                <div className={styles.sectionBody}>
                  <Field
                    id="sl-note"
                    label="Concept note"
                    count={body.note.length}
                    max={SCHOOL_LIFE_LIMITS.note.max}
                    error={fieldErrors["note"]}
                  >
                    <textarea
                      id="sl-note"
                      className="textarea"
                      rows={2}
                      value={body.note}
                      onChange={(event) => mutate((draft) => void (draft.note = event.target.value))}
                      disabled={busy || !canDraftPages}
                    />
                  </Field>
                </div>
              </section>
            </div>

            <div className={styles.previewColumn}>
              <section className={styles.previewPanel} aria-labelledby="preview-heading">
                <div className={styles.sectionHead}>
                  <h2 id="preview-heading" className={styles.sectionTitle}>
                    Preview
                  </h2>
                  <span className={styles.sectionHint}>
                    {dirty ? (
                      <StatusBadge tone="watch">Unsaved changes</StatusBadge>
                    ) : latest !== null ? (
                      `Matches saved v${latest.version}`
                    ) : (
                      "Matches shipped default"
                    )}
                  </span>
                </div>
                <div
                  className={`${styles.previewFrame} y-scroll`}
                  tabIndex={0}
                  aria-label="Preview of the public School life page"
                >
                  <div className={styles.previewInner}>
                    <SchoolLifeContent body={body} />
                  </div>
                </div>
                <div className={styles.sectionBody}>
                  <h3 className={styles.sectionTitle} style={{ fontSize: "0.9375rem" }}>
                    Version history
                  </h3>
                  {state === null || state.versions.length === 0 ? (
                    <p className={styles.historyEmpty}>
                      No saved versions yet · the first save creates the page record.
                    </p>
                  ) : (
                    <table className={styles.historyTable}>
                      <thead>
                        <tr>
                          <th scope="col">Version</th>
                          <th scope="col">Status</th>
                          <th scope="col">Saved</th>
                          <th scope="col">
                            <span className="sr-only">Action</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.versions.map((version) => (
                          <tr key={version.id}>
                            <td className="num">v{version.version}</td>
                            <td>
                              <StatusBadge tone={REVIEW_TONE[version.reviewStatus]}>
                                {REVIEW_LABEL[version.reviewStatus]}
                              </StatusBadge>
                            </td>
                            <td>
                              <RelativeTime iso={version.createdAt} />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-quiet btn-sm"
                                aria-label={`Restore version ${version.version} into the editor`}
                                disabled={busy || !canDraftPages}
                                onClick={() => restoreVersion(version)}
                              >
                                Restore into editor
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One repeatable section (programmes / facilities / gallery): the item rows
 * with move/remove controls, inline remove confirmation, and the add row. */
function SectionListEditor<T extends { id: string }>({
  idPrefix,
  heading,
  hint,
  items,
  error,
  canEdit,
  removeTarget,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
  onMove,
  onAdd,
  addDisabled,
  addLabel,
  renderItem,
}: {
  idPrefix: string;
  heading: string;
  hint: string;
  items: T[];
  error?: string;
  canEdit: boolean;
  removeTarget: RemoveTarget | null;
  onRequestRemove: (item: T) => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onAdd: () => void;
  addDisabled: boolean;
  addLabel: string;
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  const title = (item: T): string => {
    const record = item as { title?: string; caption?: string };
    return record.title || record.caption || "Item";
  };
  return (
    <section className={styles.sectionPanel} aria-labelledby={`${idPrefix}-heading`}>
      <div className={styles.sectionHead}>
        <h2 id={`${idPrefix}-heading`} className={styles.sectionTitle}>
          {heading}
        </h2>
        <span className={styles.sectionHint}>{hint}</span>
      </div>
      <div className={styles.sectionBody}>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        {items.map((item, index) => {
          const removing = removeTarget !== null && removeTarget.id === item.id;
          return (
            <div className={styles.itemRow} key={item.id}>
              <div className={styles.itemToolbar}>
                <span className={styles.itemName}>
                  {index + 1} · {title(item)}
                </span>
                <div className={styles.itemActions}>
                  {removing ? (
                    <>
                      <span className={styles.sectionHint}>Remove {title(item)}?</span>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        aria-label={`Confirm removal of ${title(item)}`}
                        onClick={onConfirmRemove}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        aria-label={`Keep ${title(item)}`}
                        onClick={onCancelRemove}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        aria-label={`Move ${title(item)} up`}
                        disabled={!canEdit || index === 0}
                        onClick={() => onMove(index, -1)}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        aria-label={`Move ${title(item)} down`}
                        disabled={!canEdit || index === items.length - 1}
                        onClick={() => onMove(index, 1)}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        aria-label={`Remove ${title(item)}`}
                        disabled={!canEdit || items.length <= 1}
                        onClick={() => onRequestRemove(item)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
              {renderItem(item, index)}
            </div>
          );
        })}
        <div>
          <Button variant="quiet" size="sm" disabled={!canEdit || addDisabled} onClick={onAdd}>
            {addLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}
