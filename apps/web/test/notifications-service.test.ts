// @vitest-environment node
/**
 * Deterministic contract tests for the notifications demo adapter
 * (modules/services/notifications.ts). Node environment exercises the
 * SSR-safe in-memory fallback of the session store (no window). The clock is
 * pinned and the read-state session key is cleared between tests, so lists,
 * timestamps and per-account read state are fully deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  DEMO_STAFF_ACCOUNT_ID,
  NOTIFICATIONS_DISMISSED_SESSION_KEY,
  NOTIFICATIONS_SESSION_KEY,
  notificationHref,
  notificationKind,
  notificationsService,
} from "@/modules/services/notifications";
import { sessionRemove } from "@/modules/services/session";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PINNED = new Date("2026-08-05T09:30:00Z");

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  setDemoNow(PINNED);
  sessionRemove(NOTIFICATIONS_SESSION_KEY);
  sessionRemove(NOTIFICATIONS_DISMISSED_SESSION_KEY);
});

afterEach(() => {
  setDemoNow(null);
  sessionRemove(NOTIFICATIONS_SESSION_KEY);
  sessionRemove(NOTIFICATIONS_DISMISSED_SESSION_KEY);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("notificationsService", () => {
  it("keeps lists isolated per account", async () => {
    const guardian = await notificationsService.listForAccount(DEMO_GUARDIAN_ACCOUNT_ID);
    const staff = await notificationsService.listForAccount(DEMO_STAFF_ACCOUNT_ID);

    expect(guardian.map((item) => item.id)).toEqual(["guardian-1", "guardian-2", "guardian-3", "guardian-4"]);
    expect(staff.map((item) => item.id)).toEqual(["staff-1", "staff-2", "staff-3", "staff-4"]);
    expect(guardian.some((item) => item.id.startsWith("staff-"))).toBe(false);
    expect(staff.some((item) => item.id.startsWith("guardian-"))).toBe(false);
  });

  it("returns an empty list for unknown accounts", async () => {
    expect(await notificationsService.listForAccount("00000000-0000-4000-8000-000000009999")).toEqual([]);
  });

  it("derives deterministic timestamps from the injected demo clock", async () => {
    const guardian = await notificationsService.listForAccount(DEMO_GUARDIAN_ACCOUNT_ID);

    expect(guardian.map((item) => item.atIso)).toEqual([
      new Date(PINNED.getTime() - 2 * HOUR).toISOString(),
      new Date(PINNED.getTime() - 1 * DAY).toISOString(),
      new Date(PINNED.getTime() - 3 * DAY).toISOString(),
      new Date(PINNED.getTime() - 5 * DAY).toISOString(),
    ]);
    expect(new Date(guardian[0]!.atIso).getTime()).toBeLessThan(PINNED.getTime());
  });

  it("marks one item read for an account without touching the other account", async () => {
    await notificationsService.markRead(DEMO_GUARDIAN_ACCOUNT_ID, "guardian-1");

    const guardian = await notificationsService.listForAccount(DEMO_GUARDIAN_ACCOUNT_ID);
    expect(guardian.find((item) => item.id === "guardian-1")?.unread).toBe(false);
    expect(guardian.find((item) => item.id === "guardian-2")?.unread).toBe(true);

    const staff = await notificationsService.listForAccount(DEMO_STAFF_ACCOUNT_ID);
    expect(staff.find((item) => item.id === "staff-1")?.unread).toBe(true);
  });

  it("marks all read per account and keeps the other account's state", async () => {
    await notificationsService.markAllRead(DEMO_GUARDIAN_ACCOUNT_ID);

    const guardian = await notificationsService.listForAccount(DEMO_GUARDIAN_ACCOUNT_ID);
    expect(guardian.every((item) => !item.unread)).toBe(true);

    const staff = await notificationsService.listForAccount(DEMO_STAFF_ACCOUNT_ID);
    expect(staff.some((item) => item.unread)).toBe(true);
    expect(staff.find((item) => item.id === "staff-1")?.unread).toBe(true);
  });

  it("clears one notification for an account without touching the other account", async () => {
    const remaining = await notificationsService.dismiss(DEMO_GUARDIAN_ACCOUNT_ID, "guardian-1");

    expect(remaining.map((item) => item.id)).toEqual(["guardian-2", "guardian-3", "guardian-4"]);
    await expect(notificationsService.unreadCount(DEMO_GUARDIAN_ACCOUNT_ID)).resolves.toBe(1);

    const staff = await notificationsService.listForAccount(DEMO_STAFF_ACCOUNT_ID);
    expect(staff.map((item) => item.id)).toEqual(["staff-1", "staff-2", "staff-3", "staff-4"]);
  });

  it("clears every notification for an account and keeps the other account's list", async () => {
    const remaining = await notificationsService.dismissAll(DEMO_GUARDIAN_ACCOUNT_ID);

    expect(remaining).toEqual([]);
    await expect(notificationsService.unreadCount(DEMO_GUARDIAN_ACCOUNT_ID)).resolves.toBe(0);

    const staff = await notificationsService.listForAccount(DEMO_STAFF_ACCOUNT_ID);
    expect(staff).toHaveLength(4);
    expect(staff.some((item) => item.unread)).toBe(true);
  });

  it("maps server notification targets to safe authorized routes per portal", () => {
    expect(notificationKind({ kind: "email.deliver", target_type: "refund_request" })).toBe("Finance");
    expect(notificationKind({ kind: "Results", target_type: "result_publication" })).toBe("Results");
    expect(notificationHref({ target_type: "admission_application", target_reference: "APP-1" })).toBe("/apply/student/APP-1/status");
    expect(notificationHref({ target_type: "result_entry_sheet", target_reference: "RES-1" })).toBe("/portal/results");
    expect(notificationHref({ target_type: "result_entry_sheet", target_reference: "RES-1" }, "staff")).toBe("/administrator/results/RES-1");
    expect(notificationHref({ target_type: "receipt", target_reference: "RCPT-1" })).toBe("/portal/receipts/RCPT-1");
    /* A staff viewer never receives a guardian-portal link for finance targets. */
    expect(notificationHref({ target_type: "receipt", target_reference: "RCPT-1" }, "staff")).toBe("/administrator/finance/payments");
    expect(notificationHref({ target_type: "invoice", target_reference: "INV-1" }, "staff")).toBe("/administrator/finance/invoices");
    expect(notificationHref({ target_type: "result_publication" }, "staff")).toBe("/administrator/results");
    /* Enrollment updates have no honest staff workspace target, so staff see no link. */
    expect(notificationHref({ target_type: "enrollment", target_reference: "ENR-1" }, "staff")).toBeUndefined();
    /* Job applications are email-only: the family side has no status route, so
       no link may be rendered for the deleted /apply/job/.../status page. */
    expect(notificationHref({ target_type: "job_application", target_reference: "JOB-1" })).toBeUndefined();
    expect(notificationHref({ target_type: "job_application", target_reference: "JOB-1" }, "staff")).toBe("/administrator/careers/JOB-1");
  });

  it("maps an unknown target to the neutral Update kind, never Security", () => {
    expect(notificationKind({ kind: "email.deliver", target_type: "unmapped_event" })).toBe("Update");
    expect(notificationKind({ kind: "email.deliver", target_type: null })).toBe("Update");
    /* A real Security row keeps its explicit kind. */
    expect(notificationKind({ kind: "Security", target_type: null })).toBe("Security");
  });

  it("requests the paginated server list with the bounded default limit", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string; payload?: Record<string, unknown> };
      if (request.op === "notifications.list") return json({ ok: true, value: [] });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    await notificationsService.listForAccount(DEMO_GUARDIAN_ACCOUNT_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as { op: string; payload?: Record<string, unknown> };
    expect(request.op).toBe("notifications.list");
    expect(request.payload).toMatchObject({ limit: 25 });
  });

  it("counts unread items for the requested account", async () => {
    await expect(notificationsService.unreadCount(DEMO_GUARDIAN_ACCOUNT_ID)).resolves.toBe(2);
    await notificationsService.markRead(DEMO_GUARDIAN_ACCOUNT_ID, "guardian-1");
    await expect(notificationsService.unreadCount(DEMO_GUARDIAN_ACCOUNT_ID)).resolves.toBe(1);
    await expect(notificationsService.unreadCount(DEMO_STAFF_ACCOUNT_ID)).resolves.toBe(2);
  });

  it("sends the versioned dismiss operation and reloads the account list", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "notifications.list") {
        return json({ ok: true, value: [{ id: "n1", version: 3, kind: "Timetable", title: "Schedule update", body: null, target_reference: null, read_at: null, created_at: "2026-08-10T05:00:00.000Z" }] });
      }
      if (request.op === "notifications.dismiss") return json({ ok: true, value: { id: "n1", dismissedAt: "2026-08-10T06:00:00.000Z", version: 4 } });
      if (request.op === "notifications.dismissAll") return json({ ok: true, value: { count: 0 } });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    await notificationsService.dismiss("account-1", "n1");

    const requests = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")) as { op: string; payload?: Record<string, unknown> });
    /* The service reads the stored version first, then dismisses, then reloads. */
    expect(requests.map((request) => request.op)).toEqual(["notifications.list", "notifications.dismiss", "notifications.list"]);
    expect(requests[1]?.payload).toMatchObject({ notificationId: "n1", expectedVersion: 3 });
  });

  it("sends the dismiss-all operation and reloads the account list", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "notifications.list") return json({ ok: true, value: [] });
      if (request.op === "notifications.dismissAll") return json({ ok: true, value: { count: 2 } });
      return json({ ok: false, errors: [{ code: "unavailable", message: `unexpected ${request.op}`, field: null }] }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    await notificationsService.dismissAll("account-1");

    const requests = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")) as { op: string; payload?: Record<string, unknown> });
    expect(requests.map((request) => request.op)).toEqual(["notifications.dismissAll", "notifications.list"]);
  });

  it("maps the server unread count for the session account", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, value: 7 })));

    await expect(notificationsService.unreadCount("account-1")).resolves.toBe(7);
  });

  it("ships the same items the shells pass via the demo module", () => {
    /* The shell topbar props are the service's synchronous read for the
       fallback accounts, so the bells always render service records. */
    const sync = notificationsService.listForAccountSync(DEMO_GUARDIAN_ACCOUNT_ID);
    expect(sync.map((item) => item.id)).toEqual(["guardian-1", "guardian-2", "guardian-3", "guardian-4"]);
    expect(sync.map((item) => item.atIso)).toEqual(
      notificationsService.listForAccountSync(DEMO_GUARDIAN_ACCOUNT_ID).map((item) => item.atIso),
    );
  });
});
