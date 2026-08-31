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
    markAllRead: vi.fn().mockResolvedValue([]),
    markRead: vi.fn().mockResolvedValue([]),
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
});
