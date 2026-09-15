/**
 * Typed settings-service boundary for the staff settings page.
 *
 * The demo view exposes the active academic year (derived from the canonical
 * relationship graph), admission window, fee/result/notice policy flags,
 * working days and period counts, and an explicit list of sections that are
 * still policy-pending (unconfirmed school decisions — the UI labels them
 * clearly and never presents them as effective). Settings are versioned
 * configuration with effective dates once the backend exists; the demo
 * persists editable fields to sessionStorage and records an audit event.
 */

import { demoNowIso } from "@/modules/demo/clock";
import { demoAcademicYears } from "@/modules/relationships/demo";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import { auditService } from "@/modules/services/audit";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

export type PolicyPendingKey =
  | "admission-window"
  | "fee-policy"
  | "results-policy"
  | "working-days"
  | "notifications";

export type SettingsView = {
  /** Current academic year label, e.g. "2026–27", plus every known year. */
  academicYear: { label: string; status: string };
  academicYears: ReadonlyArray<{ label: string; status: string }>;
  admissionWindow: { fromIso: string; toIso: string };
  feePolicy: {
    partialPaymentsAllowed: boolean;
    lateFeeEnabled: boolean;
    concessionsRequireApproval: boolean;
  };
  resultsPolicy: {
    gradingScheme: string;
    publicationRequiresTwoReviewers: boolean;
  };
  noticeDefaults: {
    defaultExpiryDays: number;
    emailSender: string;
    smsEnabled: boolean;
  };
  workingDays: {
    days: string[];
    periodsPerDay: number;
  };
  /** Sections whose values await a confirmed school decision. */
  policyPending: readonly PolicyPendingKey[];
  savedBy: string;
  savedAtIso: string;
};

/** Editable settings input — only non-policy-pending fields are editable. */
export type SettingsInput = {
  resultsPolicy: {
    gradingScheme: string;
    publicationRequiresTwoReviewers: boolean;
  };
  noticeDefaults: {
    defaultExpiryDays: number;
    emailSender: string;
  };
  /**
   * Optional effective instant for the new version. A future-dated version is
   * stored but stays inert: reads keep serving the current effective version
   * until the clock reaches this instant (upcoming-change pattern).
   */
  effectiveFromIso?: string;
};

/** Fictional policy-pending view — the school has not confirmed these values. */
const DEMO_VIEW: SettingsView = {
  academicYear: { label: "2026–27", status: "current" },
  academicYears: [
    { label: "2025–26", status: "historical" },
    { label: "2026–27", status: "current" },
  ],
  admissionWindow: { fromIso: "2026-02-01", toIso: "2026-04-30" },
  feePolicy: {
    partialPaymentsAllowed: true,
    lateFeeEnabled: true,
    concessionsRequireApproval: true,
  },
  resultsPolicy: {
    gradingScheme: "Letter grades (A1–E2)",
    publicationRequiresTwoReviewers: true,
  },
  noticeDefaults: {
    defaultExpiryDays: 30,
    emailSender: "notices@faizaam.example",
    smsEnabled: false,
  },
  workingDays: {
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    periodsPerDay: 8,
  },
  policyPending: ["admission-window", "fee-policy", "results-policy", "working-days", "notifications"],
  savedBy: "A. Lone",
  savedAtIso: "2026-07-28T06:30:00Z",
};

const SETTINGS_SESSION_KEY = sessionKey("settings-overrides");

/** Exported so tests can reset the settings overrides deterministically. */
export const SETTINGS_SESSION_KEY_EXPORT = SETTINGS_SESSION_KEY;

type SettingsOverrides = {
  resultsPolicy: {
    gradingScheme: string;
    publicationRequiresTwoReviewers: boolean;
  };
  noticeDefaults: {
    defaultExpiryDays: number;
    emailSender: string;
  };
  savedBy: string;
  savedAtIso: string;
};

/** One versioned settings change with its effective instant. */
type SettingsVersionRecord = SettingsOverrides & {
  version: number;
  effectiveFromIso: string;
};

