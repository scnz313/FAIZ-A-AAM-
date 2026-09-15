/**
 * Component tests for the marks-entry workspace depth states: the moderator's
 * return reason, a pending correction, and honest version-history rendering
 * (no fabricated 1970 timestamps or raw account UUIDs).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const staffMocks = vi.hoisted(() => ({ useStaffContext: vi.fn() }));

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: staffMocks.useStaffContext,
}));

import { MarksEntry } from "@/components/staff/MarksEntry";
import { academicsService, type EntryBatch } from "@/modules/services/academics";

const BASE: EntryBatch = {
  ref: "RES-2026-28E330",
  exam: "midterm",
  className: "Class 8 · A",
  subject: "English",
  status: "returned",
  rows: [{ subject: "Test Student One · Midterm", max: 100, obtained: 45 }],
  totalsIncomplete: false,
  version: 4,
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
  staffMocks.useStaffContext.mockReturnValue({
    summary: { profileCode: "principal", roles: ["result_entry_officer"], roleLabel: "Result entry officer", displayName: "Aam Principal" },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("moderator return reason", () => {
  it("shows the recorded return reason so the entry officer can resubmit", async () => {
    vi.spyOn(academicsService, "listVersions").mockResolvedValue([
      { version: 4, state: "returned", note: "Total does not match the answer sheet", atIso: "2026-09-10T09:00:00Z" },
      { version: 3, state: "submitted", note: "Marks submitted", atIso: "2026-09-10T08:30:00Z" },
    ]);

    render(<MarksEntry batchRef={BASE.ref} initialBatch={{ ...BASE, returnedReason: "Total does not match the answer sheet" }} />);

    expect(await screen.findByText("Returned by moderation")).toBeInTheDocument();
    expect(screen.getAllByText(/Total does not match the answer sheet/).length).toBeGreaterThan(0);
  });

  it("shows a pending correction on a published batch", async () => {
    vi.spyOn(academicsService, "listVersions").mockResolvedValue([]);
    render(<MarksEntry batchRef={BASE.ref} initialBatch={{ ...BASE, status: "published", pendingCorrectionReason: "Recheck question 4" }} />);

    expect(await screen.findByText("Correction pending review")).toBeInTheDocument();
    expect(screen.getByText(/Recheck question 4/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request correction" })).toBeInTheDocument();
  });
});

describe("version history honesty", () => {
  it("renders a state label for an empty note and never a fabricated timestamp", async () => {
    vi.spyOn(academicsService, "listVersions").mockResolvedValue([
      { version: 5, state: "approved", note: "", atIso: "" },
      { version: 4, state: "published", note: "Subject publication released", atIso: "2026-09-11T12:37:03Z" },
    ]);

    render(<MarksEntry batchRef={BASE.ref} initialBatch={{ ...BASE, status: "published", rows: [{ subject: "Test Student One · Midterm", max: 100, obtained: 45 }] }} />);

    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByText(/Subject publication released/)).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
    expect(screen.queryByText(/[0-9a-f]{8}-[0-9a-f]{4}/i)).not.toBeInTheDocument();
  });
});

describe("live student matrix", () => {
  const MATRIX_ROWS = [
    { subject: "Hiba Wani · Midterm", max: 100, obtained: 88, studentName: "Hiba Wani", componentName: "Midterm", rosterId: "roster-1", componentId: "component-1" },
    /* Two roster candidates share a display name; the row key must still be unique. */
    { subject: "Student · Midterm", max: 100, obtained: 50, studentName: "Student", componentName: "Midterm", rosterId: "roster-2", componentId: "component-1" },
    { subject: "Student · Midterm", max: 100, obtained: 60, studentName: "Student", componentName: "Midterm", rosterId: "roster-3", componentId: "component-1" },
  ];

  it("labels the first column Student and never logs a duplicate React key", async () => {
    vi.spyOn(academicsService, "listVersions").mockResolvedValue([]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<MarksEntry batchRef={BASE.ref} initialBatch={{ ...BASE, status: "published", rows: MATRIX_ROWS }} />);

    expect(await screen.findByRole("columnheader", { name: "Student" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Subject" })).not.toBeInTheDocument();
    expect(screen.getByText("Hiba Wani")).toBeInTheDocument();
    const studentCells = Array.from(document.querySelectorAll("tbody td strong")).filter((cell) => cell.textContent === "Student");
    expect(studentCells).toHaveLength(2);
    const duplicateKeyWarnings = errorSpy.mock.calls.filter((call) => String(call[0]).includes("same key"));
    expect(duplicateKeyWarnings).toHaveLength(0);
  });

  it("explains the next actor instead of leaving an empty action row", async () => {
    vi.spyOn(academicsService, "listVersions").mockResolvedValue([]);

    render(<MarksEntry batchRef={BASE.ref} initialBatch={{ ...BASE, status: "submitted", rows: MATRIX_ROWS }} />);

    expect(
      await screen.findByText("Awaiting an exam reviewer's moderation decision. No action is required from this workspace."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });

  it("states the separate release-assembly step in the publish confirmation", async () => {
    const user = userEvent.setup();
    staffMocks.useStaffContext.mockReturnValue({
      summary: { profileCode: "administrator", roles: ["result_publisher"], roleLabel: "Result publisher", displayName: "Aam Second Admin" },
    });
    vi.spyOn(academicsService, "listVersions").mockResolvedValue([]);

    render(<MarksEntry batchRef={BASE.ref} initialBatch={{ ...BASE, status: "approved", rows: MATRIX_ROWS }} />);

    await user.click(await screen.findByRole("button", { name: "Publish" }));
    expect(
      await screen.findByText(/each student's report release is assembled separately before families can view it/),
    ).toBeInTheDocument();
  });
});
