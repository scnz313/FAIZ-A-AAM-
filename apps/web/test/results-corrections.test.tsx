/**
 * Component tests for the results correction depth paths:
 *   - the entry officer can raise a correction request from the queue;
 *   - a reviewer sees pending corrections and approves one, which opens a new
 *     editable sheet;
 *   - the request never claims an editable version exists before approval.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResultsBatches } from "@/components/staff/ResultsBatches";
import {
  StaffContextProvider,
  STAFF_SESSION_KEYS,
  type StaffContextInitialState,
} from "@/components/staff/StaffContextProvider";
import { setDemoNow } from "@/modules/demo/clock";
import { academicsService, type EntryBatch, type PendingCorrection } from "@/modules/services/academics";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const SESSION_KEY = sessionKey("academics");
const PINNED = "2026-09-11T13:30:00.000Z";

const PUBLISHED: EntryBatch = {
  ref: "RES-2026-PUB01",
  exam: "midterm",
  className: "Class 8 · A",
  subject: "English",
  status: "published",
  rows: [{ subject: "Test Student One · Midterm", max: 100, obtained: 45 }],
  totalsIncomplete: false,
  version: 3,
};

const PENDING: PendingCorrection = {
  requestId: "request-1",
  version: 1,
  reason: "Recheck question 4",
  status: "requested",
  requestedAtIso: "2026-09-11T13:00:00.000Z",
  releaseRef: "RPR-2026-204CE7",
  publicationRef: "PUB-2026-F4ADBC",
  sheetRef: "RES-2026-28E330",
  subject: "English",
  term: "midterm",
  className: "Class 8 · A",
};

function state(input: {
  id: string;
  displayName: string;
  profileCode: "principal" | "administrator";
  title: string;
  roles: string[];
}): StaffContextInitialState {
  const primaryRole = (input.roles[0] ?? "result_entry_officer") as StaffContextInitialState["workspaces"][number]["role"];
  return {
    identityId: `00000000-0000-4000-8000-0000000002${input.id}`,
    workspaces: [{
      id: `00000000-0000-4000-8000-0000000003${input.id}`,
      ref: `RGR-2026-0${input.id}`,
      accountId: `00000000-0000-4000-8000-0000000002${input.id}`,
      role: primaryRole,
      status: "active",
      grantedByPersonId: null,
      reason: "Fictional results-depth test grant",
      scope: { academicYearIds: [], gradeSectionIds: [], subjectIds: [] },
      effectiveFromIso: "2026-04-01T00:00:00.000Z",
      effectiveToIso: null,
    }],
    summary: {
      accountId: `00000000-0000-4000-8000-0000000002${input.id}`,
      staffMemberId: `00000000-0000-4000-8000-0000000001${input.id}`,
      personId: `00000000-0000-4000-8000-0000000000${input.id}`,
      displayName: input.displayName,
      title: input.title,
      profileCode: input.profileCode,
      profileLabel: input.title,
      activeRoleGrantId: `00000000-0000-4000-8000-0000000003${input.id}`,
      role: primaryRole,
      roleLabel: "Results role",
      roles: input.roles,
      academicYearLabel: "2026–27",
      assignmentLabel: null,
      grantedWorkspaceCount: 1,
    },
  };
}

const PRINCIPAL = state({ id: "05", displayName: "Aam Principal", profileCode: "principal", title: "Principal", roles: ["result_entry_officer", "timetable_manager"] });
const ADMIN = state({ id: "04", displayName: "Aam Administrator", profileCode: "administrator", title: "Administrator", roles: ["exam_reviewer", "result_publisher"] });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  sessionRemove(SESSION_KEY);
  sessionRemove(STAFF_SESSION_KEYS.identity);
  setDemoNow(new Date(PINNED));
});

afterEach(() => {
  sessionRemove(SESSION_KEY);
  sessionRemove(STAFF_SESSION_KEYS.identity);
  setDemoNow(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function renderQueue(initialState: StaffContextInitialState, batches: EntryBatch[]) {
  return render(
    <StaffContextProvider initialState={initialState}>
      <ResultsBatches batches={batches} />
    </StaffContextProvider>,
  );
}

describe("correction request from the batch queue", () => {
  it("lets the entry officer request a correction without an editable version claim", async () => {
    const user = userEvent.setup();
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([PUBLISHED]);
    vi.spyOn(academicsService, "listCorrections").mockResolvedValue({ ok: true, value: [] });
    const startCorrection = vi.spyOn(academicsService, "startCorrection").mockResolvedValue({
      ok: true,
      value: { ...PUBLISHED, pendingCorrectionReason: "Recheck question 4" },
    });

    renderQueue(PRINCIPAL, [PUBLISHED]);

    await user.click(await screen.findByRole("button", { name: "Request correction" }));
    const reason = await screen.findByPlaceholderText(/Reason for correction/);
    await user.type(reason, "Recheck question 4");
    /* The row toggle keeps its label; the confirmation panel's submit is last. */
    const submits = screen.getAllByRole("button", { name: "Request correction" });
    await user.click(submits[submits.length - 1]!);

    await waitFor(() => expect(startCorrection).toHaveBeenCalledWith(PUBLISHED.ref, "Recheck question 4", expect.any(String)));
    expect(await screen.findByText(/an independent exam reviewer must approve it/i)).toBeInTheDocument();
  });

  it("does not offer the correction action to a read-only auditor", async () => {
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([PUBLISHED]);
    vi.spyOn(academicsService, "listCorrections").mockResolvedValue({ ok: true, value: [] });

    renderQueue(state({ id: "06", displayName: "Aam Auditor", profileCode: "administrator", title: "Auditor", roles: ["auditor"] }), [PUBLISHED]);

    await screen.findByText("RES-2026-PUB01");
    expect(screen.queryByRole("button", { name: "Request correction" })).not.toBeInTheDocument();
  });
});

