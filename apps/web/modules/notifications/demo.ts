/**
 * Fictional demo notifications for the portal and staff topbar bells.
 *
 * The item definitions live in the notifications service adapter
 * (`modules/services/notifications.ts`), which seeds them deterministically
 * from the injected demo clock (`demoNowIso`) — never the wall clock — and
 * applies per-account read state. The shell-facing lists below are the
 * service's read for the demo guardian and staff accounts, so the topbar
 * bells always render the same items the service returns.
 *
 * All data is fictional — no real invoices, applications, or alerts.
 */

import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  DEMO_STAFF_ACCOUNT_ID,
  notificationsService,
} from "@/modules/services/notifications";

export type NotificationKind =
  | "Fee"
  | "Result"
  | "Notice"
  | "Alert"
  | "Admissions"
  | "Finance"
  | "Results"
  | "Environment";

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  text: string;
  atIso: string;
  unread: boolean;
};

/** Family/student portal bell — service read for the linked demo child. */
export const GUARDIAN_NOTIFICATIONS: NotificationItem[] = notificationsService.listForAccountSync(
  DEMO_GUARDIAN_ACCOUNT_ID,
);

/** Staff workspace bell — service read for the operations team. */
export const STAFF_NOTIFICATIONS: NotificationItem[] = notificationsService.listForAccountSync(
  DEMO_STAFF_ACCOUNT_ID,
);
