/**
 * NotificationBell tests: unread count in the trigger's aria-label,
 * Mark-all-read clearing the count, and the dropdown toggling.
 * Relative time text is intentionally not asserted (it depends on the
 * wall clock); only count / aria / panel visibility are.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NotificationBell } from "@/components/layouts/NotificationBell";
import type { NotificationItem } from "@/modules/notifications/demo";
import { notificationsService } from "@/modules/services/notifications";

vi.mock("@/modules/services/notifications", () => ({
  notificationsService: {
    listForAccount: vi.fn().mockResolvedValue([]),
    unreadCount: vi.fn().mockResolvedValue(0),
    markAllRead: vi.fn().mockResolvedValue([]),
    markRead: vi.fn().mockResolvedValue([]),
    dismiss: vi.fn().mockResolvedValue([]),
    dismissAll: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    prefetch: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/portal",
  useSearchParams: () => new URLSearchParams(),
}));

const ITEMS: NotificationItem[] = [
  { id: "n1", kind: "Fee", text: "Term 3 invoice issued — INV-2026-0103", atIso: "2026-08-03T06:00:00Z", unread: true, href: "/portal/fees/INV-2026-0103" },
  { id: "n2", kind: "Result", text: "Term 2 report card published", atIso: "2026-08-02T06:00:00Z", unread: true },
  { id: "n3", kind: "Notice", text: "Mid-term date sheet released", atIso: "2026-08-01T06:00:00Z", unread: false },
  { id: "n4", kind: "Alert", text: "Winter air-quality advisory", atIso: "2026-07-30T06:00:00Z", unread: false },
];

describe("NotificationBell", () => {
  it("announces the unread count (2 of 4) in the trigger aria-label", () => {
    render(<NotificationBell items={ITEMS} />);

    const bell = screen.getByRole("button", { name: /Notifications/ });
    expect(bell).toHaveAttribute("aria-label", "Notifications, 2 unread");
    expect(bell).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles the dropdown open and closed", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} />);

    const bell = screen.getByRole("button", { name: /Notifications/ });

    await user.click(bell);
    expect(bell).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Notifications" })).toBeVisible();
    expect(screen.getByText("Mark all read")).toBeInTheDocument();

    await user.click(bell);
    expect(bell).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("renders authorized deep links and marks a selected item read", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} />);
    const bell = screen.getByRole("button", { name: /Notifications/ });
    await user.click(bell);
    const link = screen.getByRole("link", { name: /Term 3 invoice issued/ });
    expect(link).toHaveAttribute("href", "/portal/fees/INV-2026-0103");
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    expect(bell).toHaveAttribute("aria-label", "Notifications, 1 unread");
  });

  it("clears the unread count via Mark all read", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} />);

    const bell = screen.getByRole("button", { name: /Notifications/ });
    await user.click(bell);
    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    expect(bell).toHaveAttribute("aria-label", "Notifications, 0 unread");
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  });

  it("caps the visible list and expands every row on demand", async () => {
    const user = userEvent.setup();
    const many: NotificationItem[] = Array.from({ length: 9 }, (_, index) => ({
      id: `m${index}`,
      kind: "Notice",
      text: `Notice ${index}`,
      atIso: "2026-08-01T06:00:00Z",
      unread: false,
    }));
    render(<NotificationBell items={many} />);

    await user.click(screen.getByRole("button", { name: /Notifications/ }));

    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByText("Notice 8")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all 9" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByText("Notice 8")).toBeInTheDocument();
  });

  it("clears one notification and updates the unread count", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} />);

    const bell = screen.getByRole("button", { name: /Notifications/ });
    await user.click(bell);
    await user.click(screen.getByRole("button", { name: /Dismiss notification: Term 3 invoice issued/ }));

    expect(screen.queryByText("Term 3 invoice issued — INV-2026-0103")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(bell).toHaveAttribute("aria-label", "Notifications, 1 unread");
  });

  it("clears every notification with Clear all", async () => {
    const user = userEvent.setup();
    render(<NotificationBell items={ITEMS} />);

    const bell = screen.getByRole("button", { name: /Notifications/ });
    await user.click(bell);
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Nothing new. Notifications appear here.")).toBeInTheDocument();
    expect(bell).toHaveAttribute("aria-label", "Notifications, 0 unread");
    expect(screen.getByRole("button", { name: "Clear all" })).toBeDisabled();
  });

  it("clears a notification through the account service and restores the row on failure", async () => {
    const user = userEvent.setup();
    const listForAccount = vi.mocked(notificationsService.listForAccount);
    const dismiss = vi.mocked(notificationsService.dismiss);
    const unreadCount = vi.mocked(notificationsService.unreadCount);
    listForAccount.mockClear();
    listForAccount.mockResolvedValue(ITEMS);
    unreadCount.mockClear();
    unreadCount.mockResolvedValue(2);

    dismiss.mockClear();
    dismiss.mockResolvedValueOnce(ITEMS.filter((item) => item.id !== "n1"));
    render(<NotificationBell items={ITEMS} accountId="account-1" />);

    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    await user.click(screen.getByRole("button", { name: /Dismiss notification: Term 3 invoice issued/ }));

    await waitFor(() => expect(dismiss).toHaveBeenCalledWith("account-1", "n1", "family"));
    await waitFor(() => expect(screen.queryByText("Term 3 invoice issued — INV-2026-0103")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: /Notifications/ })).toHaveAttribute("aria-label", "Notifications, 1 unread"));

    dismiss.mockClear();
    dismiss.mockRejectedValueOnce(new Error("Notification could not be cleared."));
    await user.click(screen.getByRole("button", { name: /Dismiss notification: Term 2 report card published/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Notification could not be cleared.");
    await waitFor(() => expect(screen.getByText("Term 2 report card published")).toBeInTheDocument());
  });

  it("uses server-provided items without refetching until the panel opens", async () => {
    const user = userEvent.setup();
    const listForAccount = vi.mocked(notificationsService.listForAccount);
    listForAccount.mockClear();
    listForAccount.mockResolvedValue(ITEMS);
    render(<NotificationBell items={ITEMS} accountId="account-1" />);

    expect(listForAccount).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Notifications/ }));
    await waitFor(() => expect(listForAccount).toHaveBeenCalledTimes(1));
  });

  it("shows an inline error when the load fails and retries on demand", async () => {
    const user = userEvent.setup();
    const listForAccount = vi.mocked(notificationsService.listForAccount);
    listForAccount.mockClear();
    listForAccount.mockRejectedValueOnce(new Error("Notifications are unavailable.")).mockResolvedValueOnce(ITEMS);
    render(<NotificationBell items={[]} accountId="account-1" />);

    await user.click(screen.getByRole("button", { name: /Notifications/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Notifications are unavailable.");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(listForAccount).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText("Term 3 invoice issued — INV-2026-0103")).toBeInTheDocument();
  });

  it("restores a row and shows the inline error when mark-read fails", async () => {
    const user = userEvent.setup();
    const listForAccount = vi.mocked(notificationsService.listForAccount);
    const markRead = vi.mocked(notificationsService.markRead);
    const unreadCount = vi.mocked(notificationsService.unreadCount);
    listForAccount.mockClear();
    listForAccount.mockResolvedValue(ITEMS);
    unreadCount.mockClear();
    unreadCount.mockResolvedValue(2);
    markRead.mockClear();
    markRead.mockRejectedValueOnce(new Error("Notification could not be marked read."));
    render(<NotificationBell items={ITEMS} accountId="account-1" />);

    const bell = screen.getByRole("button", { name: /Notifications/ });
    await user.click(bell);
    await waitFor(() => expect(bell).toHaveAttribute("aria-label", "Notifications, 2 unread"));

    const link = screen.getByRole("link", { name: /Term 3 invoice issued/ });
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);

    expect(await screen.findByRole("alert")).toHaveTextContent("Notification could not be marked read.");
    await waitFor(() => expect(bell).toHaveAttribute("aria-label", "Notifications, 2 unread"));
  });
});
