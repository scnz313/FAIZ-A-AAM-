/**
 * Typed audit-service boundary for the staff audit page.
 *
 * The demo adapter lists safe seeded events — actor, action, target,
 * outcome, and reason only. No passwords, OTPs, provider secrets, document
 * contents, or unnecessary child/contact details ever appear. Events are
 * append-only by contract: `record` appends session events deterministically
 * (injected demo clock, session counter — never the wall clock or random),
 * and nothing is ever edited or removed.
 */

import { demoNowIso } from "@/modules/demo/clock";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

/**
 * Known action labels for editor assistance. The server command surface
 * records more kinds than any fixed list can track (for example
 * "MFA verified" or "Account suspended"), so the type accepts any recorded
 * string while keeping the common labels discoverable. Never treat this list
 * as the full register; the audit page derives its filter from loaded data.
 */
export const KNOWN_AUDIT_ACTIONS = [
  "Login",
  "Logout",
  "MFA verified",
  "Password changed",
  "Application reviewed",
  "Result published",
  "Payment reconciled",
  "Notice published",
  "Notice unpublished",
  "Notice edited",
  "Page status updated",
  "Timetable changed",
  "Setting changed",
  "Invoice viewed",
  "Result withdrawn",
  "Payment posted",
  "Link approved",
  "Link rejected",
  "Link revoked",
  "Link restricted",
  "Link restored",
  "Link capabilities changed",
  "Link requested",
  "Enrollment converted",
  "Staff invitation created",
  "Staff invitation accepted",
  "Staff invitation provider failed",
  "Account suspended",
  "Account reactivated",
  "Reviewer assigned",
  "Scorecard saved",
] as const;

export type AuditAction = (typeof KNOWN_AUDIT_ACTIONS)[number] | (string & {});

export type AuditOutcome = "Success" | "Denied" | "Failed";

export type AuditEvent = {
  id: string;
  timestampIso: string;
  actor: string;
  action: AuditAction;
  target: string;
  outcome: AuditOutcome;
  reason?: string;
};

export type ServerAuditEventRow = {
  reference: string;
  actor_label: string;
  action: string;
  target_reference: string;
  outcome: AuditOutcome;
  reason: string | null;
  created_at: string;
};

export function mapServerAuditEvent(event: ServerAuditEventRow): AuditEvent {
  return {
    id: event.reference,
    timestampIso: event.created_at,
    actor: event.actor_label,
    action: event.action as AuditAction,
    target: event.target_reference,
    outcome: event.outcome,
    reason: event.reason ?? undefined,
  };
}

/** Fictional audit trail — real events arrive with the backend. */
export const demoAuditEvents: readonly AuditEvent[] = [
  { id: "ev-01", timestampIso: "2026-08-03T02:42:00Z", actor: "A. Lone", action: "Login", target: "—", outcome: "Success" },
  {
    id: "ev-02",
    timestampIso: "2026-08-03T03:35:00Z",
    actor: "N. Lone",
    action: "Notice published",
    target: "/notices/winter-air-quality-advisory",
    outcome: "Success",
  },
  { id: "ev-03", timestampIso: "2026-08-03T02:15:00Z", actor: "Z. Mir", action: "Invoice viewed", target: "INV-2026-0417", outcome: "Success" },
  { id: "ev-04", timestampIso: "2026-08-02T15:00:00Z", actor: "A. Gani", action: "Timetable changed", target: "Class 9 · Monday", outcome: "Success" },
  {
    id: "ev-05",
    timestampIso: "2026-08-02T10:20:00Z",
    actor: "S. Bhat",
    action: "Result published",
    target: "Class 10 · Unit test 1",
    outcome: "Success",
  },
  {
    id: "ev-06",
    timestampIso: "2026-08-02T08:05:00Z",
    actor: "Z. Mir",
    action: "Notice published",
    target: "/notices/mid-term-exam-schedule",
    outcome: "Denied",
    reason: "Auditor attempted to publish a notice — denied by role policy.",
  },
  { id: "ev-07", timestampIso: "2026-08-02T05:00:00Z", actor: "A. Lone", action: "Payment reconciled", target: "INV-2026-0389", outcome: "Success" },
  { id: "ev-08", timestampIso: "2026-08-02T03:45:00Z", actor: "R. Wani", action: "Application reviewed", target: "APP-2026-0113", outcome: "Success" },
  {
    id: "ev-09",
    timestampIso: "2026-08-01T13:40:00Z",
    actor: "N. Lone",
    action: "Setting changed",
    target: "Notice defaults · expiry 30 days",
    outcome: "Success",
  },
  {
    id: "ev-10",
    timestampIso: "2026-08-01T09:12:00Z",
    actor: "F. Ahmad",
    action: "Login",
    target: "—",
    outcome: "Failed",
    reason: "Login failed — incorrect password. Three attempts recorded.",
  },
  {
    id: "ev-11",
    timestampIso: "2026-08-01T04:30:00Z",
    actor: "S. Bhat",
    action: "Result published",
    target: "Class 9 · Unit test 2",
    outcome: "Success",
  },
  { id: "ev-12", timestampIso: "2026-07-31T07:25:00Z", actor: "A. Lone", action: "Setting changed", target: "Academic year · 2026-27", outcome: "Success" },
  {
    id: "ev-13",
    timestampIso: "2026-07-30T06:05:00Z",
    actor: "M. Wani",
    action: "Application reviewed",
    target: "APP-2026-0112",
    outcome: "Denied",
    reason: "Non-HR staff attempted to review an HR application — denied by role policy.",
  },
  {
    id: "ev-14",
    timestampIso: "2026-07-24T04:10:00Z",
    actor: "System",
    action: "Payment reconciled",
    target: "Gateway event · #88102",
    outcome: "Failed",
    reason: "Reconciliation job failed — gateway timeout; queued for retry.",
  },
];

