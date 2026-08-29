/**
 * Explicit fictional demo policy (plan L1.1).
 *
 * Some workflows are gated on school policy decisions that are still
 * pending (withdrawal rules, concession/refund approvals, reconciliation
 * ownership, scorecard rules, support assignment). This module gives the
 * LOCAL DEMO an explicit, session-backed, clearly fictional policy so every
 * feature can be exercised end-to-end without pretending these are approved
 * school rules.
 *
 * Contract:
 * - Values persist only in the browser session (deterministic, resettable).
 * - Every consumer labels the affected controls with the "Fictional demo
 *   policy" marker; the real settings service and the policy-pending
 *   sections stay untouched.
 * - The Supabase branches never read this module — server authorization
 *   remains authoritative.
 */

import { sessionGet, sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";

export type DemoPolicyKey =
  | "admission.withdrawal"
  | "finance.adjustments"
  | "finance.refunds"
  | "finance.reconciliation"
  | "careers.scorecards"
  | "support.assignment"
  | "delivery.failures";

export type DemoPolicy = Record<DemoPolicyKey, boolean>;

export const DEMO_POLICY_SESSION_KEY = sessionKey("demo-policy");

/** Export for tests that reset the demo policy deterministically. */
export const DEMO_POLICY_SESSION_KEY_EXPORT = DEMO_POLICY_SESSION_KEY;

export const DEMO_POLICY_META: ReadonlyArray<{ key: DemoPolicyKey; label: string; help: string }> = [
  {
    key: "admission.withdrawal",
    label: "Admission withdrawal allowed",
    help: "Applicants may withdraw a submitted application before a terminal decision (fictional demo rule).",
  },
  {
    key: "finance.adjustments",
    label: "Concessions and adjustments with maker/checker approval",
    help: "Finance officers request; finance approvers approve; posting appends a signed ledger entry.",
  },
  {
    key: "finance.refunds",
    label: "Refunds enabled (capped at the refundable amount)",
    help: "Refund requests are approved by the finance approver and posted through the local sandbox provider.",
  },
  {
    key: "finance.reconciliation",
    label: "Reconciliation runs recorded",
    help: "Each run appends a comparison record with resolvable exceptions.",
  },
  {
    key: "careers.scorecards",
    label: "Reviewer scorecards editable",
    help: "HR reviewers save versioned scores; approvers never edit them.",
  },
  {
    key: "support.assignment",
    label: "Support assignment enabled",
    help: "Support officers assign grievances and see assignment history.",
  },
  {
    key: "delivery.failures",
    label: "Simulate delivery failures",
    help: "When enabled, the local delivery emulator fails a share of events so retry states are testable.",
  },
];

const DEFAULTS: DemoPolicy = {
  "admission.withdrawal": true,
  "finance.adjustments": true,
  "finance.refunds": true,
  "finance.reconciliation": true,
  "careers.scorecards": true,
  "support.assignment": true,
  "delivery.failures": false,
};

function loadPolicy(): DemoPolicy {
  const stored = sessionGet<Partial<DemoPolicy>>(DEMO_POLICY_SESSION_KEY);
  return stored === null ? { ...DEFAULTS } : { ...DEFAULTS, ...stored };
}

function savePolicy(policy: DemoPolicy): void {
  sessionSet(DEMO_POLICY_SESSION_KEY, policy);
}

/** The current fictional demo policy (copy — callers cannot mutate the store). */
export function getDemoPolicy(): DemoPolicy {
  return { ...loadPolicy() };
}

/** Flip one fictional rule; returns the updated policy. Unknown keys throw. */
export function setDemoPolicy(key: DemoPolicyKey, value: boolean): DemoPolicy {
  if (!(key in DEFAULTS)) throw new Error(`Unknown demo policy key: ${key}`);
  const policy = loadPolicy();
  policy[key] = value;
  savePolicy(policy);
  return { ...policy };
}

/** Test/support hook: restore the fictional defaults. */
export function resetDemoPolicy(): void {
  sessionRemove(DEMO_POLICY_SESSION_KEY);
}