/**
 * Versioned effective-dated history (stored under the same session key so
 * existing resets keep working). Legacy single-override sessions migrate as
 * version 1 effective at their saved instant.
 */
function loadHistory(): SettingsVersionRecord[] {
  const stored = sessionGet<SettingsVersionRecord[] | SettingsOverrides>(SETTINGS_SESSION_KEY);
  if (stored === null) return [];
  if (Array.isArray(stored)) return stored;
  const legacy = stored as SettingsOverrides;
  if (typeof legacy?.resultsPolicy !== "object" || legacy.resultsPolicy === null) return [];
  return [{ ...legacy, version: 1, effectiveFromIso: legacy.savedAtIso }];
}

function saveHistory(history: SettingsVersionRecord[]): void {
  sessionSet(SETTINGS_SESSION_KEY, history);
}

function loadOverrides(): SettingsOverrides | null {
  return effectiveRecord(demoNowIso());
}

/** Latest version whose effective instant has passed — upcoming changes stay inert. */
function effectiveRecord(atIso: string): SettingsVersionRecord | null {
  const candidates = loadHistory()
    .filter((record) => record.effectiveFromIso <= atIso)
    .sort((left, right) => left.version - right.version);
  return candidates[candidates.length - 1] ?? null;
}


function buildView(overrides: SettingsOverrides | null): SettingsView {
  const graphYears = demoAcademicYears.map((year) => ({
    label: year.label,
    status: year.status,
  }));
  const current = graphYears.find((year) => year.status === "current");
  const base: SettingsView = {
    ...DEMO_VIEW,
    academicYears: graphYears,
    academicYear: {
      label: current?.label ?? DEMO_VIEW.academicYear.label,
      status: current?.status ?? "current",
    },
  };
  if (overrides === null) return base;
  return {
    ...base,
    resultsPolicy: {
      ...base.resultsPolicy,
      gradingScheme: overrides.resultsPolicy.gradingScheme,
      publicationRequiresTwoReviewers: overrides.resultsPolicy.publicationRequiresTwoReviewers,
    },
    noticeDefaults: {
      ...base.noticeDefaults,
      defaultExpiryDays: overrides.noticeDefaults.defaultExpiryDays,
      emailSender: overrides.noticeDefaults.emailSender,
    },
    savedBy: overrides.savedBy,
    savedAtIso: overrides.savedAtIso,
  };
}

export type SettingsVersionState = {
  id: string;
  version: number;
  status: string;
  createdAtIso: string | null;
  /** Account that saved this version, for maker/checker display. */
  changedByAccountId: string | null;
};

export interface SettingsService {
  /** The current effective (fictional) settings view. */
  getSettings(): Promise<SettingsView>;
  /** The newest stored version (draft/effective), for the approval workflow. */
  getLatestVersion(): Promise<SettingsVersionState | null>;
  /** Approve a stored version and make it effective from the given instant. */
  approveVersion(input: { settingsId: string; expectedVersion: number; effectiveFrom?: string | null }): Promise<void>;
  /** Save editable settings — persists to the demo session and records audit. */
  saveSettings(input: SettingsInput, actor: string): Promise<SettingsView>;
}

const POLICY_KEYS: readonly PolicyPendingKey[] = ["admission-window", "fee-policy", "results-policy", "working-days", "notifications"];

/**
 * Map the authoritative (server) settings row into the staff view. Only a
 * row the server marks `effective` contributes values; scheduled/upcoming
 * rows stay fully policy-pending so upcoming changes are inert until their
 * effective instant. Exported for contract tests.
 */