export interface AuditService {
  /** All safe audit events — seeded history plus session-recorded, newest first. */
  listEvents(): Promise<AuditEvent[]>;
  /**
   * One page of the live audit register, newest first. `cursor` is the
   * `created_at` of the oldest already-loaded event, so successive calls walk
   * backwards through history. Rejects when the register is unavailable.
   */
  listEventsPage(input?: { limit?: number; cursor?: string | null }): Promise<{ events: AuditEvent[]; nextCursor: string | null }>;
  /**
   * Append one safe event (plan.md Phase 4). Append-only: recorded events
   * are never edited or removed. Deterministic id and timestamp; the same
   * call twice creates two events (idempotency belongs to the action that
   * triggers the record, which must call this exactly once per effect).
   */
  record(event: Omit<AuditEvent, "id" | "timestampIso">): Promise<AuditEvent>;
}

const AUDIT_SESSION_KEY = sessionKey("audit-events");

function loadSessionEvents(): AuditEvent[] {
  return sessionGet<AuditEvent[]>(AUDIT_SESSION_KEY) ?? [];
}

function saveSessionEvents(events: AuditEvent[]): void {
  sessionSet(AUDIT_SESSION_KEY, events);
}

/** Exported so tests can reset the audit trail deterministically. */
export const AUDIT_SESSION_KEY_EXPORT = AUDIT_SESSION_KEY;

export const auditService: AuditService = {
  async listEvents() {
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<ServerAuditEventRow[]>("audit.list", { limit: 100 });
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Audit events are unavailable.");
      return response.value.map(mapServerAuditEvent);
    }
    const sessionEvents = loadSessionEvents();
    return [...sessionEvents, ...demoAuditEvents]
      .sort((a, b) => b.timestampIso.localeCompare(a.timestampIso))
      .map((event) => ({ ...event }));
  },

  async listEventsPage(input = {}) {
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100);
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<ServerAuditEventRow[]>("audit.listPage", {
        limit,
        cursor: input.cursor ?? null,
      });
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Audit events are unavailable.");
      const events = response.value.map(mapServerAuditEvent);
      const last = events[events.length - 1];
      return { events, nextCursor: events.length === limit && last !== undefined ? last.timestampIso : null };
    }
    const all = await this.listEvents();
    const remaining = input.cursor === null || input.cursor === undefined
      ? all
      : all.filter((event) => event.timestampIso < input.cursor!);
    const events = remaining.slice(0, limit);
    const last = events[events.length - 1];
    return { events, nextCursor: remaining.length > events.length && last !== undefined ? last.timestampIso : null };
  },

  async record(event) {
    if (clientAdapterMode() === "supabase") {
      throw new Error("Browser code cannot append audit records; the server command must record this action.");
    }
    const events = loadSessionEvents();
    const nextCounter = events.length + 1 + demoAuditEvents.length;
    const next: AuditEvent = {
      ...event,
      id: `AUD-2026-${String(nextCounter).padStart(3, "0")}`,
      timestampIso: demoNowIso(),
    };
    saveSessionEvents([...events, next]);
    return { ...next };
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createAuditService = (): AuditService => auditService;
