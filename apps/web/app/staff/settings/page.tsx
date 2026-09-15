"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import Button from "@/components/ui/Button";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { formatKolkata } from "@/modules/iot/domain";
import { settingsService, type PolicyPendingKey, type SettingsVersionState, type SettingsView } from "@/modules/services/settings";
import {
  DEMO_POLICY_META,
  getDemoPolicy,
  resetDemoPolicy,
  setDemoPolicy,
  type DemoPolicy,
  type DemoPolicyKey,
} from "@/modules/services/demo-policy";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./page.module.css";

function Section({
  title,
  pending = false,
  savedBy,
  savedAtIso,
  children,
}: {
  title: string;
  pending?: boolean;
  savedBy: string;
  savedAtIso: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {pending ? <StatusBadge tone="watch">Policy pending</StatusBadge> : null}
      </div>
      <div className={styles.sectionBody}>{children}</div>
      <p className={styles.savedBy}>
        {savedAtIso.trim() === "" ? "No saved version yet." : `Saved by ${savedBy} · ${formatKolkata(savedAtIso, { format: "day" })}`}
      </p>
    </section>
  );
}

type ToggleRowProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  help?: string;
  children: ReactNode;
};

function ToggleRow({ id, checked, onChange, disabled = false, help, children }: ToggleRowProps) {
  return (
    <div className={styles.toggleRow}>
      <input
        id={id}
        className={styles.toggle}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={help ? `${id}-help` : undefined}
      />
      <div className={styles.toggleCopy}>
        <label htmlFor={id}>
          {disabled ? (
            <span className="msym" aria-hidden="true" style={{ fontSize: 16, verticalAlign: -3 }}>lock</span>
          ) : null}
          {disabled ? " " : null}
          {children}
        </label>
        {help && (
          <p id={`${id}-help`} className={styles.toggleHelp}>
            {help}
          </p>
        )}
      </div>
    </div>
  );
}

function LockNote({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className={styles.lockNote} id={id}>
      <span className="msym" aria-hidden="true">lock</span>
      <span>{children}</span>
    </p>
  );
}

