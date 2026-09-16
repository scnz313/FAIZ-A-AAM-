"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { formatKolkata } from "@/modules/iot/domain";
import { supportService } from "@/modules/services/support";
import type { Grievance, GrievanceEvent, GrievanceStatus } from "@/modules/services/support";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./GrievanceInbox.module.css";

const STATUSES: ReadonlyArray<GrievanceStatus> = ["New", "In progress", "Resolved"];

const STATUS_TONE: Record<GrievanceStatus, StatusTone> = {
  New: "alert",
  "In progress": "watch",
  Resolved: "good",
};

const FILTERS: ReadonlyArray<{ key: "all" | GrievanceStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "New", label: "New" },
  { key: "In progress", label: "In progress" },
  { key: "Resolved", label: "Resolved" },
];

/** Demo session author for responses sent from this inbox. */
const RESPONSE_AUTHOR = "A. Lone";

type FilterKey = "all" | GrievanceStatus;

/** Applicant-safe thread: the submission is shown as the message; responses render here. */
function ResponseThread({ events }: { events: GrievanceEvent[] }) {
  const responses = events.filter((event) => event.kind === "response");
  if (responses.length === 0) return null;
  return (
    <ul className={styles.thread}>
      {responses.map((event, index) => (
        <li className={styles.threadEntry} key={`${event.atIso}-${index}`}>
          <p className={styles.threadText}>{event.text}</p>
          <p className={styles.threadMeta}>
            <span className={styles.threadBy}>{event.by}</span>
            <time className="num" dateTime={event.atIso}>
              {formatKolkata(event.atIso, { format: "full" })}
            </time>
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Staff grievance inbox: summary counts, status filter, a ruled list of
 * grievances and a reading/response panel. Reads the shared support service
 * (fixtures + session submissions) and records responses through it, so the
 * portal/public tracker shows the same status and thread. All actions are
 * demo-only and persist for the browser session; nothing is sent.
 */
export function GrievanceInbox({ initialItems }: { initialItems?: Grievance[] } = {}) {
  const { summary } = useStaffContext();
  const canRespond = canAnyRole(summary?.roles ?? [], "support.respond");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [items, setItems] = useState<Grievance[]>(initialItems ?? []);
  const [loading, setLoading] = useState(initialItems === undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolveAfterSend, setResolveAfterSend] = useState(false);
  const [privateNote, setPrivateNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  const headingRef = useRef<HTMLHeadingElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /* Focus the panel only for user-initiated selection, not initial state. */
  const focusOnSelect = useRef(false);
  /* Send/reopen may replace the response area — land focus after re-render. */
  const focusTarget = useRef<"heading" | "textarea" | null>(null);

  const loadGrievances = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const list = await supportService.listGrievances();
      setItems(list);
    } catch {
      /* Surface the failure instead of showing a fabricated empty inbox. */
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialItems !== undefined) return;
    void loadGrievances();
  }, [initialItems, loadGrievances]);

  /* Default selection: the most recent grievance, in arrival order. */
  useEffect(() => {
    if (selectedRef === null) {
      const first = items[0];
      if (first !== undefined) setSelectedRef(first.ref);
    }
  }, [items, selectedRef]);

  /* Row clicks move keyboard and screen-reader focus to the detail panel. */
  useEffect(() => {
    if (!focusOnSelect.current) return;
    focusOnSelect.current = false;
    headingRef.current?.focus();
  }, [selectedRef]);

  useEffect(() => {
    if (focusTarget.current === null) return;
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "heading") headingRef.current?.focus();
    else textareaRef.current?.focus();
  }, [items]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.status !== filter) return false;
      if (normalized === "") return true;
      return [item.ref, item.subject, item.category, item.contactName]
        .some((value) => value.toLowerCase().includes(normalized));
    });
  }, [filter, items, query]);

  useEffect(() => {
    if (visible.length === 0) {
      if (selectedRef !== null) setSelectedRef(null);
      return;
    }
    if (!visible.some((item) => item.ref === selectedRef)) {
      setSelectedRef(visible[0]?.ref ?? null);
    }
  }, [selectedRef, visible]);

  const counts: Record<GrievanceStatus, number> = {
    New: items.filter((item) => item.status === "New").length,
    "In progress": items.filter((item) => item.status === "In progress").length,
    Resolved: items.filter((item) => item.status === "Resolved").length,
  };

  const selected = items.find((item) => item.ref === selectedRef) ?? null;
  const responseAuthor = summary?.displayName ?? RESPONSE_AUTHOR;

  function handleFilter(next: FilterKey) {
    setFilter(next);
    const view = next === "all" ? items : items.filter((item) => item.status === next);
    const first = view[0];
    if (first !== undefined && !view.some((item) => item.ref === selectedRef)) {
      setSelectedRef(first.ref);
    }
  }

  function handleSelect(ref: string) {
    focusOnSelect.current = true;
    setSelectedRef(ref);
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === null) return;
    const text = draft.trim();
    if (text === "") {
      setError("Enter a response before sending.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const updated = privateNote
        ? await supportService.addPrivateNote(selected.ref, text, responseAuthor)
        : await supportService.respond(selected.ref, text, responseAuthor, resolveAfterSend);
      setItems((prev) => prev.map((item) => (item.ref === updated.ref ? updated : item)));
      setDraft("");
      setResolveAfterSend(false);
      setPrivateNote(false);
      setLiveMessage(`Response recorded${supabaseMode ? "" : " (demo)"} · ${updated.ref}`);
      focusTarget.current = resolveAfterSend ? "heading" : "textarea";
    } catch {
      /* The draft is kept: sending is idempotent-safe to retry once the cause is fixed. */
      setError("The response could not be recorded. The draft is kept · check the connection and try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleReopen() {
    if (selected === null) return;
    setSending(true);
    setError(null);
    try {
      const updated = await supportService.reopen(selected.ref, responseAuthor);
      setItems((prev) => prev.map((item) => (item.ref === updated.ref ? updated : item)));
      setLiveMessage(`${updated.ref} reopened as New${supabaseMode ? "" : " (demo)"}`);
      focusTarget.current = "textarea";
    } catch {
      setError("The grievance could not be reopened. Nothing changed · try again.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div>
        <p className={styles.live} role="status" aria-live="polite">
          Loading grievances…
        </p>
        <div className={`panel ${styles.loading}`}>
          <LoadingSkeleton lines={5} label="Loading the grievance register" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <ErrorPanel title="Grievances could not be loaded" note="The support service did not respond. No request was changed.">
        <Button variant="quiet" type="button" onClick={() => void loadGrievances()}>
          Try again
        </Button>
      </ErrorPanel>
    );
  }

  return (
    <div className={styles.workspace}>
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <div className={styles.summary} role="group" aria-label="Support queue by status">
        {STATUSES.map((status) => (
          <div className={styles.summaryCell} key={status}>
            <span className={`status-dot status-dot--${STATUS_TONE[status]}`} aria-hidden="true" />
            <div>
              <p className={styles.summaryWord}>{status}</p>
              <p className={`num ${styles.summaryCount}`}>{counts[status]}</p>
            </div>
          </div>
        ))}
        <div className={styles.summaryCell}>
          <span className="msym" aria-hidden="true">inbox</span>
          <div>
            <p className={styles.summaryWord}>Open queue</p>
            <p className={`num ${styles.summaryCount}`}>{counts.New + counts["In progress"]}</p>
          </div>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={`seg ${styles.filters}`} role="group" aria-label="Filter support requests by status">
          {FILTERS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={filter === tab.key ? "on" : undefined}
              aria-pressed={filter === tab.key}
              onClick={() => handleFilter(tab.key)}
            >
              {tab.label}
              <span className={`num ${styles.tabCount}`}>{tab.key === "all" ? items.length : counts[tab.key]}</span>
            </button>
          ))}
        </div>
        <label className={styles.search}>
          <span className="sr-only">Search support requests</span>
          <span className="msym" aria-hidden="true">search</span>
          <input
            type="search"
            aria-label="Search support requests"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search requests"
          />
        </label>
      </div>

      <div className={styles.grid}>
        <section className={`panel ${styles.listColumn}`} aria-labelledby="inbox-heading">
          <div className="pn-head">
            <div>
              <h2 id="inbox-heading">Requests</h2>
              <p className="sub">Newest first · {visible.length} in this view</p>
            </div>
            {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
          </div>
          <div className={`pn-body flush ${styles.listViewport}`}>
            {visible.length === 0 ? (
              <p className={styles.empty}>{query.trim() ? "No requests match this search." : "No requests in this view."}</p>
            ) : (
              <ul className={styles.list}>
                {visible.map((item) => (
                  <li key={item.ref}>
                    <button
                      type="button"
                      className={`${styles.row}${item.ref === selectedRef ? ` ${styles.rowSelected}` : ""}`}
                      aria-pressed={item.ref === selectedRef}
                      onClick={() => handleSelect(item.ref)}
                    >
                      <span className={styles.rowTop}>
                        <span className={`num ${styles.rowRef}`}>{item.ref}</span>
                        <StatusBadge tone={STATUS_TONE[item.status]}>{item.status}</StatusBadge>
                      </span>
                      <strong className={styles.rowSubject}>{item.subject}</strong>
                      <span className={styles.rowCategory}>{item.category}</span>
                      <span className={styles.rowBottom}>
                        <span className={styles.rowContact}>{item.contactName}</span>
                        <time className={`num ${styles.rowDay}`} dateTime={item.raisedAtIso}>
                          {formatKolkata(item.raisedAtIso, { format: "day" })}
                        </time>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className={`panel ${styles.detail}`} aria-labelledby="grievance-detail-title">
          {selected === null ? (
            <>
              <div className="pn-head"><h2>Case record</h2></div>
              <div className={`pn-body ${styles.emptyDetail}`}>
                <span className="msym" aria-hidden="true">inbox</span>
                <h2 id="grievance-detail-title" ref={headingRef} tabIndex={-1}>No request selected</h2>
                <p>Choose a request from the queue to read its record.</p>
              </div>
            </>
          ) : (
            <>
              <div className={`pn-head ${styles.detailHead}`}>
                <div>
                  <span className={`num ${styles.detailRef}`}>{selected.ref}</span>
                  <span className={styles.detailCategory}>{selected.category}</span>
                </div>
                <StatusBadge tone={STATUS_TONE[selected.status]}>{selected.status}</StatusBadge>
              </div>
              <div className={`pn-body ${styles.detailBody}`}>
                <h2 id="grievance-detail-title" ref={headingRef} tabIndex={-1} className={styles.detailTitle}>
                  {selected.subject}
                </h2>

                <section className={styles.requestRecord} aria-labelledby="request-message-heading">
                  <h3 id="request-message-heading" className={styles.responseHeading}>Request</h3>
                  <p className={styles.detailMessage}>{selected.message}</p>
                </section>

                <dl className={styles.detailMeta}>
                  <div className={styles.detailMetaRow}>
                    <dt>Raised</dt>
                    <dd><time className="num" dateTime={selected.raisedAtIso}>{formatKolkata(selected.raisedAtIso, { format: "full" })}</time></dd>
                  </div>
                  <div className={styles.detailMetaRow}>
                    <dt>Requester</dt>
                    <dd>{selected.contactName}{selected.contactPhone !== undefined ? ` · ${selected.contactPhone}` : ""}</dd>
                  </div>
                  <div className={styles.detailMetaRow}>
                    <dt>Assigned</dt>
                    <dd>{selected.assignee?.by ?? "Unassigned"}</dd>
                  </div>
                </dl>

                {selected.thread.some((event) => event.kind === "response") ? (
                  <section className={styles.recordSection} aria-labelledby="conversation-heading">
                    <h3 id="conversation-heading" className={styles.responseHeading}>Conversation</h3>
                    <ResponseThread events={selected.thread} />
                  </section>
                ) : null}

                {selected.privateNotes && selected.privateNotes.length > 0 ? (
                  <section className={`${styles.recordSection} ${styles.privateNotes}`} aria-labelledby="private-notes-heading">
                    <div className={styles.privateHeading}>
                      <h3 id="private-notes-heading" className={styles.responseHeading}>Private notes</h3>
                      <span className="chip">Staff only</span>
                    </div>
                    <ul className={styles.thread}>
                      {selected.privateNotes.map((note, index) => (
                        <li className={styles.threadEntry} key={`${note.atIso}-${index}`}>
                          <p className={styles.threadText}>{note.text}</p>
                          <p className={styles.threadMeta}><span className={styles.threadBy}>{note.by}</span><time className="num" dateTime={note.atIso}>{formatKolkata(note.atIso, { format: "full" })}</time></p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {selected.status === "Resolved" ? (
                  canRespond ? (
                    <div className={styles.reopenRow}>
                      <Button variant="quiet" onClick={handleReopen} disabled={sending}>Reopen request</Button>
                      <span className={styles.reopenHint}>Returns this case to the New queue.</span>
                    </div>
                  ) : null
                ) : canRespond ? (
                  <form className={styles.composer} onSubmit={handleSend} noValidate>
                    <div className={styles.composerHead}>
                      <div>
                        <h3 className={styles.composerTitle}>{privateNote ? "Add private note" : "Write response"}</h3>
                        <p>{privateNote ? "Only staff can read this note." : "The requester will receive this text by email."}</p>
                      </div>
                      {privateNote ? <span className="chip">Staff only</span> : null}
                    </div>
                    <div className={`field ${error !== null ? "field--invalid" : ""}`}>
                      <label htmlFor="grievance-response">{privateNote ? "Private note" : "Response"} <span aria-hidden="true">*</span></label>
                      <textarea
                        id="grievance-response"
                        ref={textareaRef}
                        className={`textarea ${styles.responseTextarea}`}
                        value={draft}
                        onChange={(event) => {
                          setDraft(event.target.value);
                          if (error !== null) setError(null);
                        }}
                        placeholder={privateNote ? "Record internal context for staff" : "Write a factual response within school policy"}
                        required
                        aria-invalid={error !== null}
                        aria-describedby={error !== null ? "grievance-response-error" : undefined}
                      />
                      {error !== null ? <p id="grievance-response-error" className="field-error">{error}</p> : null}
                    </div>
                    <div className={styles.composerOptions}>
                      <label className={styles.checkRow}>
                        <input type="checkbox" checked={privateNote} onChange={(event) => { setPrivateNote(event.target.checked); if (event.target.checked) setResolveAfterSend(false); }} />
                        Staff-only private note
                      </label>
                      <label className={styles.checkRow} title={privateNote ? "A public response is required to resolve a request." : undefined}>
                        <input
                          type="checkbox"
                          checked={resolveAfterSend}
                          disabled={privateNote}
                          aria-describedby={privateNote ? "resolve-after-send-help" : undefined}
                          onChange={(event) => setResolveAfterSend(event.target.checked)}
                        />
                        Resolve after sending
                      </label>
                    </div>
                    {privateNote ? <p id="resolve-after-send-help" className={styles.optionHelp}>A public response is required to resolve a request.</p> : null}
                    <div className={styles.actions}>
                      <Button variant="primary" type="submit" disabled={sending}>{sending ? "Recording…" : privateNote ? "Add private note" : resolveAfterSend ? "Send and resolve" : "Send response"}</Button>
                      <span className={styles.actionHint}>{privateNote ? "The requester never sees private notes." : resolveAfterSend ? "The response is sent and the case moves to Resolved." : "Sending moves the case to In progress."}</span>
                    </div>
                  </form>
                ) : (
                  <div className={styles.readOnly}>
                    <span className="msym" aria-hidden="true">lock_person</span>
                    <p>Read only · responding requires the Support officer workspace.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <p className={styles.panelNote}>Public responses are visible to the requester. Private notes remain staff-only. Every action is recorded in the audit trail.</p>
    </div>
  );
}
