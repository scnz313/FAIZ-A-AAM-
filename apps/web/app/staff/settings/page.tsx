"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { formatKolkata } from "@/modules/iot/domain";
import { settingsService, type PolicyPendingKey, type SettingsView } from "@/modules/services/settings";
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
        Saved by {savedBy} · {formatKolkata(savedAtIso, { format: "day" })}
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
        <label htmlFor={id}>{children}</label>
        {help && (
          <p id={`${id}-help`} className={styles.toggleHelp}>
            {help}
          </p>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { summary } = useStaffContext();
  const canManage = canAnyRole(summary?.roles ?? [], "settings.manage");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [view, setView] = useState<SettingsView | null>(null);
  const [gradingScheme, setGradingScheme] = useState("Letter grades (A1–E2)");
  const [twoReviewers, setTwoReviewers] = useState(true);
  const [expiryDays, setExpiryDays] = useState(30);
  const [emailSender, setEmailSender] = useState("notices@faizaam.example");
  const [savedNote, setSavedNote] = useState<{ key: number; text: string } | null>(null);
  const [resetNote, setResetNote] = useState<{ key: number; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
  useEffect(() => {
    let cancelled = false;
    void settingsService.getSettings().then((next) => {
      if (cancelled) return;
      setView(next);
      setGradingScheme(next.resultsPolicy.gradingScheme);
      setTwoReviewers(next.resultsPolicy.publicationRequiresTwoReviewers);
      setExpiryDays(next.noticeDefaults.defaultExpiryDays);
      setEmailSender(next.noticeDefaults.emailSender);
    })
      .catch(() => {
        if (!cancelled) setSaveError("Could not load settings.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
            defaultExpiryDays: expiryDays,
            emailSender,
          },
        },
        actor,
      );
      setView(updated);
      setSavedNote((prev) => ({
        key: (prev?.key ?? 0) + 1,
        text: "Saved — changes are versioned and audited.",
      }));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setResetNote((prev) => ({ key: (prev?.key ?? 0) + 1, text: "Demo data reset (demo) — nothing was deleted." }));
  }

  if (view === null) {
    return (
      <div className={styles.page}>
        <header className={`workspace-header ${styles.header}`}>
          <p className="eyebrow">Staff · Settings</p>
          <h1 className="workspace-title">Settings</h1>
          <p className="workspace-intro">School configuration — changes are versioned and audited.</p>
        </header>
        <p className={styles.loading} role="status">
          Loading settings…
        </p>
      </div>
    );
  }

  const pending = (key: PolicyPendingKey) => view.policyPending.includes(key);

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Settings</p>
        <h1 className="workspace-title">Settings</h1>
        <p className="workspace-intro">School configuration — changes are versioned and audited.</p>
      </header>

      <form className={styles.sections} onSubmit={handleSave}>
        <Section title="Academic year" savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <div className={styles.controlRow}>
            <div className="field">
              <label htmlFor="setting-year">Active academic year</label>
              <select id="setting-year" className={`select ${styles.controlWidth}`} value={view.academicYear.label} disabled>
                {view.academicYears.map((year) => (
                  <option key={year.label} value={year.label}>
                    {year.label}
                  </option>
                ))}
              </select>
            </div>
            <StatusBadge tone="good">Active</StatusBadge>
          </div>
          <p className="field-help">The active year locks once results are published.{!supabaseMode ? " Disabled in the demo." : ""}</p>
        </Section>

        <Section title="Admission window" pending={pending("admission-window")} savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <div className={styles.datePair}>
            <div className="field">
              <label htmlFor="setting-window-from">Window from</label>
              <input id="setting-window-from" className="input" type="date" defaultValue={view.admissionWindow.fromIso} disabled />
            </div>
            <div className="field">
              <label htmlFor="setting-window-to">Window to</label>
              <input id="setting-window-to" className="input" type="date" defaultValue={view.admissionWindow.toIso} disabled />
            </div>
          </div>
          <p className="field-help">
            The admission window follows the confirmed academic calendar{!supabaseMode ? " — dates shown are fictional until then." : "."}
          </p>
        </Section>

        <Section title="Fee policy" pending={pending("fee-policy")} savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <ToggleRow id="setting-partial-payments" checked={view.feePolicy.partialPaymentsAllowed} onChange={() => {}} disabled>
            Partial payments allowed
          </ToggleRow>
          <ToggleRow id="setting-late-fee" checked={view.feePolicy.lateFeeEnabled} onChange={() => {}} disabled>
            Late fee enabled
          </ToggleRow>
          <ToggleRow id="setting-concessions" checked={view.feePolicy.concessionsRequireApproval} onChange={() => {}} disabled>
            Concessions require approval
          </ToggleRow>
          <p className="field-help">Fee policy edits require finance officer approval.</p>
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
              value={expiryDays}
              onChange={(event) => setExpiryDays(Number(event.target.value))}
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
              />
            </div>
          </div>
          <p className="field-help">
            Working days and period counts await the confirmed school calendar — shown as policy pending until then.
          </p>
        </Section>

        <Section title="Notifications" pending={pending("notifications")} savedBy={view.savedBy} savedAtIso={view.savedAtIso}>
          <div className="field">
            <label htmlFor="setting-sender">Email sender</label>
            <input
              id="setting-sender"
              className={`input ${styles.controlWidth}`}
              type="email"
              value={emailSender}
              onChange={(event) => setEmailSender(event.target.value)}
            />
          </div>
          <ToggleRow
            id="setting-sms"
            checked={view.noticeDefaults.smsEnabled}
            onChange={() => {}}
            disabled
            help="SMS provider not configured — the toggle stays disabled."
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
            and session-only — they never change approved school policy or the server authorization model.
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
        <p className={styles.savedBy}>Session-only — changes apply to this browser session and reset on reload.</p>
      </section>
      ) : null}

      {!supabaseMode ? (
      <section className={`panel ${styles.dangerZone}`} aria-labelledby="danger-heading">
        <h2 id="danger-heading" className={styles.sectionTitle}>
          Danger zone
        </h2>
        <div className={styles.sectionBody}>
          <p className={styles.dangerCopy}>
            Reset the demo dataset to its initial state. Nothing is deleted — this is a fictional demo.
          </p>
          <div>
            <Button variant="danger" onClick={handleReset} disabled={!canManage}>
              Reset demo data
            </Button>
          </div>
          {resetNote && (
            <p key={resetNote.key} className={styles.resetNote} aria-live="polite">
              {resetNote.text}
            </p>
          )}
        </div>
        <p className={styles.savedBy}>
          Saved by {view.savedBy} · {formatKolkata(view.savedAtIso, { format: "day" })}
        </p>
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
