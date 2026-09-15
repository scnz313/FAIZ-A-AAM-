"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FamilyCapability, GuardianStudentLink } from "@fass/contracts";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import Button from "@/components/ui/Button";
import { canAnyRole } from "@/modules/services/staff-profiles";
import {
  familyContextService,
  type LinkRequestRow,
  type LinkRequestRowPage,
  type LinkRequestSummary,
  type LinkSummaryPage,
} from "@/modules/services/family-context";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./page.module.css";

/** Append a queue page, deduplicating by link id (a local move can shift a boundary). */
function appendSummaryPage(current: LinkSummaryPage | null, next: LinkSummaryPage): LinkSummaryPage {
  const seen = new Set((current?.rows ?? []).map((row) => row.link.id));
  const rows = [...(current?.rows ?? []), ...next.rows.filter((row) => !seen.has(row.link.id))];
  return { rows, total: next.total, nextOffset: next.nextOffset };
}

function appendRequestPage(current: LinkRequestRowPage | null, next: LinkRequestRowPage): LinkRequestRowPage {
  const seen = new Set((current?.rows ?? []).map((row) => row.request.id));
  const rows = [...(current?.rows ?? []), ...next.rows.filter((row) => !seen.has(row.request.id))];
  return { rows, total: next.total, nextOffset: next.nextOffset };
}

/**
 * Staff-facing labels for the five guardian capabilities. Values mirror
 * `FAMILY_CAPABILITIES` in @fass/contracts; this order is also the order
 * persisted on save so the stored set stays deterministic.
 */
