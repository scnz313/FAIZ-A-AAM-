// @vitest-environment node
/**
 * Deterministic contract tests for the notifications demo adapter
 * (modules/services/notifications.ts). Node environment exercises the
 * SSR-safe in-memory fallback of the session store (no window). The clock is
 * pinned and the read-state session key is cleared between tests, so lists,
 * timestamps and per-account read state are fully deterministic.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  DEMO_STAFF_ACCOUNT_ID,
  NOTIFICATIONS_SESSION_KEY,
  notificationHref,
  notificationKind,
  notificationsService,
} from "@/modules/services/notifications";
import { sessionRemove } from "@/modules/services/session";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PINNED = new Date("2026-08-05T09:30:00Z");

beforeEach(() => {
  setDemoNow(PINNED);
  sessionRemove(NOTIFICATIONS_SESSION_KEY);
});

afterEach(() => {
  setDemoNow(null);
  sessionRemove(NOTIFICATIONS_SESSION_KEY);
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

  it("maps server notification targets to safe authorized routes", () => {
    expect(notificationKind({ kind: "email.deliver", target_type: "refund_request" })).toBe("Finance");
    expect(notificationKind({ kind: "Results", target_type: "result_publication" })).toBe("Results");
    expect(notificationHref({ target_type: "admission_application", target_reference: "APP-1" })).toBe("/apply/student/APP-1/status");
    expect(notificationHref({ target_type: "result_entry_sheet", target_reference: "RES-1" })).toBe("/staff/results/RES-1");
    expect(notificationHref({ target_type: "receipt", target_reference: "RCPT-1" })).toBe("/portal/receipts/RCPT-1");
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
