/**
 * Typed notifications service boundary with a deterministic demo adapter.
 *
 * Each account reads its own notification list, and read state is stored per
 * account in the demo session store (`markRead`/`markAllRead` on one account
 * never changes another account's state). Timestamps are derived from the
 * injected demo clock (`demoNow`), never the wall clock, so lists are
 * deterministic within a session and across tests. The portal bell reads the
 * guardian account list; the staff bell reads the staff account list; the
 * backend phase replaces the fallback account ids with the session account.
 */

import { demoNow } from "@/modules/demo/clock";
import type { NotificationItem, NotificationKind } from "@/modules/notifications/demo";
import { DEMO_GUARDIAN_ACCOUNT_ID } from "@/modules/services/family-context";
import { DEMO_STAFF_ACCOUNT_ID } from "@/modules/services/staff-context";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

/** Demo guardian account used when a portal route is opened without a session. */
export { DEMO_GUARDIAN_ACCOUNT_ID };
/** Demo staff account used when a staff route is opened without a session. */
export { DEMO_STAFF_ACCOUNT_ID };

/** Session key holding per-account read state: `{ [accountId]: string[] }`. */
export const NOTIFICATIONS_SESSION_KEY = sessionKey("notifications");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Seed rows keep their fictional text; `offsetMs` ages them from demoNow. */
type NotificationSeed = {
  id: string;
  kind: NotificationKind;
  text: string;
  offsetMs: number;
  unread: boolean;
};

/** Family/student portal bell — fictional items for the linked demo child. */
const GUARDIAN_SEEDS: readonly NotificationSeed[] = [
  { id: "guardian-1", kind: "Fee", text: "Term 3 invoice issued — INV-2026-0103", offsetMs: 2 * HOUR, unread: true },
  { id: "guardian-2", kind: "Result", text: "Term 2 report card published", offsetMs: 1 * DAY, unread: true },
  { id: "guardian-3", kind: "Notice", text: "Mid-term date sheet released", offsetMs: 3 * DAY, unread: false },
  { id: "guardian-4", kind: "Alert", text: "Winter air-quality advisory", offsetMs: 5 * DAY, unread: false },
];

/** Staff workspace bell — fictional items for the operations team. */
const STAFF_SEEDS: readonly NotificationSeed[] = [
  { id: "staff-1", kind: "Admissions", text: "New application APP-2026-0422 submitted", offsetMs: 1 * HOUR, unread: true },
  { id: "staff-2", kind: "Finance", text: "Payment PAY-2026-0301 awaiting reconciliation", offsetMs: 3 * HOUR, unread: true },
  { id: "staff-3", kind: "Results", text: "Batch RB-2026-0142 approved for publishing", offsetMs: 1 * DAY, unread: false },
  { id: "staff-4", kind: "Environment", text: "2 open campus environment alerts", offsetMs: 2 * DAY, unread: false },
];

/** Accounts outside the two demo workspaces see an empty list (no leakage). */
function seedsForAccount(accountId: string): readonly NotificationSeed[] {
  if (accountId === DEMO_GUARDIAN_ACCOUNT_ID) return GUARDIAN_SEEDS;
  if (accountId === DEMO_STAFF_ACCOUNT_ID) return STAFF_SEEDS;
  return [];
}

function loadReadState(): Record<string, string[]> {
  return sessionGet<Record<string, string[]>>(NOTIFICATIONS_SESSION_KEY) ?? {};
}

function saveReadState(state: Record<string, string[]>): void {
  sessionSet(NOTIFICATIONS_SESSION_KEY, state);
}

/** Materialize seeds with deterministic timestamps and per-account read state. */
function materialize(seeds: readonly NotificationSeed[], readIds: readonly string[]): NotificationItem[] {
  const nowMs = demoNow().getTime();
  return seeds.map((seed) => ({
    id: seed.id,
    kind: seed.kind,
    text: seed.text,
    atIso: new Date(nowMs - seed.offsetMs).toISOString(),
    unread: seed.unread && !readIds.includes(seed.id),
  }));
}

export interface NotificationsService {
  /** The account's notification list with its read state applied. */
  listForAccount(accountId: string): Promise<NotificationItem[]>;
  /** Synchronous variant for module-level consumers (shell topbar props). */
  listForAccountSync(accountId: string): NotificationItem[];
  /** Mark one item read for the account; returns the refreshed list. */
  markRead(accountId: string, notificationId: string): Promise<NotificationItem[]>;
  /** Mark every item read for the account; returns the refreshed list. */
  markAllRead(accountId: string): Promise<NotificationItem[]>;
}

export const notificationsService: NotificationsService = {
  async listForAccount(accountId) {
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<Array<{ id: string; version?: number; kind: string; title: string; body: string | null; target_reference: string | null; read_at: string | null; created_at: string }>>("notifications.list", {});
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Notifications are unavailable.");
      return response.value.map((item) => ({ id: item.id, version: item.version ?? 1, kind: item.kind as NotificationKind, text: item.body ? `${item.title} — ${item.body}` : item.title, atIso: item.created_at, unread: item.read_at === null }));
    }
    return notificationsService.listForAccountSync(accountId);
  },

  listForAccountSync(accountId) {
    if (clientAdapterMode() === "supabase") throw new Error("Supabase notifications require the server-seeded account projection.");
    const readIds = loadReadState()[accountId] ?? [];
    return materialize(seedsForAccount(accountId), readIds);
  },

  async markRead(accountId, notificationId) {
    if (clientAdapterMode() === "supabase") {
      const current = await notificationsService.listForAccount(accountId);
      const version = current.find((item) => item.id === notificationId)?.version ?? 1;
      const response = await adapterCall("notifications.markRead", { notificationId, expectedVersion: version });
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Notification could not be marked read.");
      return notificationsService.listForAccount(accountId);
    }
    const state = loadReadState();
    const readIds = state[accountId] ?? [];
    if (!readIds.includes(notificationId)) {
      state[accountId] = [...readIds, notificationId];
      saveReadState(state);
    }
    return notificationsService.listForAccountSync(accountId);
  },

  async markAllRead(accountId) {
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<{ count: number }>("notifications.markAll", {});
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Notifications could not be marked read.");
      return notificationsService.listForAccount(accountId);
    }
    const state = loadReadState();
    state[accountId] = seedsForAccount(accountId).map((seed) => seed.id);
    saveReadState(state);
    return notificationsService.listForAccountSync(accountId);
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createNotificationsService = (): NotificationsService => notificationsService;
