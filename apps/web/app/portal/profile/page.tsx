"use client";

import Link from "next/link";

import type { FamilyCapability } from "@fass/contracts";
import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatKolkata } from "@/modules/iot/domain";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { gradeSectionLabel } from "@/modules/services/family-context";

import styles from "./page.module.css";

const PORTAL_MODULES: ReadonlyArray<{ value: FamilyCapability; label: string }> = [
  { value: "academics", label: "Academics and results" },
  { value: "finance", label: "Fees and payments" },
  { value: "documents", label: "Documents" },
  { value: "notices", label: "Notices" },
  { value: "profile", label: "Profile and linked children" },
];

/**
 * Profile — V14 aligned. PageHead + auto-fit grid of panels: Guardian,
 * Linked children, and Children & enrolment references. Preserves the
 * family context, guardian identity, and student records.
 */
export default function ProfilePage() {
  const { status, activeStudent, students, guardianName, context, errorMessage, retry } = useFamilyContext();
  const child = activeStudent;
  const supabaseMode = clientAdapterMode() === "supabase";
  const initials = (guardianName ?? "—")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className={styles.page}>
      {/* V14 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Profile</h1>
          <p className="ph-sub">Your guardian identity, linked children and recovery options.</p>
          <ActiveChildLine />
        </div>
      </div>

      {/* V14 auto-fit grid of panels */}
      {status === "error" ? (
        <ErrorPanel
          title="Your profile could not be loaded"
          note={errorMessage ?? "The family context did not respond. No record was changed."}
        >
          <Button variant="quiet" type="button" onClick={retry}>
            Try again
          </Button>
        </ErrorPanel>
      ) : (
      <div className={styles.grid}>
        {/* Guardian panel */}
        <section className="panel">
          <div className="pn-head"><h2>Guardian</h2></div>
          <div className="pn-body" style={{ paddingTop: 12 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span className={styles.avatar} aria-hidden="true">{initials || "—"}</span>
              <div>
                <div className="strong">{status === "ready" ? (guardianName ?? "—") : "Loading…"}</div>
                <div className="small muted">
                  {supabaseMode ? "Guardian account" : "Guardian portal · demo session"}
                </div>
              </div>
            </div>
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>Workspace</dt>
              <dd>{supabaseMode ? "Guardian account" : "Demo session"}</dd>
              <dt>Recovery</dt>
              <dd>Email link to the address on file</dd>
              <dt>Account since</dt>
              <dd>{supabaseMode ? "On file" : "Demo"}</dd>
            </dl>
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <Link prefetch={false} className="btn btn-ghost btn-sm" href="/portal/support">
                <span className="msym" style={{ fontSize: 16 }}>support_agent</span> Support
              </Link>
              <Link prefetch={false} className="btn btn-ghost btn-sm" href="/portal/security">
                <span className="msym" style={{ fontSize: 16 }}>lock</span> Security
              </Link>
            </div>
          </div>
        </section>

        {/* Linked children panel */}
        <section className="panel">
          <div className="pn-head">
            <h2>Linked children</h2>
            <span className="tiny muted">Access is per child, per year, and can be revoked by the school.</span>
          </div>
          <div className="pn-body" style={{ paddingTop: 12 }}>
            {status === "loading" ? (
              <p className="small muted" role="status" aria-live="polite">Loading linked children…</p>
            ) : students.length === 0 ? (
              <p className="small muted">No linked children yet.</p>
            ) : (
              students.map((item) => {
                const childInitial = item.student.displayName
                  .split(" ")
                  .map((part) => part[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();
                return (
                  <div key={item.student.id} className={styles.childRow}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                      <span className={styles.childAvatar} aria-hidden="true">{childInitial}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="strong small">{item.student.displayName}</div>
                        <div className="tiny muted num">
                          {gradeSectionLabel(item.gradeSection)} · {item.student.ref}
                        </div>
                      </div>
                    </div>
                    <StatusBadge tone={item.student.id === child?.student.id ? "good" : "neutral"}>
                      {item.student.id === child?.student.id ? "Active" : "Linked"}
                    </StatusBadge>
                  </div>
                );
              })
            )}
            <div style={{ marginTop: 16 }}>
              <Link prefetch={false} className="btn btn-primary btn-sm" href="/portal/link-child">
                <span className="msym" style={{ fontSize: 16 }}>add_link</span> Link another child
              </Link>
            </div>
          </div>
        </section>

        {/* Children & enrolment references panel */}
        <section className="panel">
          <div className="pn-head"><h2>Children &amp; enrolment references</h2></div>
          <div className="pn-body" style={{ paddingTop: 12 }}>
            {status === "loading" || child === null ? (
              <p className="small muted" role="status" aria-live="polite">Loading…</p>
            ) : (
              <dl className="kv">
                <dt>{child.student.displayName} · enrolment</dt>
                <dd className="num">{child.enrollment.ref}</dd>
                <dt>{child.student.displayName} · class</dt>
                <dd>{gradeSectionLabel(child.gradeSection)} · {child.academicYear.label}</dd>
                <dt>Enrolment status</dt>
                <dd style={{ textTransform: "capitalize" }}>{child.enrollment.status}</dd>
                <dt>Enrolled from</dt>
                <dd className="num">
                  {formatKolkata(child.enrollment.effectiveFromIso, { format: "day" })}
                  {child.enrollment.effectiveToIso !== null
                    ? ` · to ${formatKolkata(child.enrollment.effectiveToIso, { format: "day" })}`
                    : ""}
                </dd>
                <dt>Student reference</dt>
                <dd className="num">{child.student.ref}</dd>
              </dl>
            )}
          </div>
        </section>

        {/* Portal modules panel — what the school shares for the active child */}
        <section className="panel">
          <div className="pn-head"><h2>Portal modules</h2></div>
          <div className="pn-body" style={{ paddingTop: 12 }}>
            {status === "loading" || child === null ? (
              <p className="small muted" role="status" aria-live="polite">Loading…</p>
            ) : (
              <>
                <div className="facts-ledger" aria-label="Portal module access for the active child">
                  {PORTAL_MODULES.map((module) => {
                    const allowed = context?.allowedCapabilities.includes(module.value) ?? false;
                    return (
                      <div className="fl-row" key={module.value}>
                        <span className="k">{module.label}</span>
                        <span className="v">{allowed ? "Sharing enabled" : "Not enabled"}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="small muted" style={{ marginTop: 10 }}>
                  Set by the school office per linked child. Ask the office if something you expect is missing.
                </p>
              </>
            )}
          </div>
        </section>
      </div>
      )}

      {!supabaseMode ? (
        <p className={styles.demoNote}>
          <span className="demo-badge">Demo data</span>
          <span>Fictional family details · real guardian and student records appear once accounts are linked.</span>
        </p>
      ) : null}
    </div>
  );
}
