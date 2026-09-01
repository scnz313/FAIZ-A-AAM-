"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import {
  familyContextService,
  type LinkRequestRow,
  type LinkRequestSummary,
} from "@/modules/services/family-context";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./page.module.css";

/**
 * Link-request review (I1 + plan.md Phase 3): two pending queues, both owned
 * by the relationship service —
 *
 * 1. Guardian requests: raised through "Link another child" in the portal
 *    (one request store, LR refs). Approving resolves the student reference
 *    and creates the real active link exactly once; rejecting is terminal
 *    with a visible reason.
 * 2. Links awaiting verification: school-created pending graph links
 *    (LINK refs, e.g. enrollment-invitation paths) awaiting the same review.
 *
 * Approving either queue activates family-portal access immediately. UI
 * visibility is not authorization — the service is the decision boundary.
 */
export default function LinkRequestsPage() {
  const { summary } = useStaffContext();
  const canVerify = canAnyRole(summary?.roles ?? [], "links.verify");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [requests, setRequests] = useState<LinkRequestRow[] | null>(null);
  const [graphLinks, setGraphLinks] = useState<LinkRequestSummary[] | null>(null);
  const [activeLinks, setActiveLinks] = useState<LinkRequestSummary[] | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const noticeRef = useRef<HTMLParagraphElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [nextRequests, nextGraphLinks, nextActiveLinks] = await Promise.all([
      familyContextService.listLinkRequests(),
      familyContextService.listLinkRequestSummaries(),
      familyContextService.listActiveLinkSummaries(),
    ]);
    setRequests(nextRequests);
    setGraphLinks(nextGraphLinks);
    setActiveLinks(nextActiveLinks);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      familyContextService.listLinkRequests(),
      familyContextService.listLinkRequestSummaries(),
      familyContextService.listActiveLinkSummaries(),
    ])
      .then(([nextRequests, nextGraphLinks, nextActiveLinks]) => {
        if (cancelled) return;
        setRequests(nextRequests);
        setGraphLinks(nextGraphLinks);
        setActiveLinks(nextActiveLinks);
      })
      .catch(() => {
        if (!cancelled) {
          setRequests([]);
          setGraphLinks([]);
          setActiveLinks([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const actorPersonId = summary?.personId ?? undefined;

  async function approveRequest(requestId: string): Promise<void> {
    setBusyId(requestId);
    try {
      const request = await familyContextService.approvePendingLinkRequest(requestId, actorPersonId);
      const approvedLink = request.approvedLinkId;
      setNotice(
        `Request ${request.ref} approved — ${approvedLink !== null ? "the guardian can now access the student." : "the link is being created."}`,
      );
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function rejectRequest(requestId: string): Promise<void> {
    const cleanReason = reason.trim();
    if (cleanReason === "") {
      setReasonError(true);
      setNotice("A rejection reason is required before the request can be rejected.");
      return;
    }
    setReasonError(false);
    setBusyId(requestId);
    try {
      const request = await familyContextService.rejectPendingLinkRequest(requestId, cleanReason, actorPersonId);
      setNotice(`Request ${request.ref} rejected — ${cleanReason}`);
      setRejectingId(null);
      setReason("");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function approveLink(linkId: string): Promise<void> {
    setBusyId(linkId);
    try {
      const link = await familyContextService.approveLink(linkId);
      setNotice(`Link ${link.ref} approved — the guardian can now access the student.`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function rejectLink(linkId: string): Promise<void> {
    const cleanReason = reason.trim();
    if (cleanReason === "") {
      setReasonError(true);
      setNotice("A rejection reason is required before the request can be rejected.");
      return;
    }
    setReasonError(false);
    setBusyId(linkId);
    try {
      const link = await familyContextService.rejectLink(linkId, cleanReason);
      setNotice(`Link ${link.ref} rejected — ${cleanReason}`);
      setRejectingId(null);
      setReason("");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(linkId: string): Promise<void> {
    setBusyId(linkId);
    try {
      const link = await familyContextService.revokeLink(linkId);
      setNotice(`Link ${link.ref} revoked — the guardian's access ends immediately.`);
      setRevokingId(null);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    if (notice !== "") noticeRef.current?.focus();
  }, [notice]);

  if (requests === null || graphLinks === null || activeLinks === null) {
    return (
      <div className={styles.page}>
        <header>
          <p className="eyebrow">Staff · Relationships</p>
          <h1 className={styles.title}>Link requests</h1>
          <p className={styles.intro} role="status" aria-live="polite">
            Loading pending guardian/student links…
          </p>
        </header>
      </div>
    );
  }

  const pendingRequests = requests.filter((row) => row.request.status === "pending");
  const decidedRequests = requests.filter((row) => row.request.status !== "pending");
  const pendingGraphLinks = graphLinks.filter((row) => row.link.status === "pending_verification");

  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Staff · Relationships</p>
        <h1 className={styles.title}>Link requests</h1>
        <p className={styles.intro}>
          Guardian/student links awaiting school verification. Approving a request activates the family portal
          access immediately; rejecting requires a visible reason recorded on the request.
        </p>
      </header>

      {!supabaseMode ? (
        <p className={styles.demoLine}>
          <span className="demo-badge">Demo data</span> Deterministic demo decisions through the relationship
          service — real verification evidence and revocation arrive with the backend.
        </p>
      ) : null}

      <h2 className="section-label">Guardian requests</h2>
      {pendingRequests.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No pending guardian requests</p>
          <p className="workspace-state-note">
            Requests raised through “Link another child” in the family portal appear here once a guardian account
            requests them.
          </p>
        </div>
      ) : (
        <div className={styles.rows}>
          {pendingRequests.map(({ request, student }) => (
            <article className={styles.row} key={request.id}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>
                  <strong>{request.guardianName}</strong> →{" "}
                  <strong>{student?.displayName ?? request.childAdmissionRef}</strong>
                  <StatusBadge tone="watch">Pending verification</StatusBadge>
                </p>
                <p className={styles.rowMeta}>
                  <span className="num">{request.ref}</span>
                  <span>· {request.relation}</span>
                  <span>· ref {request.childAdmissionRef}</span>
                  <span>· requested {formatKolkata(request.requestedAtIso, { format: "day" })}</span>
                  <span>· v{request.version}</span>
                </p>
                {student === null ? (
                  <p className={styles.rowMeta} role="note">
                    The supplied reference could not be matched to a student record — ask the guardian for the
                    correct reference, or reject.
                  </p>
                ) : null}
              </div>

              <RequestActions
                id={request.id}
                busy={busyId === request.id}
                rejecting={rejectingId === request.id}
                reason={reason}
                reasonError={reasonError}
                onReasonChange={(value) => {
                  setReason(value);
                  if (value.trim() !== "") setReasonError(false);
                }}
                onApprove={() => void approveRequest(request.id)}
                onReject={() => {
                  setRejectingId(request.id);
                  setReason("");
                  setReasonError(false);
                }}
                onRejectConfirm={() => void rejectRequest(request.id)}
                onCancelReject={() => {
                  setRejectingId(null);
                  setReason("");
                  setReasonError(false);
                }}
                canVerify={canVerify}
              />
            </article>
          ))}
        </div>
      )}

      <h2 className={styles.subHeading}>Links awaiting verification</h2>
      {pendingGraphLinks.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No pending link requests</p>
          <p className="workspace-state-note">
            School-created pending links (for example from enrollment invitations) appear here.
          </p>
        </div>
      ) : (
        <div className={styles.rows}>
          {pendingGraphLinks.map(({ link, guardianName, studentName }) => (
            <article className={styles.row} key={link.id}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>
                  <strong>{guardianName}</strong> → <strong>{studentName}</strong>
                  <StatusBadge tone="watch">Pending verification</StatusBadge>
                </p>
                <p className={styles.rowMeta}>
                  <span className="num">{link.ref}</span>
                  <span>· {link.relationshipLabel}</span>
                  <span>· requested {formatKolkata(link.effectiveFromIso, { format: "day" })}</span>
                  <span>· v{link.version}</span>
                </p>
              </div>

              <RequestActions
                id={link.id}
                busy={busyId === link.id}
                rejecting={rejectingId === link.id}
                reason={reason}
                reasonError={reasonError}
                onReasonChange={(value) => {
                  setReason(value);
                  if (value.trim() !== "") setReasonError(false);
                }}
                onApprove={() => void approveLink(link.id)}
                onReject={() => {
                  setRejectingId(link.id);
                  setReason("");
                  setReasonError(false);
                }}
                onRejectConfirm={() => void rejectLink(link.id)}
                onCancelReject={() => {
                  setRejectingId(null);
                  setReason("");
                  setReasonError(false);
                }}
                canVerify={canVerify}
              />
            </article>
          ))}
        </div>
      )}

      <h2 className={styles.subHeading}>Active links</h2>
      {activeLinks.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No active links</p>
          <p className="workspace-state-note">Approved links appear here. Revoking one ends the guardian&apos;s access immediately.</p>
        </div>
      ) : (
        <div className={styles.rows}>
          {activeLinks.map(({ link, guardianName, studentName }) => (
            <article className={styles.row} key={link.id}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>
                  <strong>{guardianName}</strong> → <strong>{studentName}</strong>
                  <StatusBadge tone="good">Active</StatusBadge>
                </p>
                <p className={styles.rowMeta}>
                  <span className="num">{link.ref}</span>
                  <span>· {link.relationshipLabel}</span>
                  <span>· active since {formatKolkata(link.effectiveFromIso, { format: "day" })}</span>
                  <span>· v{link.version}</span>
                </p>
              </div>
              {revokingId === link.id ? (
                <div className={styles.rowActions}>
                  <span className={styles.confirmCopy}>Revoking ends portal access immediately.</span>
                  <button
                    type="button"
                    className="button button--primary button--small"
                    onClick={() => void revoke(link.id)}
                    disabled={busyId === link.id}
                  >
                    {busyId === link.id ? "Revoking…" : "Confirm revoke"}
                  </button>
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    onClick={() => setRevokingId(null)}
                    disabled={busyId === link.id}
                  >
                    Cancel
                  </button>
                </div>
              ) : canVerify ? (
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    onClick={() => setRevokingId(link.id)}
                    disabled={busyId === link.id}
                  >
                    Revoke
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {decidedRequests.length > 0 ? (
        <>
          <h2 className={styles.subHeading}>Decided requests</h2>
          <div className={styles.rows}>
            {decidedRequests.map(({ request, student }) => (
              <article className={styles.row} key={request.id}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>
                    <strong>{request.guardianName}</strong> →{" "}
                    <strong>{student?.displayName ?? request.childAdmissionRef}</strong>
                    <StatusBadge tone={request.status === "approved" ? "good" : "alert"}>
                      {request.status === "approved" ? "Approved" : "Rejected"}
                    </StatusBadge>
                  </p>
                  <p className={styles.rowMeta}>
                    <span className="num">{request.ref}</span>
                    <span>· decided {formatKolkata(request.decidedAtIso ?? request.requestedAtIso, { format: "day" })}</span>
                    {request.rejectedReason !== null ? <span>· {request.rejectedReason}</span> : null}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      <p ref={noticeRef} className={styles.notice} role="status" aria-live="polite" tabIndex={-1}>
        {notice}
      </p>

      {!supabaseMode ? (
        <p className={styles.demoNote}>
          <span className="demo-badge">Demo data</span>
          <span>
            Decisions are recorded in this browser session only. Approving the seeded Nida Bhat request for Zoya Khan
            makes the child accessible in that guardian&apos;s portal context immediately.
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Shared approve/reject controls for one queue row. */
function RequestActions({
  id,
  busy,
  rejecting,
  reason,
  reasonError,
  onReasonChange,
  onApprove,
  onReject,
  onRejectConfirm,
  onCancelReject,
  canVerify,
}: {
  id: string;
  busy: boolean;
  rejecting: boolean;
  reason: string;
  reasonError: boolean;
  onReasonChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRejectConfirm: () => void;
  onCancelReject: () => void;
  canVerify: boolean;
}) {
  if (!rejecting) {
    if (!canVerify) {
      return (
        <div className={styles.rowActions}>
          <span className={styles.readOnlyHint}>Read only</span>
        </div>
      );
    }
    return (
      <div className={styles.rowActions}>
        <button type="button" className="button button--primary button--small" onClick={onApprove} disabled={busy}>
          {busy ? "Approving…" : "Approve link"}
        </button>
        <button type="button" className="button button--quiet button--small" onClick={onReject} disabled={busy}>
          Reject
        </button>
      </div>
    );
  }

  return (
    <div className={styles.rejectBox}>
      <div className="field">
        <label htmlFor={`reject-reason-${id}`}>Rejection reason (required)</label>
        <textarea
          id={`reject-reason-${id}`}
          className="textarea"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          aria-required="true"
          aria-invalid={reasonError}
          aria-describedby={reasonError ? `reject-error-${id}` : undefined}
          placeholder="Why is this request being rejected? This reason is recorded on the request."
        />
        {reasonError ? (
          <p id={`reject-error-${id}`} className="field-error">
            A rejection reason is required.
          </p>
        ) : null}
      </div>
      <div className={styles.rejectActions}>
        <button
          type="button"
          className="button button--primary button--small"
          onClick={onRejectConfirm}
          disabled={busy}
        >
          {busy ? "Rejecting…" : "Confirm rejection"}
        </button>
        <button type="button" className="button button--quiet button--small" onClick={onCancelReject} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
