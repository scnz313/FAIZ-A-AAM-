/**
 * Typed settings-service boundary for the staff settings page.
 *
 * The demo view exposes the active academic year (derived from the canonical
 * relationship graph), admission window, fee/result/notice policy flags,
 * working days and period counts, and an explicit list of sections that are
 * still policy-pending (unconfirmed school decisions — the UI labels them
 * clearly and never presents them as effective). Settings are versioned
 * configuration with effective dates once the backend exists; the demo
 * returns a single fictional effective view.
 */

import { demoAcademicYears } from "@/modules/relationships/demo";

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

export interface SettingsService {
  /** The current effective (fictional) settings view. */
  getSettings(): Promise<SettingsView>;
}

export const settingsService: SettingsService = {
  async getSettings() {
    /* Derive the year labels from the relationship graph so the settings
       page always agrees with the identity spine. */
    const graphYears = demoAcademicYears.map((year) => ({
      label: year.label,
      status: year.status,
    }));
    const current = graphYears.find((year) => year.status === "current");
    return {
      ...DEMO_VIEW,
      academicYears: graphYears,
      academicYear: {
        label: current?.label ?? DEMO_VIEW.academicYear.label,
        status: current?.status ?? "current",
      },
    };
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createSettingsService = (): SettingsService => settingsService;