/** Current school time as a datetime-local value (Asia/Kolkata). */
function defaultEffectiveLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default function SettingsPage() {
  const { summary } = useStaffContext();
  const canManage = canAnyRole(summary?.roles ?? [], "settings.manage");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [view, setView] = useState<SettingsView | null>(null);
  const [gradingScheme, setGradingScheme] = useState("Letter grades (A1–E2)");
  const [twoReviewers, setTwoReviewers] = useState(true);
  const [expiryDays, setExpiryDays] = useState("");
  const [emailSender, setEmailSender] = useState("notices@faizaam.example");
  const [savedNote, setSavedNote] = useState<{ key: number; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [latestVersion, setLatestVersion] = useState<SettingsVersionState | null>(null);
  const [approveEffectiveFrom, setApproveEffectiveFrom] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [demoPolicy, setDemoPolicyState] = useState<DemoPolicy>(() => getDemoPolicy());

  function updateDemoPolicy(key: DemoPolicyKey, value: boolean) {
    setDemoPolicyState(setDemoPolicy(key, value));
  }

  function resetDemoRules() {
    resetDemoPolicy();
    setDemoPolicyState(getDemoPolicy());
  }

  /* The form is seeded from the settings service view; policy-pending
     sections stay visibly flagged until the school confirms them. */
  const loadSettings = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      const next = await settingsService.getSettings();
      setView(next);
      setGradingScheme(next.resultsPolicy.gradingScheme);
      setTwoReviewers(next.resultsPolicy.publicationRequiresTwoReviewers);
      /* Unconfigured policy is an empty field, never the sentinel string or
         zero: the number input's min and the email input would otherwise make
         the whole form permanently invalid and the Save button inert. */
      setExpiryDays(next.noticeDefaults.defaultExpiryDays > 0 ? String(next.noticeDefaults.defaultExpiryDays) : "");
      setEmailSender(next.noticeDefaults.emailSender === "Not configured" ? "" : next.noticeDefaults.emailSender);
      const latest = await settingsService.getLatestVersion();
      setLatestVersion(latest);
      if (latest !== null && latest.status !== "effective") setApproveEffectiveFrom(defaultEffectiveLocal());
    } catch {
      setLoadFailed(true);
    }
  }, []);

  async function handleApproveVersion() {
    if (latestVersion === null) return;
    setApproving(true);
    setApproveError(null);
    try {
      /* The datetime-local value is school wall time (Asia/Kolkata, fixed
         +05:30); parsing it with `new Date` would use the workstation zone. */
      const effectiveFrom = approveEffectiveFrom.trim() === "" ? null : new Date(`${approveEffectiveFrom}:00+05:30`).toISOString();
      await settingsService.approveVersion({ settingsId: latestVersion.id, expectedVersion: latestVersion.version, effectiveFrom });
      await loadSettings();
      setSavedNote((prev) => ({ key: (prev?.key ?? 0) + 1, text: `Policy version ${latestVersion.version} approved and effective.` }));
    } catch (error) {
      setApproveError(error instanceof Error ? error.message : "The policy version could not be approved.");
    } finally {
      setApproving(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const actor = summary?.displayName ?? "System administrator";
      const updated = await settingsService.saveSettings(
        {
          resultsPolicy: {
            gradingScheme,
            publicationRequiresTwoReviewers: twoReviewers,
          },
          noticeDefaults: {
            defaultExpiryDays: expiryDays.trim() === "" ? 0 : Number(expiryDays),
            emailSender,
          },
        },
        actor,
      );
      setView(updated);
      /* The save stores a new draft version while the effective version stays
         unchanged, so reload the version state too: otherwise the policy
         panel would keep showing the old effective version and hide the
         approval step the new draft requires. */
      await loadSettings();
      setSavedNote((prev) => ({
        key: (prev?.key ?? 0) + 1,
        text: "Saved · changes are versioned and audited.",
      }));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (view === null) {
    return (
      <div className={styles.page}>
        <div className="page-head">
          <div>
            <h1 className={styles.title}>Settings</h1>
            <p className="ph-sub">School configuration · changes are versioned and audited.</p>
          </div>
        </div>
        {loadFailed ? (
          <ErrorPanel title="Settings could not be loaded" note="The configuration service did not respond. Live policy was not changed.">
            <Button variant="quiet" type="button" onClick={() => void loadSettings()}>
              Try again
            </Button>
          </ErrorPanel>
        ) : (
          <p className={styles.loading} role="status">
            Loading settings…
          </p>
        )}
      </div>
    );
  }

  const pending = (key: PolicyPendingKey) => view.policyPending.includes(key);
  /* Maker/checker: the server refuses self-approval, so the control must not
     promise an action the current account cannot take. */
  const savedByMe =
    latestVersion !== null &&
    latestVersion.changedByAccountId !== null &&
    latestVersion.changedByAccountId === summary?.accountId;

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Settings</h1>
          <p className="ph-sub">School configuration · changes are versioned and audited.</p>
        </div>
      </div>

      {latestVersion !== null ? (
        <section className="panel" aria-labelledby="policy-version-heading">
          <div className="pn-head">
            <h2 id="policy-version-heading" className="section-label">Policy version</h2>
            <StatusBadge tone={latestVersion.status === "effective" ? "good" : "watch"}>
              {latestVersion.status === "effective" ? "Effective" : latestVersion.status}
            </StatusBadge>
          </div>
          <div className="pn-body">
            {latestVersion.status === "effective" ? (
              <p className="small muted">
                Version {latestVersion.version} is effective. Saving another change stores a new version until it is approved.
              </p>
            ) : (
              <>
                <p className="small muted">
                  Version {latestVersion.version} is stored but not effective. Admission submission and the other policy gates stay closed
                  until an administrator approves it.
                </p>
                {savedByMe ? (
                  <p className="small muted" role="status">
                    You saved this version · maker/checker discipline requires a different administrator to approve it.
                  </p>
                ) : null}
                <div className="field">
                  <label htmlFor="settings-approve-effective">Effective from</label>
                  <input
                    id="settings-approve-effective"
                    className={`input ${styles.controlWidth}`}
                    type="datetime-local"
                    value={approveEffectiveFrom}
                    onChange={(event) => setApproveEffectiveFrom(event.target.value)}
                    disabled={!canManage || approving || savedByMe}
                  />
                </div>
                <div className={styles.saveRow}>
                  <Button variant="primary" type="button" onClick={() => void handleApproveVersion()} disabled={!canManage || approving || savedByMe}>
                    {approving ? "Approving…" : savedByMe ? "Independent approval required" : `Approve version ${latestVersion.version}`}
                  </Button>
                </div>
              </>
            )}
            {approveError ? (
              <p className="field-error" role="alert">{approveError}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <form className={styles.sections} onSubmit={handleSave} onInvalid={() => setSaveError("Check the highlighted settings fields before saving.")}>
        <Section title="Academic year" savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <div className={styles.controlRow}>
            <div className="field">
              <label htmlFor="setting-year">Active academic year</label>
              <select id="setting-year" className={`select ${styles.controlWidth}`} value={view.academicYear.label} disabled aria-describedby="setting-year-lock">
                {view.academicYears.map((year) => (
                  <option key={year.label} value={year.label}>
                    {year.label}
                  </option>
                ))}
              </select>
            </div>
            <StatusBadge tone="good">Active</StatusBadge>
          </div>
          <LockNote id="setting-year-lock">
            Policy-locked · the active year is managed by the academic calendar and locks once results are published.
            {!supabaseMode ? " Disabled in the demo." : ""}
          </LockNote>
        </Section>

        <Section title="Admission window" pending={pending("admission-window")} savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <div className={styles.datePair}>
            <div className="field">
              <label htmlFor="setting-window-from">Window from</label>
              <input id="setting-window-from" className="input" type="date" defaultValue={view.admissionWindow.fromIso} disabled aria-describedby="setting-window-lock" />
            </div>
            <div className="field">
              <label htmlFor="setting-window-to">Window to</label>
              <input id="setting-window-to" className="input" type="date" defaultValue={view.admissionWindow.toIso} disabled aria-describedby="setting-window-lock" />
            </div>
          </div>
          <LockNote id="setting-window-lock">
            Policy-locked · the admission window follows the confirmed academic calendar and takes effect next session.
            {!supabaseMode ? " Dates shown are fictional demo defaults." : ""}
          </LockNote>
        </Section>

        <Section title="Fee policy" pending={pending("fee-policy")} savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <ToggleRow id="setting-partial-payments" checked={view.feePolicy.partialPaymentsAllowed} onChange={() => {}} disabled help="Policy-locked · requires finance officer approval; takes effect next session.">
            Partial payments allowed
          </ToggleRow>
          <ToggleRow id="setting-late-fee" checked={view.feePolicy.lateFeeEnabled} onChange={() => {}} disabled help="Policy-locked · requires finance officer approval; takes effect next session.">
            Late fee enabled
          </ToggleRow>
          <ToggleRow id="setting-concessions" checked={view.feePolicy.concessionsRequireApproval} onChange={() => {}} disabled help="Policy-locked · requires finance officer approval; takes effect next session.">
            Concessions require approval
          </ToggleRow>
          <LockNote id="setting-fee-lock">Policy-locked · fee policy edits require finance officer approval.</LockNote>
        </Section>

        <Section title="Results policy" pending={pending("results-policy")} savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <div className="field">
            <label htmlFor="setting-grading">Grading scheme</label>
            <select
              id="setting-grading"
              className={`select ${styles.controlWidth}`}
              value={gradingScheme}
              onChange={(event) => setGradingScheme(event.target.value)}
            >
              {gradingScheme === "Not configured" ? (
                <option value="Not configured" disabled>
                  Not configured · select a scheme
                </option>
              ) : null}
              <option>Letter grades (A1–E2)</option>
              <option>Percentage with grades</option>
              <option>Pass/fail with remarks</option>
            </select>
          </div>
          <ToggleRow
            id="setting-two-reviewers"
            checked={twoReviewers}
            onChange={setTwoReviewers}
            help="Result publication is recorded in the audit trail."
          >
            Publication requires two reviewers
          </ToggleRow>
        </Section>

        <Section title="Notice defaults" savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <div className="field">
            <label htmlFor="setting-expiry">Default expiry (days)</label>
            <input
              id="setting-expiry"
              className={`input num ${styles.controlWidth}`}
              type="number"
              min={1}
              max={365}
              placeholder="Not configured"
              value={expiryDays}
              onChange={(event) => setExpiryDays(event.target.value)}
            />
          </div>
          <p className="field-help">New notices expire this many days after publish unless overridden.</p>
        </Section>

        <Section
          title="Working days & periods"
          pending={pending("working-days")}
          savedBy={view.savedBy}
          savedAtIso={view.savedAtIso}
        >
          <div className={styles.controlRow}>
            <div className="field">
              <label htmlFor="setting-working-days">Working days</label>
              <input
                id="setting-working-days"
                className={`input ${styles.controlWidth}`}
                type="text"
                value={view.workingDays.days.join(", ")}
                readOnly
                disabled
                aria-describedby="setting-working-lock"
              />
            </div>
            <div className="field">
              <label htmlFor="setting-periods">Periods per day</label>
              <input
                id="setting-periods"
                className={`input num ${styles.controlWidth}`}
                type="number"
                value={view.workingDays.periodsPerDay}
                readOnly
                disabled
                aria-describedby="setting-working-lock"
              />
            </div>
          </div>
          <LockNote id="setting-working-lock">
            Policy-locked · working days and period counts await the confirmed school calendar and take effect next session.
          </LockNote>
        </Section>

        <Section title="Notifications" pending={pending("notifications")} savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <div className="field">
            <label htmlFor="setting-sender">Email sender</label>
            <input
              id="setting-sender"
              className={`input ${styles.controlWidth}`}
              type="email"
              placeholder="Not configured"
              value={emailSender}
              onChange={(event) => setEmailSender(event.target.value)}
            />
          </div>
          <ToggleRow
            id="setting-sms"
            checked={view.noticeDefaults.smsEnabled}
            onChange={() => {}}
            disabled
            help="Policy-locked · SMS provider not configured; the toggle stays disabled until the provider is approved."
          >
            SMS enabled
          </ToggleRow>
        </Section>

        <div className={styles.saveRow}>
          <Button variant="primary" type="submit" disabled={saving || !canManage}>
            {saving ? "Saving…" : canManage ? "Save changes" : "Read only"}
          </Button>
          {saveError && (
            <p className={styles.savedNote} role="alert" style={{ color: "var(--alert-ink, #8b1a1a)" }}>
              {saveError}
            </p>
          )}
          {savedNote && (
            <p key={savedNote.key} className={styles.savedNote} aria-live="polite">
              {savedNote.text}
            </p>
          )}
        </div>
      </form>

      {!supabaseMode ? (
      <section className={`panel ${styles.dangerZone}`} aria-labelledby="demo-policy-heading">
        <div className={styles.sectionHead}>
          <h2 id="demo-policy-heading" className={styles.sectionTitle}>
            Demo simulation rules
          </h2>
          <StatusBadge tone="watch">Fictional demo policy</StatusBadge>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.dangerCopy}>
            These rules let every workflow run locally while a school decision is still pending. They are fictional
            and session-only · they never change approved school policy or the server authorization model.
          </p>
          {DEMO_POLICY_META.map((meta) => (
            <ToggleRow
              key={meta.key}
              id={`demo-policy-${meta.key}`}
              checked={demoPolicy[meta.key]}
              onChange={(checked) => updateDemoPolicy(meta.key, checked)}
              disabled={!canManage}
              help={meta.help}
            >
              {meta.label}
            </ToggleRow>
          ))}
          <div className={styles.demoPolicyActions}>
            <Button variant="quiet" onClick={resetDemoRules} disabled={!canManage}>
              Restore demo defaults
            </Button>
          </div>
        </div>
        <p className={styles.savedBy}>Session-only · changes apply to this browser session and reset on reload.</p>
      </section>
      ) : null}

      <p className={styles.note}>Configuration cannot rewrite issued or published history.</p>
      {!supabaseMode ? (
        <p className="demo-note">
          <span className="demo-badge">Demo data</span> All settings shown are fictional defaults for design and testing.
        </p>
      ) : null}
    </div>
  );
}
