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

/** Session key holding per-account cleared ids: `{ [accountId]: string[] }`. */
export const NOTIFICATIONS_DISMISSED_SESSION_KEY = sessionKey("notifications.dismissed");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type ServerNotificationRow = {
  id: string;
  version?: number;
  kind: string;
  title: string;
  body: string | null;
  target_type?: string | null;
  target_reference?: string | null;
  read_at: string | null;
  created_at: string;
};

const NOTIFICATION_KINDS = new Set<NotificationKind>(["Fee", "Result", "Notice", "Alert", "Admissions", "Finance", "Results", "Timetable", "Careers", "Support", "Security", "Enrollment", "Environment", "Update"]);

/** Default page size requested from the paginated server list. */
export const NOTIFICATIONS_PAGE_SIZE = 25;

export function notificationKind(row: Pick<ServerNotificationRow, "kind" | "target_type">): NotificationKind {
  if (NOTIFICATION_KINDS.has(row.kind as NotificationKind)) return row.kind as NotificationKind;
  const target = row.target_type ?? "";
  if (target.includes("admission")) return "Admissions";
  if (target.includes("job")) return "Careers";
  if (target.includes("invoice") || target.includes("receipt") || target.includes("refund") || target.includes("payment")) return "Finance";
  if (target.includes("result")) return "Results";
  if (target.includes("timetable") || target.includes("exam_schedule")) return "Timetable";
  if (target.includes("notice") || target.includes("content")) return "Notice";
  if (target.includes("support")) return "Support";
  if (target.includes("enrollment")) return "Enrollment";
  /* Unknown targets are general updates, never mislabelled as Security. */
  return "Update";
}

export type NotificationAudience = "staff" | "family";

/**
 * Deep link for a notification target, resolved for the portal the viewer is
 * actually in. Staff targets never link into `/portal` and family targets
 * never link into `/administrator`; the staff layout canonicalizes the
 * Administrator prefix to the viewer's profile when needed.
 */
export function notificationHref(
  row: Pick<ServerNotificationRow, "target_type" | "target_reference">,
  audience: NotificationAudience = "family",
): string | undefined {
  const target = row.target_type ?? "";
  const reference = row.target_reference ?? "";
  const staff = audience === "staff";
  if (target.includes("admission") && reference) return staff ? `/administrator/admissions/${encodeURIComponent(reference)}` : `/apply/student/${encodeURIComponent(reference)}/status`;
  /* Job applications are email-only (owner instruction): there is no
     applicant portal or status route, so a family-side notification must not
     link anywhere. Staff keep the review workspace link. */
  if (target.includes("job_application") && reference) return staff ? `/administrator/careers/${encodeURIComponent(reference)}` : undefined;
  if (target.includes("receipt") && reference) return staff ? "/administrator/finance/payments" : `/portal/receipts/${encodeURIComponent(reference)}`;
  if (target.includes("invoice") && reference) return staff ? "/administrator/finance/invoices" : `/portal/fees/${encodeURIComponent(reference)}`;
  if (target.includes("refund") || target.includes("payment")) return staff ? "/administrator/finance/payments" : "/portal/fees";
  if (target.includes("result_entry") || target.includes("result_batch")) return staff ? (reference ? `/administrator/results/${encodeURIComponent(reference)}` : "/administrator/results") : "/portal/results";
  if (target.includes("result")) return staff ? "/administrator/results" : "/portal/results";
  if (target.includes("timetable") || target.includes("exam_schedule")) return staff ? "/administrator/timetables" : "/portal/timetable";
  if (target.includes("notice") || target.includes("content")) return staff ? "/administrator/notices" : "/portal/notices";
  if (target.includes("support")) return staff ? "/administrator/support" : "/portal/support";
  if (target.includes("student") || target.includes("enrollment")) return staff ? undefined : "/portal";
  if (target.includes("user_account") || target.includes("staff_assignment") || target.includes("account_invitation")) return "/sign-in";
  return undefined;
}

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

function loadDismissedState(): Record<string, string[]> {
  return sessionGet<Record<string, string[]>>(NOTIFICATIONS_DISMISSED_SESSION_KEY) ?? {};
}

function saveDismissedState(state: Record<string, string[]>): void {
  sessionSet(NOTIFICATIONS_DISMISSED_SESSION_KEY, state);
}

/** Materialize seeds with deterministic timestamps, read state, and cleared ids. */
function materialize(seeds: readonly NotificationSeed[], readIds: readonly string[], dismissedIds: readonly string[] = []): NotificationItem[] {
  const nowMs = demoNow().getTime();
  return seeds
    .filter((seed) => !dismissedIds.includes(seed.id))
    .map((seed) => ({
      id: seed.id,
      kind: seed.kind,
      text: seed.text,
      atIso: new Date(nowMs - seed.offsetMs).toISOString(),
      unread: seed.unread && !readIds.includes(seed.id),
    }));
}

