"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canRole } from "@/modules/services/staff-authorization";
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
  const canRespond = canRole(summary?.role ?? "", "support.respond");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [items, setItems] = useState<Grievance[]>(initialItems ?? []);
  const [loading, setLoading] = useState(initialItems === undefined);
  const [filter, setFilter] = useState<FilterKey>("all");
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

  useEffect(() => {
    if (initialItems !== undefined) return;
    /* Load the authorized support projection once. */
    let cancelled = false;
    supportService
      .listGrievances()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialItems]);

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

  const visible = filter === "all" ? items : items.filter((item) => item.status === filter);

  const counts: Record<GrievanceStatus, number> = {
    New: items.filter((item) => item.status === "New").length,
    "In progress": items.filter((item) => item.status === "In progress").length,
    Resolved: items.filter((item) => item.status === "Resolved").length,
  };

  const selected = items.find((item) => item.ref === selectedRef) ?? null;

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
    try {
      const updated = privateNote
        ? await supportService.addPrivateNote(selected.ref, text, RESPONSE_AUTHOR)
        : await supportService.respond(selected.ref, text, RESPONSE_AUTHOR, resolveAfterSend);
      setItems((prev) => prev.map((item) => (item.ref === updated.ref ? updated : item)));
      setDraft("");
      setResolveAfterSend(false);
      setPrivateNote(false);
      setError(null);
      setLiveMessage(`Response recorded${supabaseMode ? "" : " (demo)"} — ${updated.ref}`);
      focusTarget.current = resolveAfterSend ? "heading" : "textarea";
    } finally {
      setSending(false);
    }
  }

  async function handleReopen() {
    if (selected === null) return;
    setSending(true);
    try {
      const updated = await supportService.reopen(selected.ref, RESPONSE_AUTHOR);
      setItems((prev) => prev.map((item) => (item.ref === updated.ref ? updated : item)));
      setLiveMessage(`${updated.ref} reopened as New${supabaseMode ? "" : " (demo)"}`);
      focusTarget.current = "textarea";
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
        <div className={`panel ${styles.loading}`}>Reading the grievance register…</div>
      </div>
    );
  }

  return (
    <div>
      <p className={styles.live} role="status" aria-live="polite">
        {liveMessage}
      </p>

      <div className={styles.summary} role="group" aria-label="Grievance summary by status">
        {STATUSES.map((status) => (
          <div className={styles.summaryCell} key={status}>
            <span className={`status-dot status-dot--${STATUS_TONE[status]}`} aria-hidden="true" />
            <div>
              <p className={styles.summaryWord}>{status}</p>
              <p className={`num ${styles.summaryCount}`}>{counts[status]}</p>
            </div>
          </div>
        ))}
      </div>

      <div className={`tabs ${styles.filters}`} role="group" aria-label="Filter grievances by status">
        {FILTERS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={filter === tab.key ? "active" : undefined}
            aria-pressed={filter === tab.key}
            onClick={() => handleFilter(tab.key)}
          >
            {tab.label}
            <span className={`num ${styles.tabCount}`}>{tab.key === "all" ? items.length : counts[tab.key]}</span>
          </button>
        ))}
      </div>

      <div className={styles.grid}>
        <section className={styles.listColumn} aria-labelledby="inbox-heading">
          <div className={styles.sectionHead}>
            <h2 id="inbox-heading" className="section-label">
              Inbox
            </h2>
            {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
          </div>

          {visible.length === 0 ? (
            <p className={styles.empty}>No grievances in this view.</p>
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
                      <span className={styles.rowCategory}>{item.category}</span>
                    </span>
                    <strong className={styles.rowSubject}>{item.subject}</strong>
                    <span className={styles.rowBottom}>
                      <span className={styles.rowContact}>{item.contactName}</span>
                      <time className={`num ${styles.rowDay}`} dateTime={item.raisedAtIso}>
                        {formatKolkata(item.raisedAtIso, { format: "day" })}
                      </time>
                    </span>
                    <StatusBadge tone={STATUS_TONE[item.status]}>{item.status}</StatusBadge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`panel ${styles.detail}`} aria-labelledby="grievance-detail-title">
          {selected === null ? (
            <div>
              <h2 id="grievance-detail-title" ref={headingRef} tabIndex={-1} className={styles.detailTitle}>
                No grievance selected
              </h2>
              <p className={styles.detailMessage}>Choose a grievance from the inbox to read and respond.</p>
            </div>
          ) : (
            <div>
              <div className={styles.detailTop}>
                <span className={`num ${styles.detailRef}`}>{selected.ref}</span>
                <span className={styles.detailCategory}>{selected.category}</span>
                <StatusBadge tone={STATUS_TONE[selected.status]}>{selected.status}</StatusBadge>
              </div>
              <h2 id="grievance-detail-title" ref={headingRef} tabIndex={-1} className={styles.detailTitle}>
                {selected.subject}
              </h2>
              <p className={styles.detailMessage}>{selected.message}</p>
              {selected.privateNotes && selected.privateNotes.length > 0 ? (
                <section className={styles.response} aria-label="Staff private notes">
                  <h3 className={styles.responseHeading}>Private notes</h3>
                  <ul className={styles.thread}>
                    {selected.privateNotes.map((note, index) => <li className={styles.threadEntry} key={`${note.atIso}-${index}`}><p className={styles.threadText}>{note.text}</p><p className={styles.threadMeta}><span className={styles.threadBy}>{note.by}</span><time className="num" dateTime={note.atIso}>{formatKolkata(note.atIso, { format: "full" })}</time></p></li>)}
                  </ul>
                </section>
              ) : null}

              <dl className={styles.detailMeta}>
                <div className={styles.detailMetaRow}>
                  <dt>Raised</dt>
                  <dd>
                    <time className="num" dateTime={selected.raisedAtIso}>
                      {formatKolkata(selected.raisedAtIso, { format: "full" })}
                    </time>
                  </dd>
                </div>
                <div className={styles.detailMetaRow}>
                  <dt>Contact</dt>
                  <dd>
                    {selected.contactName}
                    {selected.contactPhone !== undefined ? ` · ${selected.contactPhone}` : ""}
                  </dd>
                </div>
              </dl>

              {selected.status === "Resolved" ? (
                <div className={styles.response}>
                  <h3 className={styles.responseHeading}>Response</h3>
                  <ResponseThread events={selected.thread} />
                  {canRespond ? (
                    <div className={styles.reopenRow}>
                      <Button variant="quiet" onClick={handleReopen} disabled={sending}>
                        Reopen
                      </Button>
                      <span className={styles.reopenHint}>Moves the grievance back to New.</span>
                    </div>
                  ) : null}
                </div>
              ) : canRespond ? (
                <form className={styles.response} onSubmit={handleSend} noValidate>
                  <h3 className={styles.responseHeading}>Response</h3>
                  <div className={`field ${error !== null ? "field--invalid" : ""}`}>
                    <label htmlFor="grievance-response">
                      {privateNote ? "Private note" : "Response"} <span aria-hidden="true">*</span>
                    </label>
                    <textarea
                      id="grievance-response"
                      ref={textareaRef}
                      className={`textarea ${styles.responseTextarea}`}
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        if (error !== null) setError(null);
                      }}
                      placeholder="What the applicant will see — factual and within school policy"
                      required
                      aria-invalid={error !== null}
                      aria-describedby={error !== null ? "grievance-response-error" : undefined}
                    />
                    {error !== null && (
                      <p id="grievance-response-error" className="field-error">
                        {error}
                      </p>
                    )}
                  </div>

                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={resolveAfterSend}
                      onChange={(event) => setResolveAfterSend(event.target.checked)}
                    />
                    Resolve after sending
                  </label>
                  <label className={styles.checkRow}>
                    <input type="checkbox" checked={privateNote} onChange={(event) => { setPrivateNote(event.target.checked); if (event.target.checked) setResolveAfterSend(false); }} />
                    Staff-only private note
                  </label>

                  <div className={styles.actions}>
                    <Button variant="primary" type="submit" disabled={sending}>
                      {sending ? "Sending…" : "Send response"}
                    </Button>
                    <span className={styles.actionHint}>
                      Sending marks the grievance In progress; tick Resolve after sending to close it.
                    </span>
                  </div>

                  {selected.thread.some((event) => event.kind === "response") && (
                    <ResponseThread events={selected.thread} />
                  )}
                </form>
              ) : (
                <div className={styles.response}>
                  <h3 className={styles.responseHeading}>Response</h3>
                  <p className={styles.reopenHint}>
                    Read only — responding to grievances requires the Support officer workspace.
                  </p>
                  {selected.thread.some((event) => event.kind === "response") ? (
                    <ResponseThread events={selected.thread} />
                  ) : null}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <p className={styles.panelNote}>
        <span className="demo-badge">Demo</span>
        <span>Responses are audited; the applicant sees only the response, never internal notes.</span>
      </p>
    </div>
  );
}