describe("queue sheet action labels", () => {
  it("labels an editable sheet as entry and a read-only sheet as a view", async () => {
    const draft: EntryBatch = { ...PUBLISHED, ref: "RES-2026-DRAFT1", status: "draft" };
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([draft, PUBLISHED]);
    vi.spyOn(academicsService, "listCorrections").mockResolvedValue({ ok: true, value: [] });

    renderQueue(PRINCIPAL, [draft, PUBLISHED]);

    expect(await screen.findByRole("link", { name: "Open entry" })).toHaveAttribute(
      "href",
      expect.stringContaining("/results/RES-2026-DRAFT1/entry"),
    );
    expect(screen.getByRole("link", { name: "View sheet" })).toHaveAttribute(
      "href",
      expect.stringContaining("/results/RES-2026-PUB01/entry"),
    );
  });
});

describe("correction approval review queue", () => {
  it("shows pending corrections to a reviewer and opens the new sheet on approval", async () => {
    const user = userEvent.setup();
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([PUBLISHED]);
    vi.spyOn(academicsService, "listCorrections").mockResolvedValue({ ok: true, value: [PENDING] });
    const approve = vi.spyOn(academicsService, "approveCorrection").mockResolvedValue({
      ok: true,
      value: { requestId: PENDING.requestId, sheetRef: "RES-2026-CORR01", sheetVersion: 1 },
    });

    renderQueue(ADMIN, [PUBLISHED]);

    expect(await screen.findByText("Corrections awaiting review")).toBeInTheDocument();
    expect(screen.getByText("Recheck question 4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve correction" }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith(PENDING.requestId, PENDING.version));
    expect((await screen.findAllByText(/RES-2026-CORR01/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open entry/ })).toHaveAttribute("href", expect.stringContaining("/results/RES-2026-CORR01/entry"));
  });

  it("shows the pending request to the requester without an approve action", async () => {
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([PUBLISHED]);
    vi.spyOn(academicsService, "listCorrections").mockResolvedValue({ ok: true, value: [{ ...PENDING, sheetRef: PUBLISHED.ref }] });

    renderQueue(PRINCIPAL, [PUBLISHED]);

    expect(await screen.findByText("Corrections awaiting review")).toBeInTheDocument();
    expect(screen.getByText("Awaiting reviewer")).toBeInTheDocument();
    expect(screen.getByText(/Correction pending reviewer approval · Recheck question 4/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve correction" })).not.toBeInTheDocument();
  });
});