export function mapAuthoritativeSettings(row: { version?: number; status?: string; policy?: Record<string, unknown> | null; changed_by_account_id?: string | null; changed_by_label?: string | null; created_at?: string | null; effective_from?: string | null } | null): SettingsView {
  /* Upcoming (non-effective) rows stay fully inert: their policy never reads
     as configured, no matter what the row carries. */
  const policy = row?.status === "effective" ? (row?.policy ?? {}) : {};
  const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const admission = record(policy.admissionWindow);
  const fees = record(policy.feePolicy);
  const results = { ...record(policy.results), ...record(policy.resultsPolicy) };
  const notices = { ...record(policy.notices), ...record(policy.noticeDefaults) };
  const hasOwn = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
  if (!hasOwn(results, "gradingScheme") && typeof policy.gradingScheme === "string") results.gradingScheme = policy.gradingScheme;
  if (!hasOwn(results, "publicationRequiresTwoReviewers") && typeof policy.publicationRequiresTwoReviewers === "boolean") results.publicationRequiresTwoReviewers = policy.publicationRequiresTwoReviewers;
  if (!hasOwn(notices, "defaultExpiryDays") && typeof policy.defaultExpiryDays === "number") notices.defaultExpiryDays = policy.defaultExpiryDays;
  if (!hasOwn(notices, "emailSender") && typeof policy.emailSender === "string") notices.emailSender = policy.emailSender;
  if (!hasOwn(notices, "smsEnabled") && typeof policy.smsEnabled === "boolean") notices.smsEnabled = policy.smsEnabled;
  const working = record(policy.workingDays ?? policy.working);
  const notification = record(policy.notifications);
  const years = Array.isArray(policy.academicYears)
    ? policy.academicYears.filter((item): item is { label: string; status: string } => typeof item === "object" && item !== null && typeof (item as { label?: unknown }).label === "string" && typeof (item as { status?: unknown }).status === "string")
    : [];
  const current = years.find((year) => year.status === "current") ?? years[0] ?? { label: "Not configured", status: "not_configured" };
  /* An empty string or the sentinel "Not configured" both mean the school has
     not confirmed a value, so the section stays visibly policy-pending. */
  const has = (value: unknown): boolean => value !== undefined && value !== null && value !== "" && value !== "Not configured";
  const pending = row?.status === "effective"
    ? POLICY_KEYS.filter((key) => !({
        "admission-window": has(admission.fromIso) && has(admission.toIso),
        "fee-policy": has(fees.partialPaymentsAllowed) || has(fees.lateFeeEnabled) || has(fees.concessionsRequireApproval),
        "results-policy": has(results.gradingScheme),
        "working-days": Array.isArray(working.days) && working.days.length > 0,
        notifications: has(notification.emailSender) || has(notification.smsEnabled),
      }[key]))
    : [...POLICY_KEYS];
  return {
    academicYear: current,
    academicYears: years,
    admissionWindow: { fromIso: typeof admission.fromIso === "string" ? admission.fromIso : "", toIso: typeof admission.toIso === "string" ? admission.toIso : "" },
    feePolicy: { partialPaymentsAllowed: fees.partialPaymentsAllowed === true, lateFeeEnabled: fees.lateFeeEnabled === true, concessionsRequireApproval: fees.concessionsRequireApproval === true },
    resultsPolicy: { gradingScheme: typeof results.gradingScheme === "string" ? results.gradingScheme : "Not configured", publicationRequiresTwoReviewers: results.publicationRequiresTwoReviewers === true },
    noticeDefaults: { defaultExpiryDays: typeof notices.defaultExpiryDays === "number" ? notices.defaultExpiryDays : 0, emailSender: typeof notices.emailSender === "string" ? notices.emailSender : "Not configured", smsEnabled: notices.smsEnabled === true },
    workingDays: { days: Array.isArray(working.days) ? working.days.filter((day): day is string => typeof day === "string") : [], periodsPerDay: typeof working.periodsPerDay === "number" ? working.periodsPerDay : 0 },
    policyPending: pending,
    /* Saved-by is always a person label, never a raw account UUID: the
       adapter resolves the acting account before this view is built. */
    savedBy: typeof row?.changed_by_label === "string" && row.changed_by_label.trim() !== "" ? row.changed_by_label : "Not configured",
    savedAtIso: row?.created_at ?? row?.effective_from ?? "",
  };
}

