// @vitest-environment jsdom

/**
 * Audit explorer regressions.
 *
 * Two live defects are pinned here:
 * 1. The action filter was a fixed stale list, so real actions such as
 *    "MFA verified" or "Account suspended" could not be selected. Options are
 *    now derived from the loaded events.
 * 2. The register stopped silently at its first page. A cursor now continues
 *    backwards through history and never duplicates an already-loaded row.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditExplorer } from "@/components/staff/AuditExplorer";
import { auditService, type AuditEvent } from "@/modules/services/audit";

const NOW = new Date().toISOString();

function event(id: string, action: AuditEvent["action"], actor = "Aam Admin", offsetMinutes = 0): AuditEvent {
  return {
    id,
    timestampIso: new Date(Date.parse(NOW) - offsetMinutes * 60_000).toISOString(),
    actor,
    action,
    target: "—",
    outcome: "Success",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuditExplorer filters", () => {
  it("offers the actions actually present in the loaded events", () => {
    render(
      <AuditExplorer
        events={[event("e-1", "MFA verified"), event("e-2", "Account suspended"), event("e-3", "Login")]}
      />,
    );
    const options = Array.from(document.querySelectorAll("#audit-action option")).map((option) => option.textContent);
    expect(options).toContain("MFA verified");
    expect(options).toContain("Account suspended");
  });

  it("filters rows down to the selected action", async () => {
    const user = userEvent.setup();
    render(<AuditExplorer events={[event("e-1", "MFA verified"), event("e-2", "Login")]} />);
    await user.selectOptions(screen.getByLabelText("Action"), "MFA verified");
    expect(within(screen.getByRole("table")).getByText("MFA verified")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("Login")).not.toBeInTheDocument();
    expect(screen.getByText("1 audit event shown")).toBeInTheDocument();
  });
});

describe("AuditExplorer pagination", () => {
  it("loads older events with the cursor and merges them exactly once", async () => {
    const user = userEvent.setup();
    const firstPage = [event("e-1", "Login", "Aam Admin", 1), event("e-2", "Login", "Aam Admin", 2)];
    const older = [event("e-3", "Login", "Aam Admin", 3), event("e-2", "Login", "Aam Admin", 2)];
    const listPage = vi.spyOn(auditService, "listEventsPage").mockResolvedValue({ events: older, nextCursor: null });

    render(<AuditExplorer events={firstPage} initialCursor="2026-09-15T00:00:00Z" paged />);
    await user.click(screen.getByRole("button", { name: "Load older events" }));

    expect(listPage).toHaveBeenCalledWith({ limit: 50, cursor: "2026-09-15T00:00:00Z" });
    await waitFor(() => expect(screen.getByText("End of the audit register.")).toBeInTheDocument());
    /* The boundary row (e-2) is de-duplicated, so three rows remain. */
    expect(screen.getByText(/^3 audit events shown/)).toBeInTheDocument();
  });

  it("keeps the loaded history when loading older events fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(auditService, "listEventsPage").mockRejectedValue(new Error("offline"));
    render(<AuditExplorer events={[event("e-1", "Login", "Aam Admin", 1)]} initialCursor="2026-09-15T00:00:00Z" paged />);
    await user.click(screen.getByRole("button", { name: "Load older events" }));
    await waitFor(() =>
      expect(
        screen.getByText("Older audit events could not be loaded · the loaded history is unchanged. Try again."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/^1 audit event shown/)).toBeInTheDocument();
  });

  it("offers to load older events when the current filter matches nothing", async () => {
    const user = userEvent.setup();
    vi.spyOn(auditService, "listEventsPage").mockResolvedValue({ events: [], nextCursor: null });
    /* A ten-day-old event is hidden by the "Today" range filter. */
    render(
      <AuditExplorer
        events={[event("e-1", "Login", "Aam Admin", 60 * 24 * 10)]}
        initialCursor="2026-09-15T00:00:00Z"
        paged
      />,
    );
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("No audit events in this view")).toBeInTheDocument();
    expect(screen.getByText(/Older events are available and may match\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load older events" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeInTheDocument();
  });
});
