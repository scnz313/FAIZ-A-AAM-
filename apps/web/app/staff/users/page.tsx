"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { usersService, type UserRow, type UserStatus } from "@/modules/services/users";

import styles from "./page.module.css";

const ROLES = [
  "Super admin",
  "Admissions officer",
  "Finance officer",
  "Teacher",
  "Exam reviewer",
  "Timetable manager",
  "HR reviewer",
  "Auditor",
  "Content editor",
] as const;

type Role = (typeof ROLES)[number];

const STATUS_TONE: Record<UserStatus, "good" | "watch" | "alert"> = {
  Active: "good",
  Invited: "watch",
  Suspended: "alert",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InviteErrors = { name?: string; email?: string };

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("Teacher");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<InviteErrors>({});
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const seq = useRef(0);

  /* Accounts and role grants come from the users service; the graph-derived
     rows appear first, followed by the seeded fictional staff. */
  useEffect(() => {
    let cancelled = false;
    void usersService.listUsers().then((list) => {
      if (!cancelled) setRows(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function announce(text: string) {
    setAnnouncement((prev) => ({ key: (prev?.key ?? 0) + 1, text }));
  }

  function clearError(field: keyof InviteErrors) {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  function openInvite() {
    setInviteOpen(true);
    setErrors({});
  }

  function cancelInvite() {
    setInviteOpen(false);
    setName("");
    setEmail("");
    setErrors({});
  }

  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: InviteErrors = {
      name: name.trim() ? undefined : "Name is required.",
      email: email.trim() ? undefined : "Email is required.",
    };
    if (next.email === undefined && !EMAIL_RE.test(email.trim())) {
      next.email = "Enter a valid email address.";
    }
    setErrors(next);
    if (next.name !== undefined || next.email !== undefined) return;

    seq.current += 1;
    setRows((prev) =>
      prev
        ? [
            {
              key: `invite-${seq.current}`,
              name: name.trim(),
              role,
              email: email.trim().toLowerCase(),
              status: "Invited",
              lastActiveLabel: "—",
              twoFa: "—",
              source: "seeded",
            },
            ...prev,
          ]
        : prev,
    );
    setInviteOpen(false);
    setName("");
    setEmail("");
    announce("Invitation sent (demo).");
  }

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Users</p>
        <h1 className="workspace-title">Users</h1>
        <p className="workspace-intro">Staff accounts and roles.</p>
      </header>

      <p className={styles.legend}>
        Roles: super admin · admissions officer · finance officer · teacher · exam reviewer · timetable manager · HR
        reviewer · auditor · content editor
      </p>

      <section className="panel" aria-labelledby="users-list-heading">
        <div className={styles.panelHead}>
          <h2 id="users-list-heading" className={styles.panelTitle}>
            Staff accounts
          </h2>
          <span className="demo-badge">Demo data</span>
        </div>

        {announcement && (
          <p key={announcement.key} className={styles.liveNote} aria-live="polite">
            {announcement.text}
          </p>
        )}

        <div className={styles.inviteRow}>
          <Button variant="primary" onClick={openInvite}>
            Invite user
          </Button>
        </div>

        {inviteOpen && (
          <form className={styles.inviteForm} onSubmit={handleInvite} noValidate>
            <div className={styles.inviteFields}>
              <div className={`field ${errors.name ? "field--invalid" : ""}`}>
                <label htmlFor="invite-name">Name</label>
                <input
                  id="invite-name"
                  className="input"
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    clearError("name");
                  }}
                  placeholder="e.g. S. Ahmed"
                  aria-invalid={errors.name !== undefined}
                  aria-describedby={errors.name ? "invite-name-error" : undefined}
                />
                {errors.name && (
                  <p className="field-error" id="invite-name-error">
                    {errors.name}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="invite-role">Role</label>
                <select id="invite-role" className="select" value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  {ROLES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`field ${errors.email ? "field--invalid" : ""}`}>
                <label htmlFor="invite-email">Email</label>
                <input
                  id="invite-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clearError("email");
                  }}
                  placeholder="name@faizaam.example"
                  aria-invalid={errors.email !== undefined}
                  aria-describedby={errors.email ? "invite-email-error" : undefined}
                />
                {errors.email && (
                  <p className="field-error" id="invite-email-error">
                    {errors.email}
                  </p>
                )}
              </div>
            </div>
            <div className={styles.inviteActions}>
              <Button variant="primary" type="submit">
                Send invitation
              </Button>
              <Button variant="quiet" type="button" onClick={cancelInvite}>
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
          ) : (
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Staff accounts with role, status, last activity and 2FA</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last active</th>
                  <th scope="col">2FA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className={styles.name}>{row.name}</td>
                    <td className={styles.role}>{row.role}</td>
                    <td className={styles.email}>{row.email}</td>
                    <td>
                      <StatusBadge tone={STATUS_TONE[row.status]}>{row.status}</StatusBadge>
                    </td>
                    <td className={`num ${styles.lastActive}`}>{row.lastActiveLabel}</td>
                    <td className={styles.twoFa}>{row.twoFa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className={styles.note}>Privileged roles require MFA once authentication is live.</p>
      <p className="demo-note">
        <span className="demo-badge">Demo data</span> All people, roles and emails are fictional.
      </p>
    </div>
  );
}
