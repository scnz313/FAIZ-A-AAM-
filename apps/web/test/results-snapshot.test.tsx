/**
 * Deterministic tests for the per-student published result snapshot
 * (I2 item 3): the academics service owns the snapshot the portal renders,
 * Aarif's rows match the marks fixture exactly, Mariam has a distinct
 * fictional snapshot over the same subjects/maxima, students or years
 * without a snapshot return null, and the portal table renders the
 * snapshot rows — never a term fixture fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FamilyContextProvider } from "@/components/portal/FamilyContextProvider";
import { PublicationPageClient } from "@/components/portal/PublicationPageClient";
import { ResultTable } from "@/components/portal/ResultTable";
import { MarksEntry } from "@/components/staff/MarksEntry";
import { ResultsBatches } from "@/components/staff/ResultsBatches";
import {
  STAFF_SESSION_KEYS,
  StaffContextProvider,
  type StaffContextInitialState,
} from "@/components/staff/StaffContextProvider";
import { marksByTerm } from "@/modules/academics/demo";
import { setDemoNow } from "@/modules/demo/clock";
import { academicsService } from "@/modules/services/academics";
import { auditService, AUDIT_SESSION_KEY_EXPORT } from "@/modules/services/audit";
import { documentsService } from "@/modules/services/documents";
import { clearOutboxSession } from "@/modules/services/outbox";
import { sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";
import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  familyContextService,
  RELATIONSHIPS_SESSION_KEY,
} from "@/modules/services/family-context";
import { staffContextService } from "@/modules/services/staff-context";
import type { EntryBatch } from "@/modules/services/academics";

const SESSION_KEY = sessionKey("academics");
const PINNED = "2026-08-10T05:00:00.000Z";
/** Rania Mir — Principal profile with result_entry_officer (marks entry). */
const RESULT_ENTRY_ACCOUNT_ID = "00000000-0000-4000-8000-000000000205";
const RESULT_ENTRY_GRANT_ID = "00000000-0000-4000-8000-000000000323";

/* Stable IDs from the relationships fixture. */
const AARIF_ID = "00000000-0000-4000-8000-000000000901";
const MARIAM_ID = "00000000-0000-4000-8000-000000000902";
/** Zoya Khan (STU-2026-0903, Class 9-C) — no results snapshot in the demo. */
const ZOYA_ID = "00000000-0000-4000-8000-000000000903";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000009999";
const CURRENT_YEAR_ID = "00000000-0000-4000-8000-000000000602";
const COMPLETED_YEAR_ID = "00000000-0000-4000-8000-000000000601";

const STAFF_INITIAL_STATE: StaffContextInitialState = {
  identityId: "00000000-0000-4000-8000-000000000203",
  workspaces: [{
    id: "00000000-0000-4000-8000-000000000303",
    ref: "RGR-2026-0303",
    accountId: "00000000-0000-4000-8000-000000000203",
    role: "exam_reviewer",
    status: "active",
    grantedByPersonId: null,
    reason: "Fictional results hydration test grant",
    scope: { academicYearIds: [], gradeSectionIds: [], subjectIds: [] },
    effectiveFromIso: "2026-04-01T00:00:00.000Z",
    effectiveToIso: null,
  }],
  summary: {
    accountId: "00000000-0000-4000-8000-000000000203",
    staffMemberId: "00000000-0000-4000-8000-000000000103",
    personId: "00000000-0000-4000-8000-000000000003",
    displayName: "Sana Wani",
    title: "Exam reviewer",
    profileCode: null,
    profileLabel: null,
    activeRoleGrantId: "00000000-0000-4000-8000-000000000303",
    role: "exam_reviewer",
    roleLabel: "Exam reviewer",
    roles: ["exam_reviewer"],
    academicYearLabel: "2026–27",
    assignmentLabel: null,
    grantedWorkspaceCount: 1,
  },
};

const SERVER_BATCH: EntryBatch = {
  ref: "RB-2026-SERVER",
  exam: "Server term",
  className: "8-A",
  subject: "Mathematics",
  status: "draft",
  rows: [],
  totalsIncomplete: true,
  version: 1,
};

beforeEach(() => {
  sessionRemove(SESSION_KEY);
  sessionRemove(sessionKey("identity"));
  sessionRemove(STAFF_SESSION_KEYS.identity);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  clearOutboxSession();
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
  setDemoNow(new Date(PINNED));
});