const MODULE_OPTIONS: ReadonlyArray<{ value: FamilyCapability; label: string; hint: string; required?: boolean }> = [
  {
    value: "academics",
    label: "Academics and results",
    hint: "Attendance, progress, and published results.",
  },
  {
    value: "finance",
    label: "Fees and payments",
    hint: "Invoices, receipts, dues, and payment history.",
  },
  {
    value: "documents",
    label: "Documents",
    hint: "Certificates and documents shared by the school.",
  },
  {
    value: "notices",
    label: "Notices",
    hint: "School notices and announcements for this child.",
  },
  {
    value: "profile",
    label: "Profile and linked children",
    hint: "The portal loads the child record through this capability.",
    required: true,
  },
];

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
  const [requests, setRequests] = useState<LinkRequestRowPage | null>(null);
  const [graphLinks, setGraphLinks] = useState<LinkSummaryPage | null>(null);
  const [activeLinks, setActiveLinks] = useState<LinkSummaryPage | null>(null);
  const [restrictedLinks, setRestrictedLinks] = useState<LinkSummaryPage | null>(null);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [restrictedError, setRestrictedError] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [modulesOpenId, setModulesOpenId] = useState<string | null>(null);
  const [restrictingId, setRestrictingId] = useState<string | null>(null);
  const [restrictReason, setRestrictReason] = useState("");
  const [restrictError, setRestrictError] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const modulesToggleRef = useRef<HTMLButtonElement | null>(null);

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

  /** The restricted queue loads independently: its failure must not blank the
      active queue, so the error stays local to the restricted section. */
  const loadRestricted = useCallback(async (): Promise<void> => {
    setRestrictedError(false);
    try {
      setRestrictedLinks(await familyContextService.listRestrictedLinkSummaries());
    } catch {
      setRestrictedError(true);
    }
  }, []);

  const loadInitial = useCallback(async (): Promise<void> => {
    setLoadError(false);
    try {
      const [nextRequests, nextGraphLinks, nextActiveLinks] = await Promise.all([
        familyContextService.listLinkRequests(),
        familyContextService.listLinkRequestSummaries(),
        familyContextService.listActiveLinkSummaries(),
      ]);
      setRequests(nextRequests);
      setGraphLinks(nextGraphLinks);
      setActiveLinks(nextActiveLinks);
    } catch {
      /* Keep prior rows (if any) and surface retry — never silently empty the queues. */
      setLoadError(true);
    }
    await loadRestricted();
  }, [loadRestricted]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const actorPersonId = summary?.personId ?? undefined;

  async function approveRequest(requestId: string): Promise<void> {
    setBusyId(requestId);
    try {
      const request = await familyContextService.approvePendingLinkRequest(requestId, actorPersonId);
      const approvedLink = request.approvedLinkId;
      setNotice(
        `Request ${request.ref} approved · ${approvedLink !== null ? "the guardian can now access the student." : "the link is being created."}`,
      );
    } catch {
      setNotice(`Request could not be approved · nothing changed. Try again.`);
      setBusyId(null);
      return;
    }
    try {
      await refresh();
    } catch {
      setNotice((prev) => `${prev} The list could not be refreshed · reload the page to confirm.`);
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
      setNotice(`Request ${request.ref} rejected · ${cleanReason}`);
      setRejectingId(null);
      setReason("");
    } catch {
      setNotice(`Request could not be rejected · nothing changed. Try again.`);
      setBusyId(null);
      return;
    }
    try {
      await refresh();
    } catch {
      setNotice((prev) => `${prev} The list could not be refreshed · reload the page to confirm.`);
    } finally {
      setBusyId(null);
    }
  }

  async function approveLink(linkId: string): Promise<void> {
    setBusyId(linkId);
    try {
      const link = await familyContextService.approveLink(linkId);
      setNotice(`Link ${link.ref} approved · the guardian can now access the student.`);
    } catch {
      setNotice(`Link could not be approved · nothing changed. Try again.`);
      setBusyId(null);
      return;
    }
    try {
      await refresh();
    } catch {
      setNotice((prev) => `${prev} The list could not be refreshed · reload the page to confirm.`);
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
      setNotice(`Link ${link.ref} rejected · ${cleanReason}`);
      setRejectingId(null);
      setReason("");
    } catch {
      setNotice(`Link could not be rejected · nothing changed. Try again.`);
      setBusyId(null);
      return;
    }
    try {
      await refresh();
    } catch {
      setNotice((prev) => `${prev} The list could not be refreshed · reload the page to confirm.`);
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(linkId: string): Promise<void> {
    setBusyId(linkId);
    try {
      const link = await familyContextService.revokeLink(linkId);
      setNotice(`Link ${link.ref} revoked · the guardian's access ends immediately.`);
      setRevokingId(null);
    } catch {
      setNotice(`Link could not be revoked · access is unchanged. Try again.`);
      setBusyId(null);
      return;
    }
    try {
      await refresh();
    } catch {
      setNotice((prev) => `${prev} The list could not be refreshed · reload the page to confirm.`);
    } finally {
      setBusyId(null);
    }
  }

  /** Open one row's Restrict confirm. Only one inline panel is open at a time. */
  function startRestrict(linkId: string): void {
    setModulesOpenId(null);
    setRevokingId(null);
    setRestoringId(null);
    setRestrictReason("");
    setRestrictError("");
    setRestrictingId(linkId);
  }

  /** Pause an active link; the row moves to the restricted queue on success. */
  async function restrictActiveLink(linkId: string): Promise<void> {
    const cleanReason = restrictReason.trim();
    if (cleanReason.length < 3) {
      setRestrictError("Enter a restriction reason of at least 3 characters.");
      return;
    }
    setRestrictError("");
    setBusyId(linkId);
    const row = (activeLinks?.rows ?? []).find((candidate) => candidate.link.id === linkId);
    try {
      const updated = await familyContextService.restrictLink(linkId, cleanReason);
      setActiveLinks((page) =>
        page === null
          ? page
          : {
              ...page,
              rows: page.rows.filter((candidate) => candidate.link.id !== linkId),
              total: Math.max(0, page.total - 1),
            },
      );
      if (row !== undefined) {
        const moved: LinkRequestSummary = {
          ...row,
          link: { ...row.link, status: "restricted", restrictionReason: cleanReason, version: updated.version },
        };
        setRestrictedLinks((page) =>
          page === null
            ? page
            : {
                ...page,
                rows: [...page.rows, moved].sort((a, b) => a.guardianName.localeCompare(b.guardianName)),
                total: page.total + 1,
              },
        );
        setNotice(`Link ${row.link.ref} restricted · portal access is paused until the school restores it.`);
      } else {
        setNotice("The link was restricted, but its row could not be moved here. Reload the page to confirm.");
      }
      setRestrictingId(null);
      setRestrictReason("");
    } catch (error) {
      setRestrictError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "The link could not be restricted · nothing changed. Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  /** Open one restricted row's Restore confirm. Only one inline panel at a time. */
  function startRestore(linkId: string): void {
    setModulesOpenId(null);
    setRevokingId(null);
    setRestrictingId(null);
    setRestrictError("");
    setRestoreReason("");
    setRestoreError("");
    setRestoringId(linkId);
  }

  /** Re-enable a restricted link; the row moves back to the active queue. */
  async function restoreRestrictedLink(linkId: string): Promise<void> {
    const cleanReason = restoreReason.trim();
    if (cleanReason.length < 3) {
      setRestoreError("Enter a restoration reason of at least 3 characters.");
      return;
    }
    setRestoreError("");
    setBusyId(linkId);
    const row = (restrictedLinks?.rows ?? []).find((candidate) => candidate.link.id === linkId);
    try {
      const updated = await familyContextService.restoreLink(linkId, cleanReason);
      setRestrictedLinks((page) =>
        page === null
          ? page
          : {
              ...page,
              rows: page.rows.filter((candidate) => candidate.link.id !== linkId),
              total: Math.max(0, page.total - 1),
            },
      );
      if (row !== undefined) {
        const moved: LinkRequestSummary = {
          ...row,
          link: { ...row.link, status: "active", restrictionReason: null, version: updated.version },
        };
        setActiveLinks((page) =>
          page === null
            ? page
            : {
                ...page,
                rows: [...page.rows, moved].sort((a, b) => a.guardianName.localeCompare(b.guardianName)),
                total: page.total + 1,
              },
        );
        setNotice(`Link ${row.link.ref} restored · the guardian's original module set is active again.`);
      } else {
        setNotice("The link was restored, but its row could not be moved here. Reload the page to confirm.");
      }
      setRestoringId(null);
      setRestoreReason("");
    } catch (error) {
      setRestoreError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "The link could not be restored · the pause remains in place. Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  /** Open one row's module editor; the revoke confirm never shares the row. */
  function openModulesEditor(linkId: string): void {
    setRevokingId(null);
    setRestrictingId(null);
    setRestoringId(null);
    setModulesOpenId(linkId);
  }

  /**
   * Close the editor and return focus to its Modules toggle. The toggle stays
   * mounted, so focusing before the state update keeps keyboard position.
   */
  function closeModulesEditor(): void {
    modulesToggleRef.current?.focus();
    setModulesOpenId(null);
  }

  /** Fold a saved capability set into the active list without a full reload. */
  function applySavedCapabilities(updated: GuardianStudentLink): void {
    setActiveLinks((page) =>
      page === null
        ? page
        : {
            ...page,
            rows: page.rows.map((row) =>
              row.link.id === updated.id
                ? {
                    ...row,
                    link: { ...row.link, capabilities: [...updated.capabilities], version: updated.version },
                  }
                : row,
            ),
          },
    );
  }

  /**
   * Append one page of a queue. Rows are deduplicated by link id so a local
   * move (restrict/restore) can never produce a duplicate when the server page
   * boundary shifts underneath it.
   */
  async function loadMore(kind: "pending" | "active" | "restricted"): Promise<void> {
    if (loadingMore !== null) return;
    const page = kind === "pending" ? requests : kind === "active" ? activeLinks : restrictedLinks;
    if (page === null || page.nextOffset === null) return;
    setLoadingMore(kind);
    try {
      if (kind === "pending") {
        const [nextRequests, nextGraphLinks] = await Promise.all([
          familyContextService.listLinkRequests(page.nextOffset),
          familyContextService.listLinkRequestSummaries(page.nextOffset),
        ]);
        setRequests((current) => appendRequestPage(current, nextRequests));
        setGraphLinks((current) => appendSummaryPage(current, nextGraphLinks));
      } else if (kind === "active") {
        const next = await familyContextService.listActiveLinkSummaries(page.nextOffset);
        setActiveLinks((current) => appendSummaryPage(current, next));
      } else {
        const next = await familyContextService.listRestrictedLinkSummaries(page.nextOffset);
        setRestrictedLinks((current) => appendSummaryPage(current, next));
      }
    } catch {
      setNotice("The next page could not be loaded · the rows already shown are unchanged. Try again.");
    } finally {
      setLoadingMore(null);
    }
  }

  useEffect(() => {
    if (notice !== "") noticeRef.current?.focus();
  }, [notice]);

  if (requests === null || graphLinks === null || activeLinks === null) {
    return (
      <div className={styles.page}>
        <div className="page-head">
          <div>
            <h1 className={styles.title}>Link requests</h1>
            <p className="ph-sub" role="status" aria-live="polite">
              Loading pending guardian/student links…
            </p>
          </div>
        </div>
        {loadError ? (
          <div className="callout bad" role="alert">
            <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
              close
            </span>
            <div>
              <p className="strong" style={{ margin: 0 }}>
                Link queues could not be loaded.
              </p>
              <p className="small muted" style={{ margin: "4px 0 0" }}>
                No request was decided · the queues are simply unreachable. Try again.
              </p>
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadInitial()}>
                  Try again
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const restrictedNextOffset = restrictedLinks?.nextOffset ?? null;
  const pendingRequests = requests.rows.filter((row) => row.request.status === "pending");
  const decidedRequests = requests.rows.filter((row) => row.request.status !== "pending");
  const pendingGraphLinks = graphLinks.rows.filter((row) => row.link.status === "pending_verification");

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Link requests</h1>
          <p className="ph-sub">
            Guardian/student links awaiting school verification. Approving a request activates the family portal
            access immediately; rejecting requires a visible reason recorded on the request.
          </p>
        </div>
      </div>

      {!supabaseMode ? (
        <p className={styles.demoLine}>
          <span className="demo-badge">Demo data</span> Deterministic demo decisions through the relationship
          service · real verification evidence and revocation arrive with the backend.
        </p>
      ) : null}

      <div className="callout">
        <span className="msym" aria-hidden="true">gpp_good</span>
        <span className="small">
          A student number, name, date of birth, or phone alone never activates access. The office must verify the
          guardian relationship and issue a claim reference before a link is approved.
        </span>
      </div>

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
                  <strong>{student?.displayName ?? "Student record"}</strong>
                  <StatusBadge tone="watch">Pending verification</StatusBadge>
                </p>
                <p className={styles.rowMeta}>
                  <span className="num">{request.ref}</span>
                  <span>· {request.relation}</span>
                  {request.childAdmissionRef ? <span>· student ref {request.childAdmissionRef}</span> : null}
                  <span>· requested {formatKolkata(request.requestedAtIso, { format: "day" })}</span>
                  <span>· v{request.version}</span>
                </p>
                {student === null ? (
                  <p className={styles.rowMeta} role="note">
                    The supplied reference could not be matched to a student record · ask the guardian for the
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

      {graphLinks.nextOffset !== null ? (
        <div className={styles.rows} style={{ marginTop: 12 }}>
          <Button variant="quiet" onClick={() => void loadMore("pending")} disabled={loadingMore !== null}>
            {loadingMore === "pending"
              ? "Loading…"
              : `Show more pending links (${graphLinks.rows.length} of ${graphLinks.total})`}
          </Button>
        </div>
      ) : null}

      <h2 className={styles.subHeading}>Active links</h2>
      {activeLinks.rows.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No active links</p>
          <p className="workspace-state-note">Approved links appear here. Revoking one ends the guardian&apos;s access immediately.</p>
        </div>
      ) : (
        <div className={styles.rows}>
          {activeLinks.rows.map(({ link, guardianName, studentName }) => (
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
                  <span className={styles.rowModules}>
                    · Modules:{" "}
                    {link.capabilities.length === MODULE_OPTIONS.length
                      ? "all"
                      : `${link.capabilities.length} of ${MODULE_OPTIONS.length}`}
                  </span>
                </p>
              </div>
              {restrictingId === link.id ? (
                <InlineReasonConfirm
                  id={`restrict-reason-${link.id}`}
                  label="Restriction reason (at least 3 characters)"
                  placeholder="Why is this link being paused? The reason is recorded and visible to staff."
                  confirmLabel="Confirm restriction"
                  busyLabel="Restricting…"
                  value={restrictReason}
                  error={restrictError}
                  busy={busyId === link.id}
                  onValueChange={(value) => {
                    setRestrictReason(value);
                    if (restrictError !== "") setRestrictError("");
                  }}
                  onConfirm={() => void restrictActiveLink(link.id)}
                  onCancel={() => {
                    setRestrictingId(null);
                    setRestrictReason("");
                    setRestrictError("");
                  }}
                />
              ) : revokingId === link.id ? (
                <div className={styles.rowActions}>
                  <span className={styles.confirmCopy}>Revoking is final and ends portal access immediately.</span>
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
                    onClick={() => openModulesEditor(link.id)}
                    disabled={busyId === link.id}
                    aria-expanded={modulesOpenId === link.id}
                    aria-controls={modulesOpenId === link.id ? `modules-editor-${link.id}` : undefined}
                    ref={modulesOpenId === link.id ? modulesToggleRef : undefined}
                  >
                    Modules
                  </button>
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    onClick={() => startRestrict(link.id)}
                    disabled={busyId === link.id}
                  >
                    Restrict
                  </button>
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    onClick={() => {
                      setModulesOpenId(null);
                      setRestrictingId(null);
                      setRevokingId(link.id);
                    }}
                    disabled={busyId === link.id}
                  >
                    Revoke
                  </button>
                </div>
              ) : null}
              {modulesOpenId === link.id ? (
                <LinkModulesEditor
                  id={`modules-editor-${link.id}`}
                  link={link}
                  guardianName={guardianName}
                  studentName={studentName}
                  onClose={closeModulesEditor}
                  onSaved={(updated) => {
                    applySavedCapabilities(updated);
                    setModulesOpenId(null);
                    setNotice(
                      `Modules updated for ${updated.ref} · the guardian's access now follows the selected set.`,
                    );
                  }}
                />
              ) : null}
            </article>
          ))}
        </div>
      )}

      {activeLinks.nextOffset !== null ? (
        <div className={styles.rows} style={{ marginTop: 12 }}>
          <Button variant="quiet" onClick={() => void loadMore("active")} disabled={loadingMore !== null}>
            {loadingMore === "active"
              ? "Loading…"
              : `Show more active links (${activeLinks.rows.length} of ${activeLinks.total})`}
          </Button>
        </div>
      ) : null}

      <h2 className={styles.subHeading}>Restricted links</h2>
      <p className={styles.sectionNote}>
        Restricting pauses a link pending review. Restoring re-enables the same link and module set. Revoking is
        final and remains a separate decision on the active queue.
      </p>
      {restrictedError && restrictedLinks === null ? (
        <div className="callout bad" role="alert">
          <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
            close
          </span>
          <div>
            <p className="strong" style={{ margin: 0 }}>
              Restricted links could not be loaded.
            </p>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              The active and pending queues are unaffected. Try again to load paused links.
            </p>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadRestricted()}>
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : restrictedLinks === null ? (
        <div className="workspace-state">
          <p className="workspace-state-title">Loading restricted links…</p>
          <p className="workspace-state-note">Paused links appear here once loaded.</p>
        </div>
      ) : restrictedLinks.rows.length === 0 ? (
        <div className="workspace-state">
          <p className="workspace-state-title">No restricted links</p>
          <p className="workspace-state-note">
            Pausing an active link moves it here. The link and its module set are kept for an audited restore.
          </p>
        </div>
      ) : (
        <div className={styles.rows}>
          {restrictedLinks.rows.map(({ link, guardianName, studentName }) => (
            <article className={styles.row} key={link.id}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>
                  <strong>{guardianName}</strong> → <strong>{studentName}</strong>
                  <StatusBadge tone="watch">Restricted</StatusBadge>
                </p>
                <p className={styles.rowMeta}>
                  <span className="num">{link.ref}</span>
                  <span>· {link.relationshipLabel}</span>
                  <span>· v{link.version}</span>
                  {link.restrictionReason !== null ? <span>· {link.restrictionReason}</span> : null}
                </p>
                <p className={styles.rowMeta}>
                  <span>Portal access is paused. Restoring re-enables the same link and module set.</span>
                </p>
              </div>
              {restoringId === link.id ? (
                <InlineReasonConfirm
                  id={`restore-reason-${link.id}`}
                  label="Restoration reason (at least 3 characters)"
                  placeholder="What review cleared the restriction? The reason is recorded on the link."
                  confirmLabel="Confirm restore"
                  busyLabel="Restoring…"
                  value={restoreReason}
                  error={restoreError}
                  busy={busyId === link.id}
                  onValueChange={(value) => {
                    setRestoreReason(value);
                    if (restoreError !== "") setRestoreError("");
                  }}
                  onConfirm={() => void restoreRestrictedLink(link.id)}
                  onCancel={() => {
                    setRestoringId(null);
                    setRestoreReason("");
                    setRestoreError("");
                  }}
                />
              ) : canVerify ? (
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    onClick={() => startRestore(link.id)}
                    disabled={busyId === link.id}
                  >
                    Restore
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {restrictedNextOffset !== null ? (
        <div className={styles.rows} style={{ marginTop: 12 }}>
          <Button variant="quiet" onClick={() => void loadMore("restricted")} disabled={loadingMore !== null}>
            {loadingMore === "restricted"
              ? "Loading…"
              : `Show more restricted links (${restrictedLinks?.rows.length ?? 0} of ${restrictedLinks?.total ?? 0})`}
          </Button>
        </div>
      ) : null}

      {decidedRequests.length > 0 ? (
        <>
          <h2 className={styles.subHeading}>Decided requests</h2>
          <div className={styles.rows}>
            {decidedRequests.map(({ request, student }) => (
              <article className={styles.row} key={request.id}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>
                    <strong>{request.guardianName}</strong> →{" "}
                    <strong>{student?.displayName ?? "Student record"}</strong>
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

/**
 * Shared inline reason + confirm panel for the Restrict and Restore commands.
 * Escape cancels; the textarea takes initial focus so the panel is usable from
 * the keyboard. The parent owns the reason, error, and busy state, so a failed
 * command keeps the typed reason visible for a retry.
 */
function InlineReasonConfirm({
  id,
  label,
  placeholder,
  confirmLabel,
  busyLabel,
  value,
  error,
  busy,
  onValueChange,
  onConfirm,
  onCancel,
}: {
  id: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  busyLabel: string;
  value: string;
  error: string;
  busy: boolean;
  onValueChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.reasonBox}
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <textarea
          id={id}
          ref={fieldRef}
          className="textarea"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          aria-required="true"
          aria-invalid={error !== ""}
          aria-describedby={error !== "" ? `${id}-error` : undefined}
          placeholder={placeholder}
        />
        {error !== "" ? (
          <p id={`${id}-error`} className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className={styles.reasonActions}>
        <button type="button" className="button button--primary button--small" onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
        <button type="button" className="button button--quiet button--small" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Inline module editor for one active guardian/student link. It only changes
 * the capability set the server evaluates on the guardian's next read; the
 * service remains the authorization boundary.
 *
 * Empty set: blocked, not saved. An active link with no modules grants the
 * guardian nothing while still looking active, so the honest option is to
 * revoke the link. Save stays disabled and the inline warning says why.
 * (Owner choice: block-and-explain is simpler and safer than a second
 * destructive confirm.)
 */
function LinkModulesEditor({
  id,
  link,
  guardianName,
  studentName,
  onClose,
  onSaved,
}: {
  id: string;
  link: GuardianStudentLink;
  guardianName: string;
  studentName: string;
  onClose: () => void;
  onSaved: (updated: GuardianStudentLink) => void;
}) {
  const [selection, setSelection] = useState<FamilyCapability[]>(() => [...link.capabilities]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const ordered = MODULE_OPTIONS.map((option) => option.value).filter((value) => selection.includes(value));
  const dirty = [...link.capabilities].sort().join(",") !== [...ordered].sort().join(",");

  function toggle(value: FamilyCapability): void {
    const option = MODULE_OPTIONS.find((candidate) => candidate.value === value);
    /* The portal loads the child record through the profile capability:
       removing it would break every module, so it is not toggleable. */
    if (option?.required) return;
    setError("");
    setSelection((previous) =>
      previous.includes(value) ? previous.filter((candidate) => candidate !== value) : [...previous, value],
    );
  }

  async function save(): Promise<void> {
    if (saving || !dirty) return;
    setSaving(true);
    setError("");
    try {
      const updated = await familyContextService.changeLinkCapabilities(link.id, ordered);
      onSaved(updated);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message.trim() !== ""
          ? reason.message
          : "Modules could not be updated · nothing changed. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      id={id}
      ref={panelRef}
      className={styles.modulesBox}
      role="group"
      aria-label={`Modules for ${guardianName} and ${studentName}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!saving) onClose();
        }
      }}
    >
      <fieldset className={styles.modulesFieldset} disabled={saving}>
        <legend className={styles.modulesLegend}>Modules the guardian can read for {studentName}</legend>
        <div className={styles.modulesGrid}>
          {MODULE_OPTIONS.map((option) => (
            <label key={option.value} className={styles.moduleOption}>
              <input
                type="checkbox"
                checked={option.required ? true : selection.includes(option.value)}
                onChange={() => toggle(option.value)}
                disabled={option.required === true}
              />
              <span className={styles.moduleText}>
                <span className={styles.moduleLabel}>
                  {option.label}
                  {option.required ? <span className={styles.moduleRequired}>Required</span> : null}
                </span>
                <span className={styles.moduleHint}>{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className={styles.modulesNote}>
        Changes apply to the guardian&apos;s next request. Server authorization checks this set on every read,
        and the school can revoke the link at any time.
      </p>
      {selection.filter((value) => value !== "profile").length === 0 ? (
        <p className={styles.modulesWarning} role="status">
          No school modules selected · the guardian will see only the child profile until a module is enabled.
        </p>
      ) : null}
      {error !== "" ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.modulesActions}>
        <button
          type="button"
          className="button button--primary button--small"
          onClick={() => void save()}
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : error !== "" ? "Try again" : "Save modules"}
        </button>
        <button type="button" className="button button--quiet button--small" onClick={onClose} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
