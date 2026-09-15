import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const staffMocks = vi.hoisted(() => ({ useStaffContext: vi.fn() }));

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: staffMocks.useStaffContext,
}));

import ResultReleasePanel from "@/components/staff/ResultReleasePanel";
import { academicsService, type ReportReleaseCandidate } from "@/modules/services/academics";

const CANDIDATES: ReportReleaseCandidate[] = [
  {
    studentId: "00000000-0000-4000-8000-000000000901",
    enrollmentId: "00000000-0000-4000-8000-000000000801",
    studentName: "Aarif Khan",
    publicationIds: ["00000000-0000-4000-8000-000000000701", "00000000-0000-4000-8000-000000000702"],
    release: null,
  },
  {
    studentId: "00000000-0000-4000-8000-000000000902",
    enrollmentId: "00000000-0000-4000-8000-000000000802",
    studentName: "Mariam Khan",
    publicationIds: ["00000000-0000-4000-8000-000000000703"],
    release: { releaseId: "00000000-0000-4000-8000-000000000601", reference: "REL-2026-0001", version: 1, status: "published" },
  },
  {
    studentId: "00000000-0000-4000-8000-000000000903",
    enrollmentId: "00000000-0000-4000-8000-000000000803",
    studentName: "Zoya Khan",
    publicationIds: [],
    release: null,
  },
];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
  staffMocks.useStaffContext.mockReturnValue({
    summary: { profileCode: null, roles: ["result_publisher"], roleLabel: "Result publisher", displayName: "Sana Wani" },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ResultReleasePanel", () => {
  it("lists per-student release readiness and releases one student on request", async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(academicsService, "listReleaseCandidates").mockResolvedValue({ ok: true, value: CANDIDATES });
    const publish = vi.spyOn(academicsService, "publishReportReleases").mockResolvedValue({
      ok: true,
      value: { released: 1, skipped: 0, failed: [] },
    });

    render(<ResultReleasePanel batchRef="RES-2026-F5236D" batchStatus="published" />);

    expect(await screen.findByText("Aarif Khan")).toBeInTheDocument();
    expect(screen.getByText("2 subject publications for this term")).toBeInTheDocument();
    expect(screen.getByText("Released v1")).toBeInTheDocument();
    expect(screen.getByText("No published subjects")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Release ready reports (2)" })).toBeInTheDocument();

    const rowRelease = screen.getAllByRole("button", { name: "Release" })[0];
    await user.click(rowRelease!);
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith("RES-2026-F5236D", { studentIds: [CANDIDATES[0]!.studentId] }),
    );
    expect(await screen.findByText("Released 1 report.")).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("releases every ready student without a student filter", async () => {
    const user = userEvent.setup();
    vi.spyOn(academicsService, "listReleaseCandidates").mockResolvedValue({ ok: true, value: CANDIDATES });
    const publish = vi.spyOn(academicsService, "publishReportReleases").mockResolvedValue({
      ok: true,
      value: { released: 2, skipped: 1, failed: [] },
    });

    render(<ResultReleasePanel batchRef="RES-2026-F5236D" batchStatus="published" />);
    await screen.findByText("Aarif Khan");
    await user.click(screen.getByRole("button", { name: "Release ready reports (2)" }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith("RES-2026-F5236D", {}));
    expect(await screen.findByText("Released 2 reports · 1 skipped (no published subjects).")).toBeInTheDocument();
  });

  it("refuses the action for a reader without the publisher role", async () => {
    staffMocks.useStaffContext.mockReturnValue({
      summary: { profileCode: null, roles: ["exam_reviewer"], roleLabel: "Exam reviewer", displayName: "Sana Wani" },
    });
    vi.spyOn(academicsService, "listReleaseCandidates").mockResolvedValue({ ok: true, value: CANDIDATES });

    render(<ResultReleasePanel batchRef="RES-2026-F5236D" batchStatus="published" />);
    await screen.findByText("Aarif Khan");
    expect(screen.getAllByRole("button", { name: "Release" })[0]).toBeDisabled();
    expect(screen.getByText("Only a result publisher can assemble report releases.")).toBeInTheDocument();
  });

  it("never loads the publisher-only projection for the entry officer", async () => {
    staffMocks.useStaffContext.mockReturnValue({
      summary: { profileCode: "principal", roles: ["result_entry_officer"], roleLabel: "Result entry officer", displayName: "Rania Mir" },
    });
    const list = vi.spyOn(academicsService, "listReleaseCandidates");

    render(<ResultReleasePanel batchRef="RES-2026-F5236D" batchStatus="published" />);

    expect(await screen.findByText(/A result publisher assembles each student/)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByText("Release readiness could not be loaded")).not.toBeInTheDocument();
  });
});