afterEach(() => {
  sessionRemove(SESSION_KEY);
  sessionRemove(sessionKey("identity"));
  sessionRemove(STAFF_SESSION_KEYS.identity);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  clearOutboxSession();
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
  setDemoNow(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getStudentResultSnapshot", () => {
  it("seeds Aarif's snapshot with values identical to the marks fixture", async () => {
    const snapshot = await academicsService.getStudentResultSnapshot(AARIF_ID, CURRENT_YEAR_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.studentId).toBe(AARIF_ID);
    expect(snapshot?.academicYearId).toBe(CURRENT_YEAR_ID);

    for (const label of ["Term 1", "Term 2"]) {
      const fixture = marksByTerm[label] ?? [];
      const rows = snapshot?.terms[label] ?? [];
      expect(rows).toHaveLength(fixture.length);
      rows.forEach((row, index) => {
        expect(row.subject).toBe(fixture[index]?.subject);
        expect(row.max).toBe(fixture[index]?.max);
        expect(row.obtained).toBe(fixture[index]?.obtained);
        expect(row.grade).toBe(fixture[index]?.grade);
        expect(row.remark).toBe(fixture[index]?.remark);
      });
    }
  });

  it("returns a distinct fictional snapshot for Mariam over the same subjects and maxima", async () => {
    const snapshot = await academicsService.getStudentResultSnapshot(MARIAM_ID, CURRENT_YEAR_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.studentId).toBe(MARIAM_ID);

    const fixture = marksByTerm["Term 1"] ?? [];
    const rows = snapshot?.terms["Term 1"] ?? [];
    expect(rows).toHaveLength(fixture.length);
    rows.forEach((row, index) => {
      expect(row.subject).toBe(fixture[index]?.subject);
      expect(row.max).toBe(fixture[index]?.max);
    });
    /* Distinct obtained values — the snapshot is per-student, not the fixture. */
    expect(rows[0]?.obtained).not.toBe(fixture[0]?.obtained);
    expect(rows.some((row, index) => row.obtained !== fixture[index]?.obtained)).toBe(true);
  });

  it("returns null for a student without a published snapshot", async () => {
    expect(await academicsService.getStudentResultSnapshot(ZOYA_ID, CURRENT_YEAR_ID)).toBeNull();
    expect(await academicsService.getStudentResultSnapshot(UNKNOWN_ID, CURRENT_YEAR_ID)).toBeNull();
  });

  it("returns null when the academic year has no snapshot", async () => {
    expect(await academicsService.getStudentResultSnapshot(AARIF_ID, COMPLETED_YEAR_ID)).toBeNull();
  });
});

describe("portal marks source", () => {
  it("never falls back to the term fixture while a snapshot exists for the active child", async () => {
    /* Mariam's snapshot rows differ from the fixture, so the only way the
     * portal can show her marks is the snapshot — a fixture fallback would
     * silently show Aarif's numbers. */
    const mariam = await academicsService.getStudentResultSnapshot(MARIAM_ID, CURRENT_YEAR_ID);
    const mariamTerm1 = mariam?.terms["Term 1"] ?? [];
    const fixtureTerm1 = marksByTerm["Term 1"] ?? [];
    expect(mariamTerm1).not.toEqual(fixtureTerm1);
    expect(mariamTerm1[0]?.obtained).not.toBe(fixtureTerm1[0]?.obtained);
  });

  it("renders the active child's snapshot rows in ResultTable, not the fixture values", async () => {
    const snapshot = await academicsService.getStudentResultSnapshot(MARIAM_ID, CURRENT_YEAR_ID);
    const rows = snapshot?.terms["Term 1"] ?? [];
    expect(rows.length).toBeGreaterThan(0);

    render(
      <ResultTable
        term={{ id: "term-1", label: "Term 1", publicationStatus: "final", publishedAtIso: "2026-06-15T06:00:00Z" }}
        marks={rows}
      />,
    );

    /* Mariam's Term 1 total is 556/700 — distinct from the fixture total (593/700). */
    expect(screen.getByText("556")).toBeTruthy();
    expect(screen.getByText("700")).toBeTruthy();
    expect(screen.queryByText("593")).toBeNull();
    /* Mariam's English mark (78) is present; the fixture English mark (84) is not. */
    expect(screen.getByText("78")).toBeTruthy();
    expect(screen.queryByText("91")).toBeNull();
  });

  it("offers the generated report card for download when the release document exists", async () => {
    const snapshot = await academicsService.getStudentResultSnapshot(MARIAM_ID, CURRENT_YEAR_ID);
    const rows = snapshot?.terms["Term 1"] ?? [];
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    const requestDownload = vi.spyOn(documentsService, "requestDownload").mockResolvedValue({
      state: "ready",
      url: "https://example.test/signed/report-card.pdf",
      expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
      filename: "report-card-RPR-2026-8F4E8122F2.pdf",
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();

    render(
      <ResultTable
        term={{ id: "term-1", label: "Term 1", publicationStatus: "final", publishedAtIso: "2026-06-15T06:00:00Z" }}
        marks={rows}
        reportCardDocument={{ reference: "DOC-2026-273239B515", filename: "report-card-RPR-2026-8F4E8122F2.pdf" }}
      />,
    );

    const download = screen.getByRole("button", { name: "Download official report (PDF)" });
    await user.click(download);
    await waitFor(() => expect(requestDownload).toHaveBeenCalledWith("DOC-2026-273239B515"));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("short-lived download link");
  });

  it("keeps the honest placeholder when no generated report card exists", () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    render(
      <ResultTable
        term={{ id: "term-1", label: "Term 1", publicationStatus: "final", publishedAtIso: "2026-06-15T06:00:00Z" }}
        marks={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Official report (PDF)" })).toBeDisabled();
    expect(screen.getByText(/being prepared/)).toBeTruthy();
  });
});

describe("server-hydrated results components", () => {
  it("uses the authoritative batch list and detail without duplicate Supabase reads", async () => {
    vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    const listBatches = vi.spyOn(academicsService, "listBatches").mockResolvedValue([]);
    const getBatch = vi.spyOn(academicsService, "getBatch").mockResolvedValue(null);
    const listVersions = vi.spyOn(academicsService, "listVersions").mockResolvedValue([]);

    const queue = render(
      <StaffContextProvider initialState={STAFF_INITIAL_STATE}>
        <ResultsBatches batches={[SERVER_BATCH]} />
      </StaffContextProvider>,
    );
    expect(screen.getByText("Server term")).toBeInTheDocument();
    expect(listBatches).not.toHaveBeenCalled();
    queue.unmount();

    render(
      <StaffContextProvider initialState={STAFF_INITIAL_STATE}>
        <MarksEntry batchRef={SERVER_BATCH.ref} initialBatch={SERVER_BATCH} />
      </StaffContextProvider>,
    );
    expect(screen.getByText("Marks entry")).toBeInTheDocument();
    expect(getBatch).not.toHaveBeenCalled();
    await waitFor(() => expect(listVersions).toHaveBeenCalledOnce());
  });

  it("trusts an authoritative null publication while demo mode still refreshes", async () => {
    const [context, students, summary] = await Promise.all([
      familyContextService.getContext(DEMO_GUARDIAN_ACCOUNT_ID),
      familyContextService.listAccessibleStudentContexts(DEMO_GUARDIAN_ACCOUNT_ID),
      familyContextService.getAccountSummary(DEMO_GUARDIAN_ACCOUNT_ID),
    ]);
    const initialState = { context, students, guardianName: summary.displayName };
    vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    const getPublication = vi.spyOn(academicsService, "getPublication").mockResolvedValue(null);
    vi.spyOn(academicsService, "getStudentResultSnapshot").mockResolvedValue(null);

    const serverView = render(
      <FamilyContextProvider initialState={initialState}>
        <PublicationPageClient publicationRef="PUB-MISSING" initialPublication={null} />
      </FamilyContextProvider>,
    );
    await screen.findByRole("heading", { name: "Report not found" });
    expect(getPublication).not.toHaveBeenCalled();
    serverView.unmount();

    vi.stubEnv("FASS_DATA_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "demo");
    render(
      <FamilyContextProvider initialState={initialState}>
        <PublicationPageClient publicationRef="PUB-MISSING" initialPublication={null} />
      </FamilyContextProvider>,
    );
    await waitFor(() => expect(getPublication).toHaveBeenCalledOnce());
  });
});

describe("MarksEntry result_entry_officer scope (class + subject)", () => {
  it("allows result_entry_officer entry even when the batch subject does not match any assignment", async () => {
    sessionSet(STAFF_SESSION_KEYS.identity, RESULT_ENTRY_ACCOUNT_ID);
    await staffContextService.setActiveWorkspace(RESULT_ENTRY_ACCOUNT_ID, RESULT_ENTRY_GRANT_ID);
    /* Synthetic batch: the real fixture RB-2026-0138 is 8-A · Mathematics.
       The result_entry_officer role is not scoped by teaching assignments,
       so entry is allowed even with a subject swap. */
    const outOfSubjectScope: EntryBatch = {
      ref: "RB-2026-0138",
      exam: "Term 1",
      className: "8-A",
      subject: "General Science",
      status: "draft",
      rows: [],
      totalsIncomplete: true,
      version: 1,
    };
    render(
      <StaffContextProvider>
        <MarksEntry batchRef="RB-2026-0138" initialBatch={outOfSubjectScope} />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByText("Marks entry")).toBeTruthy(), { timeout: 5_000 });
    expect(screen.queryByText("Outside your assignments")).toBeNull();
  });

  it("opens the workspace for result_entry_officer when class and subject are both assigned", async () => {
    sessionSet(STAFF_SESSION_KEYS.identity, RESULT_ENTRY_ACCOUNT_ID);
    await staffContextService.setActiveWorkspace(RESULT_ENTRY_ACCOUNT_ID, RESULT_ENTRY_GRANT_ID);
    const batch = await academicsService.getBatch("RB-2026-0138");
    expect(batch).not.toBeNull();
    render(
      <StaffContextProvider>
        <MarksEntry batchRef="RB-2026-0138" initialBatch={batch!} />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByText("Marks entry")).toBeTruthy(), { timeout: 5_000 });
    expect(screen.queryByText("Outside your assignments")).toBeNull();
  });
});
