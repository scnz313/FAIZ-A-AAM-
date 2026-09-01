"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import {
  usersService,
  type InviteResult,
  type UserRow,
  type UserStatus,
} from "@/modules/services/users";
import { canAnyRole, listProfileSummaries } from "@/modules/services/staff-profiles";
import type { StaffProfileCode } from "@fass/contracts";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./page.module.css";

const STATUS_TONE: Record<UserStatus, "good" | "watch" | "alert"> = {
  Active: "good",
  Invited: "watch",
  Suspended: "alert",
  Expired: "alert",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InviteErrors = { name?: string; email?: string; reason?: string };
type ChangeErrors = { reason?: string };

export default function UsersPage() {
  const { summary } = useStaffContext();
  const canManage = canAnyRole(summary?.roles ?? [], "users.manage");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteProfile, setInviteProfile] = useState<StaffProfileCode>("principal");
  const [inviteTitle, setInviteTitle] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteReason, setInviteReason] = useState("");
  const [inviteErrors, setInviteErrors] = useState<InviteErrors>({});
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeError, setRevokeError] = useState(false);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendError, setSuspendError] = useState(false);
  /* Profile change panel state. */
  const [changingId, setChangingId] = useState<string | null>(null);
  const [changeProfile, setChangeProfile] = useState<StaffProfileCode>("principal");
  const [changeReason, setChangeReason] = useState("");
  const [changeErrors, setChangeErrors] = useState<ChangeErrors>({});
  const seq = useRef(0);

  const profiles = listProfileSummaries();

  const refresh = useCallback(async (): Promise<void> => {
    const list = await usersService.listUsers();
    setRows(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void usersService
      .listUsers()
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function announce(text: string) {
    setAnnouncement((prev) => ({ key: (prev?.key ?? 0) + 1, text }));
  }

  function clearInviteError(field: keyof InviteErrors) {
    setInviteErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  function cancelInvite() {
    setInviteOpen(false);
    setInviteName("");
    setInviteEmail("");
    setInviteReason("");
    setInviteTitle("");
    setInviteErrors({});
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: InviteErrors = {
      name: inviteName.trim() ? undefined : "Name is required.",
      email: inviteEmail.trim() ? undefined : "Email is required.",
      reason: inviteReason.trim() ? undefined : "A reason is required for the audit trail.",
    };
    if (next.email === undefined && !EMAIL_RE.test(inviteEmail.trim())) {
      next.email = "Enter a valid email address.";
    }
    setInviteErrors(next);
    if (Object.values(next).some((value) => value !== undefined)) return;

    setBusy(true);
    setError(null);
    try {
      const result = await usersService.inviteUser({
        name: inviteName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        profileCode: inviteProfile,
        title: inviteTitle.trim() || undefined,
        reason: inviteReason.trim(),
      });
      setInviteResult(result);
      setInviteOpen(false);
      setInviteName("");
      setInviteEmail("");
      setInviteReason("");
      setInviteTitle("");
      announce(`Invitation sent to ${inviteEmail.trim().toLowerCase()} — the signed invitation path is ready.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invitation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeRole(accountId: string, grantId: string) {
    const cleanReason = revokeReason.trim();
    if (cleanReason === "") {
      setRevokeError(true);
      return;
    }
    setRevokeError(false);
    setBusy(true);
    setError(null);
    try {
      await usersService.revokeRole({ grantId, reason: cleanReason });
      setRevokingGrantId(null);
      setRevokeReason("");
      announce(`Role revoked — access ends immediately.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSuspend(accountId: string) {
    const cleanReason = suspendReason.trim();
    if (cleanReason === "") {
      setSuspendError(true);
      return;
    }
    setSuspendError(false);
    setBusy(true);
    setError(null);
    try {
      await usersService.suspendAccount({ accountId, reason: cleanReason });
      setSuspendingId(null);
      setSuspendReason("");
      announce(`Account suspended — all access revoked.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suspend failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReactivate(accountId: string) {
    setBusy(true);
    setError(null);
    try {
      await usersService.reactivateAccount({ accountId });
      announce(`Account reactivated.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reactivation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeProfile(accountId: string) {
    const next: ChangeErrors = {
      reason: changeReason.trim() ? undefined : "A reason is required for the audit trail.",
    };
    setChangeErrors(next);
    if (Object.values(next).some((value) => value !== undefined)) return;

    setBusy(true);
    setError(null);
    try {
      const target = rows?.find((row) => row.accountId === accountId);
      await usersService.changeProfile({
        accountId,
        profileCode: changeProfile,
        reason: changeReason.trim(),
        expectedVersion: target?.profileVersion ?? 1,
      });
      setChangingId(null);
      setChangeReason("");
      setChangeErrors({});
      announce(`Profile changed — the account now uses ${changeProfile}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile change failed.");
    } finally {
      setBusy(false);
    }
  }

  void seq;

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Access</p>
        <h1 className="workspace-title">Staff access</h1>
        <p className="workspace-intro">Invite staff by access profile and manage internal grants.</p>
      </header>

      <p className={styles.legend}>
        Two access profiles cover the school: Administrator manages accounts, configuration, and final approvals;
        Principal handles daily operations, result entry, and drafting. Teachers are non-login school records managed
        in the timetable workspace. Internal permission details remain visible to the school office.
      </p>

      {error && (
        <p className={styles.errorNote} role="alert">
          {error}
        </p>
      )}

      {inviteResult && (
        <section className={`panel ${styles.inviteResult}`} aria-labelledby="invite-result-heading">
          <div className={styles.panelHead}>
            <h2 id="invite-result-heading" className={styles.panelTitle}>
              Invitation created
            </h2>
            <Button variant="quiet" type="button" onClick={() => setInviteResult(null)}>
              Dismiss
            </Button>
          </div>
          <p className={styles.inviteResultCopy}>
            <strong>{inviteResult.userRow.name}</strong> has been invited as{" "}
            <strong>{inviteResult.userRow.role}</strong>.{" "}
            {supabaseMode
              ? "Supabase Auth has sent a signed invitation to the verified contact."
              : "Share this one-time reference with the invitee — it is shown only once:"}
          </p>
          {inviteResult.invitationRef ? (
            <p className={styles.inviteResultCopy}>
              Invitation reference: <span className="num">{inviteResult.invitationRef}</span>
            </p>
          ) : null}
          {inviteResult.oneTimeRef ? (
            <p className={styles.oneTimeRef}>
              <span className="num">{inviteResult.oneTimeRef}</span>
            </p>
          ) : null}
          <p className={styles.inviteResultNote}>
            The invitee completes setup at{" "}
            {inviteResult.invitationRef ? (
              <Link prefetch={false} href={`/sign-in/invite?invitation=${encodeURIComponent(inviteResult.invitationRef)}`}>
                the invitation page
              </Link>
            ) : (
              "the invitation link"
            )}
            . The account is <em>Invited</em> until acceptance.
          </p>
        </section>
      )}

      <section className="panel" aria-labelledby="users-list-heading">
        <div className={styles.panelHead}>
          <h2 id="users-list-heading" className={styles.panelTitle}>
            Staff accounts
          </h2>
          {!supabaseMode ? <span className="demo-badge">Demo data</span> : null}
        </div>

        {announcement && (
          <p key={announcement.key} className={styles.liveNote} aria-live="polite">
            {announcement.text}
          </p>
        )}

        <div className={styles.inviteRow}>
          <Button variant="primary" onClick={() => { setInviteOpen(true); setInviteErrors({}); }} disabled={!canManage}>
            Invite staff
          </Button>
        </div>

        {inviteOpen && (
          <form className={styles.inviteForm} onSubmit={handleInvite} noValidate>
            <div className={styles.profileGrid} role="radiogroup" aria-label="Access profile">
              {profiles.map((profile) => (
                <button
                  key={profile.code}
                  type="button"
                  role="radio"
                  aria-checked={inviteProfile === profile.code}
                  className={`${styles.profileCard}${inviteProfile === profile.code ? ` ${styles.profileCardActive}` : ""}`}
                  onClick={() => {
                    setInviteProfile(profile.code);
                    clearInviteError("reason");
                  }}
                >
                  <strong>{profile.label}</strong>
                  <span>{profile.description}</span>
                  <small>
                    {profile.roles.map((role) => role.replace(/_/g, " ")).join(" · ")}
                  </small>
                </button>
              ))}
            </div>

            <div className={styles.inviteFields}>
              <div className={`field ${inviteErrors.name ? "field--invalid" : ""}`}>
                <label htmlFor="invite-name">Name</label>
                <input
                  id="invite-name"
                  className="input"
                  type="text"
                  value={inviteName}
                  onChange={(event) => {
                    setInviteName(event.target.value);
                    clearInviteError("name");
                  }}
                  placeholder="e.g. S. Ahmed"
                  aria-invalid={inviteErrors.name !== undefined}
                  aria-describedby={inviteErrors.name ? "invite-name-error" : undefined}
                />
                {inviteErrors.name && (
                  <p className="field-error" id="invite-name-error">
                    {inviteErrors.name}
                  </p>
                )}
              </div>
              <div className={`field ${inviteErrors.email ? "field--invalid" : ""}`}>
                <label htmlFor="invite-email">Email</label>
                <input
                  id="invite-email"
                  className="input"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    clearInviteError("email");
                  }}
                  placeholder="name@faizaam.example"
                  aria-invalid={inviteErrors.email !== undefined}
                  aria-describedby={inviteErrors.email ? "invite-email-error" : undefined}
                />
                {inviteErrors.email && (
                  <p className="field-error" id="invite-email-error">
                    {inviteErrors.email}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="invite-title">Job title</label>
                <input
                  id="invite-title"
                  className="input"
                  type="text"
                  value={inviteTitle}
                  onChange={(event) => setInviteTitle(event.target.value)}
                  placeholder="e.g. School administrator"
                />
              </div>
            </div>

            <div className={`field ${inviteErrors.reason ? "field--invalid" : ""}`}>
              <label htmlFor="invite-reason">Reason (recorded in audit trail)</label>
              <input
                id="invite-reason"
                className="input"
                type="text"
                value={inviteReason}
                onChange={(event) => {
                  setInviteReason(event.target.value);
                  clearInviteError("reason");
                }}
                placeholder="Why is this person being invited?"
                aria-invalid={inviteErrors.reason !== undefined}
                aria-describedby={inviteErrors.reason ? "invite-reason-error" : undefined}
              />
              {inviteErrors.reason && (
                <p className="field-error" id="invite-reason-error">
                  {inviteErrors.reason}
                </p>
              )}
            </div>
            <div className={styles.inviteActions}>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send invitation"}
              </Button>
              <Button variant="quiet" type="button" onClick={cancelInvite} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        <div className="table--scroll">
          {rows === null ? (
            <p className={styles.loading} role="status">
              Loading staff accounts…
            </p>
          ) : rows.length === 0 ? (
            <div className="workspace-state">
              <p className="workspace-state-title">No staff accounts</p>
              <p className="workspace-state-note">Invite a staff member to get started.</p>
            </div>
          ) : (
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Staff accounts with profile, title, email, status and MFA</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Profile</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Last active</th>
                  <th scope="col">2FA</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <UserRowItem
                    key={row.key}
                    row={row}
                    expanded={expandedId === row.key}
                    onToggle={() => setExpandedId(expandedId === row.key ? null : row.key)}
                    canManage={canManage}
                    revokingGrantId={revokingGrantId}
                    onRevokeOpen={(grantId) => {
                      setRevokingGrantId(grantId);
                      setRevokeReason("");
                      setRevokeError(false);
                    }}
                    onRevokeCancel={() => {
                      setRevokingGrantId(null);
                      setRevokeReason("");
                      setRevokeError(false);
                    }}
                    revokeReason={revokeReason}
                    onRevokeReasonChange={setRevokeReason}
                    revokeError={revokeError}
                    onRevokeConfirm={(grantId) => void handleRevokeRole(row.accountId, grantId)}
                    suspending={suspendingId === row.accountId}
                    onSuspendOpen={() => {
                      setSuspendingId(row.accountId);
                      setSuspendReason("");
                      setSuspendError(false);
                    }}
                    onSuspendCancel={() => {
                      setSuspendingId(null);
                      setSuspendReason("");
                      setSuspendError(false);
                    }}
                    suspendReason={suspendReason}
                    onSuspendReasonChange={setSuspendReason}
                    suspendError={suspendError}
                    onSuspendConfirm={() => void handleSuspend(row.accountId)}
                    onReactivate={() => void handleReactivate(row.accountId)}
                    busy={busy}
                    changing={changingId === row.accountId}
                    onChangeOpen={() => {
                      setChangingId(row.accountId);
                      setChangeProfile(row.profileCode === "administrator" || row.profileCode === "principal" ? row.profileCode : "principal");
                      setChangeReason("");
                      setChangeErrors({});
                    }}
                    onChangeCancel={() => {
                      setChangingId(null);
                      setChangeReason("");
                      setChangeErrors({});
                    }}
                    changeProfile={changeProfile}
                    onChangeProfile={setChangeProfile}
                    changeReason={changeReason}
                    onChangeReason={setChangeReason}
                    changeErrors={changeErrors}
                    onChangeConfirm={() => void handleChangeProfile(row.accountId)}
                    profiles={profiles}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className={styles.note}>
        Privileged roles require MFA once authentication is live. Accounts are individual and attributable — one person,
        one login, exact scope. Profile codes never authorize requests by themselves; active grants, assignments, and
        server checks remain authoritative.
      </p>
      {!supabaseMode ? (
        <p className="demo-note">
          <span className="demo-badge">Demo data</span> All people, profiles and emails are fictional. Changes persist in
          this browser session only.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Expandable user row with profile management                         */
/* ------------------------------------------------------------------ */

function UserRowItem({
  row,
  expanded,
  onToggle,
  canManage,
  revokingGrantId,
  onRevokeOpen,
  onRevokeCancel,
  revokeReason,
  onRevokeReasonChange,
  revokeError,
  onRevokeConfirm,
  suspending,
  onSuspendOpen,
  onSuspendCancel,
  suspendReason,
  onSuspendReasonChange,
  suspendError,
  onSuspendConfirm,
  onReactivate,
  busy,
  changing,
  onChangeOpen,
  onChangeCancel,
  changeProfile,
  onChangeProfile,
  changeReason,
  onChangeReason,
  changeErrors,
  onChangeConfirm,
  profiles,
}: {
  row: UserRow;
  expanded: boolean;
  onToggle: () => void;
  canManage: boolean;
  revokingGrantId: string | null;
  onRevokeOpen: (grantId: string) => void;
  onRevokeCancel: () => void;
  revokeReason: string;
  onRevokeReasonChange: (reason: string) => void;
  revokeError: boolean;
  onRevokeConfirm: (grantId: string) => void;
  suspending: boolean;
  onSuspendOpen: () => void;
  onSuspendCancel: () => void;
  suspendReason: string;
  onSuspendReasonChange: (reason: string) => void;
  suspendError: boolean;
  onSuspendConfirm: () => void;
  onReactivate: () => void;
  busy: boolean;
  changing: boolean;
  onChangeOpen: () => void;
  onChangeCancel: () => void;
  changeProfile: StaffProfileCode;
  onChangeProfile: (profile: StaffProfileCode) => void;
  changeReason: string;
  onChangeReason: (reason: string) => void;
  changeErrors: ChangeErrors;
  onChangeConfirm: () => void;
  profiles: ReturnType<typeof listProfileSummaries>;
}) {
  const awaitingAcceptance = row.accountId === "";
  const profileBadge = row.profileLabel ?? (row.profileCode ? row.profileCode : "Legacy access — review required");
  return (
    <>
      <tr>
        <td className={styles.name}>{row.name}</td>
        <td className={styles.role}>{profileBadge}</td>
        <td className={styles.email}>{row.email}</td>
        <td>
          <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>
        </td>
        <td className={`num ${styles.lastActive}`}>{row.lastActiveLabel}</td>
        <td className={styles.twoFa}>{row.twoFa}</td>
        <td>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={onToggle}
            disabled={!canManage || awaitingAcceptance}
            aria-expanded={expanded}
            aria-label={expanded ? `Hide details for ${row.name}` : `Show details for ${row.name}`}
          >
            {awaitingAcceptance ? "Awaiting acceptance" : expanded ? "Close" : canManage ? "Manage" : "View"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className={styles.detailCell}>
            <div className={styles.detailPanel}>
              <h3 className={styles.detailHeading}>Access profile</h3>
              <p className={styles.noGrants}>
                {profileBadge}
                {row.profileCode === null || row.profileCode === undefined ? (
                  <span> — this account predates access profiles; review its internal grants below.</span>
                ) : null}
              </p>

              <h3 className={styles.detailHeading}>Internal role grants</h3>
              {row.grants.length === 0 ? (
                <p className={styles.noGrants}>No active role grants.</p>
              ) : (
                <ul className={styles.grantList}>
                  {row.grants.map((grant) => (
                    <li key={grant.id} className={styles.grantItem}>
                      <div className={styles.grantInfo}>
                        <strong>{grant.roleLabel}</strong>
                        <span className="num">{grant.ref}</span>
                        <span className={styles.grantReason}>{grant.reason}</span>
                      </div>
                      {revokingGrantId === grant.id ? (
                        <div className={styles.revokeBox}>
                          <div className="field">
                            <label htmlFor={`revoke-reason-${grant.id}`}>Revoke reason (required)</label>
                            <input
                              id={`revoke-reason-${grant.id}`}
                              className="input"
                              type="text"
                              value={revokeReason}
                              onChange={(event) => {
                                onRevokeReasonChange(event.target.value);
                              }}
                              aria-required="true"
                              aria-invalid={revokeError}
                              placeholder="Why is this role being revoked?"
                            />
                            {revokeError && <p className="field-error">A reason is required.</p>}
                          </div>
                          <div className={styles.revokeActions}>
                            <button
                              type="button"
                              className="button button--danger button--small"
                              onClick={() => onRevokeConfirm(grant.id)}
                              disabled={busy}
                            >
                              {busy ? "Revoking…" : "Confirm revoke"}
                            </button>
                            <button
                              type="button"
                              className="button button--quiet button--small"
                              onClick={onRevokeCancel}
                              disabled={busy}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="button button--quiet button--small"
                          onClick={() => onRevokeOpen(grant.id)}
                          disabled={busy || row.status === "Suspended" || row.profileCode !== null}
                          title={row.profileCode !== null ? "Use Change profile to adjust profile access" : undefined}
                        >
                          Revoke
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {changing ? (
                <div className={styles.grantForm}>
                  <div className="field">
                    <label htmlFor={`change-profile-${row.accountId}`}>New access profile</label>
                    <select
                      id={`change-profile-${row.accountId}`}
                      className="select"
                      value={changeProfile}
                      onChange={(event) => {
                        onChangeProfile(event.target.value as StaffProfileCode);
                      }}
                    >
                      {profiles.map((profile) => (
                        <option key={profile.code} value={profile.code}>
                          {profile.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={`field ${changeErrors.reason ? "field--invalid" : ""}`}>
                    <label htmlFor={`change-reason-${row.accountId}`}>Reason (required)</label>
                    <input
                      id={`change-reason-${row.accountId}`}
                      className="input"
                      type="text"
                      value={changeReason}
                      onChange={(event) => onChangeReason(event.target.value)}
                      placeholder="Why is this profile changing?"
                      aria-invalid={changeErrors.reason !== undefined}
                      aria-describedby={changeErrors.reason ? `change-reason-error-${row.accountId}` : undefined}
                    />
                    {changeErrors.reason && (
                      <p className="field-error" id={`change-reason-error-${row.accountId}`}>
                        {changeErrors.reason}
                      </p>
                    )}
                  </div>
                  <div className={styles.grantFormActions}>
                    <button
                      type="button"
                      className="button button--primary button--small"
                      onClick={onChangeConfirm}
                      disabled={busy}
                    >
                      {busy ? "Changing…" : "Change profile"}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      onClick={onChangeCancel}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                row.status !== "Suspended" && (
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    onClick={onChangeOpen}
                    disabled={busy}
                  >
                    Change profile
                  </button>
                )
              )}

              <div className={styles.accountActions}>
                {row.status === "Suspended" ? (
                  <button
                    type="button"
                    className="button button--primary button--small"
                    onClick={onReactivate}
                    disabled={busy}
                  >
                    {busy ? "Reactivating…" : "Reactivate account"}
                  </button>
                ) : suspending ? (
                  <div className={styles.suspendBox}>
                    <div className={`field ${suspendError ? "field--invalid" : ""}`}>
                      <label htmlFor={`suspend-reason-${row.accountId}`}>Suspend reason (required)</label>
                      <input
                        id={`suspend-reason-${row.accountId}`}
                        className="input"
                        type="text"
                        value={suspendReason}
                        onChange={(event) => {
                          onSuspendReasonChange(event.target.value);
                        }}
                        aria-required="true"
                        aria-invalid={suspendError}
                        placeholder="Why is this account being suspended?"
                      />
                      {suspendError && <p className="field-error">A reason is required.</p>}
                    </div>
                    <div className={styles.suspendActions}>
                      <button
                        type="button"
                        className="button button--danger button--small"
                        onClick={onSuspendConfirm}
                        disabled={busy}
                      >
                        {busy ? "Suspending…" : "Confirm suspend"}
                      </button>
                      <button
                        type="button"
                        className="button button--quiet button--small"
                        onClick={onSuspendCancel}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button--danger button--small"
                    onClick={onSuspendOpen}
                    disabled={busy}
                  >
                    Suspend account
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