export interface NotificationsService {
  /** The account's notification list with its read state applied. */
  listForAccount(accountId: string, audience?: NotificationAudience): Promise<NotificationItem[]>;
  /** Synchronous variant for module-level consumers (shell topbar props). */
  listForAccountSync(accountId: string): NotificationItem[];
  /** Exact unread count for the account (server count in Supabase mode). */
  unreadCount(accountId: string): Promise<number>;
  /** Mark one item read for the account; returns the refreshed list. */
  markRead(accountId: string, notificationId: string, audience?: NotificationAudience): Promise<NotificationItem[]>;
  /** Mark every item read for the account; returns the refreshed list. */
  markAllRead(accountId: string, audience?: NotificationAudience): Promise<NotificationItem[]>;
  /** Clear one item from the account's list; returns the refreshed list. */
  dismiss(accountId: string, notificationId: string, audience?: NotificationAudience): Promise<NotificationItem[]>;
  /** Clear every item from the account's list; returns the refreshed list. */
  dismissAll(accountId: string, audience?: NotificationAudience): Promise<NotificationItem[]>;
}

export const notificationsService: NotificationsService = {
  async listForAccount(accountId, audience = "family") {
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<ServerNotificationRow[]>("notifications.list", { limit: NOTIFICATIONS_PAGE_SIZE });
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Notifications are unavailable.");
      return response.value.map((item) => ({ id: item.id, version: item.version ?? 1, kind: notificationKind(item), text: item.body ? `${item.title} — ${item.body}` : item.title, atIso: item.created_at, unread: item.read_at === null, href: notificationHref(item, audience) }));
    }
    return notificationsService.listForAccountSync(accountId);
  },

  listForAccountSync(accountId) {
    if (clientAdapterMode() === "supabase") throw new Error("Supabase notifications require the server-seeded account projection.");
    const state = loadReadState();
    return materialize(seedsForAccount(accountId), state[accountId] ?? [], loadDismissedState()[accountId] ?? []);
  },

  async unreadCount(accountId) {
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<number>("notifications.unreadCount", {});
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "The unread count is unavailable.");
      return response.value;
    }
    return notificationsService.listForAccountSync(accountId).filter((item) => item.unread).length;
  },

  async markRead(accountId, notificationId, audience = "family") {
    if (clientAdapterMode() === "supabase") {
      const current = await notificationsService.listForAccount(accountId, audience);
      const version = current.find((item) => item.id === notificationId)?.version ?? 1;
      const response = await adapterCall("notifications.markRead", { notificationId, expectedVersion: version });
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Notification could not be marked read.");
      return notificationsService.listForAccount(accountId, audience);
    }
    const state = loadReadState();
    const readIds = state[accountId] ?? [];
    if (!readIds.includes(notificationId)) {
      state[accountId] = [...readIds, notificationId];
      saveReadState(state);
    }
    return notificationsService.listForAccountSync(accountId);
  },

  async markAllRead(accountId, audience = "family") {
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<{ count: number }>("notifications.markAll", {});
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Notifications could not be marked read.");
      return notificationsService.listForAccount(accountId, audience);
    }
    const state = loadReadState();
    state[accountId] = seedsForAccount(accountId).map((seed) => seed.id);
    saveReadState(state);
    return notificationsService.listForAccountSync(accountId);
  },

  async dismiss(accountId, notificationId, audience = "family") {
    if (clientAdapterMode() === "supabase") {
      const current = await notificationsService.listForAccount(accountId, audience);
      const version = current.find((item) => item.id === notificationId)?.version ?? 1;
      const response = await adapterCall("notifications.dismiss", { notificationId, expectedVersion: version });
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Notification could not be cleared.");
      return notificationsService.listForAccount(accountId, audience);
    }
    const state = loadDismissedState();
    const dismissedIds = state[accountId] ?? [];
    if (!dismissedIds.includes(notificationId)) {
      state[accountId] = [...dismissedIds, notificationId];
      saveDismissedState(state);
    }
    return notificationsService.listForAccountSync(accountId);
  },

  async dismissAll(accountId, audience = "family") {
    if (clientAdapterMode() === "supabase") {
      const response = await adapterCall<{ count: number }>("notifications.dismissAll", {});
      if (!response.ok) throw new Error(response.errors[0]?.message ?? "Notifications could not be cleared.");
      return notificationsService.listForAccount(accountId, audience);
    }
    const state = loadDismissedState();
    state[accountId] = seedsForAccount(accountId).map((seed) => seed.id);
    saveDismissedState(state);
    return notificationsService.listForAccountSync(accountId);
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createNotificationsService = (): NotificationsService => notificationsService;