export const settingsService: SettingsService = {
  async getSettings() {
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<{ version: number; status: string; policy: Record<string, unknown>; changed_by_account_id?: string | null; created_at?: string }>("settings.read", {});
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Settings are unavailable.");
      return mapAuthoritativeSettings(response.value ?? null);
    }
    return buildView(loadOverrides());
  },

  async getLatestVersion() {
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<{ id?: string; version?: number; status?: string; created_at?: string; changed_by_account_id?: string | null } | null>("settings.readLatest", {});
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Settings are unavailable.");
      const row = response.value;
      if (!row || typeof row.id !== "string") return null;
      return {
        id: row.id,
        version: Number(row.version ?? 1),
        status: String(row.status ?? "draft"),
        createdAtIso: row.created_at ?? null,
        changedByAccountId: typeof row.changed_by_account_id === "string" ? row.changed_by_account_id : null,
      };
    }
    const history = loadHistory();
    const latest = history[history.length - 1];
    return latest ? { id: `demo-${latest.version}`, version: latest.version, status: "draft", createdAtIso: latest.savedAtIso, changedByAccountId: null } : null;
  },

  async approveVersion(input) {
    if (clientAdapterMode() !== "supabase") {
      throw new Error("Policy approval is available with the live database.");
    }
    const response = await adapterCall<unknown>("settings.approve", {
      settingsId: input.settingsId,
      expectedVersion: input.expectedVersion,
      effectiveFrom: input.effectiveFrom ?? null,
    });
    if (!response.ok) throw new Error(response.errors[0]?.message ?? "The settings version could not be approved.");
  },

  async saveSettings(input, actor) {
    if (clientAdapterMode() === "supabase") {
      const current = await adapterCall<{ version: number } | null>("settings.readLatest", {});
      if (!current.ok) throw new Error(current.errors[0]?.message ?? "Settings are unavailable.");
      if (current.value === null) throw new Error("No settings version is available for editing.");
      const response = await adapterCall<unknown>("settings.save", { expectedVersion: current.value.version, reason: "Updated through the staff settings page.", policy: { gradingScheme: input.resultsPolicy.gradingScheme, publicationRequiresTwoReviewers: input.resultsPolicy.publicationRequiresTwoReviewers, defaultExpiryDays: input.noticeDefaults.defaultExpiryDays, emailSender: input.noticeDefaults.emailSender } });
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Settings could not be saved.");
      return this.getSettings();
    }
    const nowIso = demoNowIso();
    const rawEffective = input.effectiveFromIso?.trim() || nowIso;
    if (!Number.isFinite(Date.parse(rawEffective))) {
      throw new Error("Choose a valid effective date for the settings change.");
    }
    const effectiveFromIso = new Date(rawEffective).toISOString();
    const upcoming = effectiveFromIso > nowIso;
    const overrides: SettingsOverrides = {
      resultsPolicy: {
        gradingScheme: input.resultsPolicy.gradingScheme,
        publicationRequiresTwoReviewers: input.resultsPolicy.publicationRequiresTwoReviewers,
      },
      noticeDefaults: {
        defaultExpiryDays: input.noticeDefaults.defaultExpiryDays,
        emailSender: input.noticeDefaults.emailSender,
      },
      savedBy: actor,
      savedAtIso: nowIso,
    };
    const history = loadHistory();
    const version = history.reduce((max, record) => Math.max(max, record.version), 0) + 1;
    saveHistory([...history, { ...overrides, version, effectiveFromIso }]);

    await auditService.record({
      actor,
      action: "Setting changed",
      target: `Settings saved — grading: ${input.resultsPolicy.gradingScheme}, expiry: ${input.noticeDefaults.defaultExpiryDays}d`,
      outcome: "Success",
      reason: upcoming
        ? `Settings version ${version} scheduled effective ${effectiveFromIso} through the staff settings page.`
        : "Settings updated through the staff settings page.",
    });

    /* A future-dated version stays inert: serve the current effective view. */
    return buildView(effectiveRecord(nowIso));
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createSettingsService = (): SettingsService => settingsService;
