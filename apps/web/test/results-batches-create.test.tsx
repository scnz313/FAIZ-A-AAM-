/**
 * Component tests for the result-batch creation panel in ResultsBatches:
 * visible only with results.enter, keyboard-accessible selection from the
 * authorized exam definitions, busy state, failure retry, and a success
 * announcement that refreshes the queue.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResultsBatches } from "@/components/staff/ResultsBatches";
import {
  StaffContextProvider,
  STAFF_SESSION_KEYS,
  type StaffContextInitialState,
} from "@/components/staff/StaffContextProvider";
import { setDemoNow } from "@/modules/demo/clock";
import { academicsService, type EntryBatch, type ExamDefinitionOption } from "@/modules/services/academics";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const SESSION_KEY = sessionKey("academics");
const PINNED = "2026-08-10T05:00:00.000Z";

const YEAR_ID = "00000000-0000-4000-8000-000000000602";
const EXAM_ID = "00000000-0000-4000-8000-00000000e101";
const EXAM2_ID = "00000000-0000-4000-8000-00000000e107";
const SECTION_ID = "00000000-0000-4000-8000-00000000e102";
const SECTION2_ID = "00000000-0000-4000-8000-00000000e108";
const SUBJECT_ID = "00000000-0000-4000-8000-00000000e103";
const SUBJECT2_ID = "00000000-0000-4000-8000-00000000e109";

const EXAM_DEFINITIONS: ExamDefinitionOption[] = [
  {
    id: EXAM_ID,
    ref: "EXM-2026-0001",
    term: "midterm",
    status: "open",
    academicYearId: YEAR_ID,
    academicYearLabel: "2026–27",
    academicYearStatus: "current",
    gradeSectionId: SECTION_ID,
    gradeLabel: "Class 8",
    sectionLabel: "A",
    subjects: [
      { id: SUBJECT_ID, code: "MAT", name: "Mathematics" },
      { id: SUBJECT2_ID, code: "SCI", name: "General Science" },
    ],
  },
  {
    id: EXAM2_ID,
    ref: "EXM-2026-0002",
    term: "final",
    status: "planned",
    academicYearId: YEAR_ID,
    academicYearLabel: "2026–27",
    academicYearStatus: "current",
    gradeSectionId: SECTION2_ID,
    gradeLabel: "Class 9",
    sectionLabel: "C",
    subjects: [{ id: SUBJECT2_ID, code: "SCI", name: "General Science" }],
  },
];

const CREATED_BATCH: EntryBatch = {
  ref: "RB-2026-0145",
  exam: "midterm",
  className: "8-A",
  subject: "General Science",
  status: "draft",
  rows: [{ subject: "General Science", max: 100, obtained: null }],
  totalsIncomplete: true,
  version: 1,
};

const PRINCIPAL_STATE: StaffContextInitialState = {
  identityId: "00000000-0000-4000-8000-000000000205",
  workspaces: [{
    id: "00000000-0000-4000-8000-000000000325",
    ref: "RGR-2026-0325",
    accountId: "00000000-0000-4000-8000-000000000205",
    role: "result_entry_officer",
    status: "active",
    grantedByPersonId: null,
    reason: "Fictional results create-panel test grant",
    scope: { academicYearIds: [], gradeSectionIds: [], subjectIds: [] },
    effectiveFromIso: "2026-04-01T00:00:00.000Z",
    effectiveToIso: null,
  }],
  summary: {
    accountId: "00000000-0000-4000-8000-000000000205",
    staffMemberId: "00000000-0000-4000-8000-000000000105",
    personId: "00000000-0000-4000-8000-000000000005",
    displayName: "Rania Mir",
    title: "Principal",
    profileCode: "principal",
    profileLabel: "Principal",
    activeRoleGrantId: "00000000-0000-4000-8000-000000000325",
    role: "result_entry_officer",
    roleLabel: "Result entry officer",
    roles: ["result_entry_officer", "timetable_manager"],
    academicYearLabel: "2026–27",
    assignmentLabel: null,
    grantedWorkspaceCount: 1,
  },
};

const ADMIN_STATE: StaffContextInitialState = {
  identityId: "00000000-0000-4000-8000-000000000204",
  workspaces: [{
    id: "00000000-0000-4000-8000-000000000324",
    ref: "RGR-2026-0324",
    accountId: "00000000-0000-4000-8000-000000000204",
    role: "exam_reviewer",
    status: "active",
    grantedByPersonId: null,
    reason: "Fictional results checking test grant",
    scope: { academicYearIds: [], gradeSectionIds: [], subjectIds: [] },
    effectiveFromIso: "2026-04-01T00:00:00.000Z",
    effectiveToIso: null,
  }],
  summary: {
    accountId: "00000000-0000-4000-8000-000000000204",
    staffMemberId: "00000000-0000-4000-8000-000000000104",
    personId: "00000000-0000-4000-8000-000000000004",
    displayName: "Aisha Lone",
    title: "Administrator",
    profileCode: "administrator",
    profileLabel: "Administrator",
    activeRoleGrantId: "00000000-0000-4000-8000-000000000324",
    role: "exam_reviewer",
    roleLabel: "Exam reviewer",
    roles: ["exam_reviewer", "result_publisher"],
    academicYearLabel: "2026–27",
    assignmentLabel: null,
    grantedWorkspaceCount: 1,
  },
};

beforeEach(() => {
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

function renderQueue(state: StaffContextInitialState) {
  return render(
    <StaffContextProvider initialState={state}>
      <ResultsBatches batches={[]} />
    </StaffContextProvider>,
  );
}

describe("new batch panel access", () => {
  it("shows the New batch control only for a staff profile with results.enter", async () => {
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([]);
    const principal = renderQueue(PRINCIPAL_STATE);
    expect(await screen.findByRole("button", { name: "New batch" })).toBeInTheDocument();
    await screen.findByText("No batches in this view.");
    principal.unmount();

    renderQueue(ADMIN_STATE);
    await screen.findByText("No batches in this view.");
    expect(screen.queryByRole("button", { name: "New batch" })).not.toBeInTheDocument();
  });
});

describe("new batch creation", () => {
  it("creates the selected batch, refreshes the queue, and announces the reference", async () => {
    const user = userEvent.setup();
    const listBatches = vi.spyOn(academicsService, "listBatches").mockResolvedValue([]);
    vi.spyOn(academicsService, "listExamDefinitions").mockResolvedValue({ ok: true, value: EXAM_DEFINITIONS });
    const createBatch = vi.spyOn(academicsService, "createBatch").mockResolvedValue({ ok: true, value: CREATED_BATCH });

    renderQueue(PRINCIPAL_STATE);
    await user.click(await screen.findByRole("button", { name: "New batch" }));

    const panel = await screen.findByRole("heading", { name: "New batch" });
    expect(panel).toBeInTheDocument();
    expect(screen.getByLabelText("Term or exam")).toHaveValue("midterm");
    expect(screen.getByLabelText("Class section")).toHaveValue(EXAM_ID);

    /* Choosing the other term cascades to its section and scoped subjects. */
    await user.selectOptions(screen.getByLabelText("Term or exam"), "final");
    expect(screen.getByLabelText("Class section")).toHaveValue(EXAM2_ID);
    expect(screen.getByLabelText("Subject")).toHaveValue(SUBJECT2_ID);
    expect(within(screen.getByLabelText("Subject")).queryByRole("option", { name: "Mathematics" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Create batch" }));

    await waitFor(() =>
      expect(createBatch).toHaveBeenCalledWith({
        examDefinitionId: EXAM2_ID,
        gradeSectionId: SECTION2_ID,
        subjectId: SUBJECT2_ID,
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText("RB-2026-0145")).toBeInTheDocument();
    expect(await screen.findByText("Created batch RB-2026-0145 for 8-A · General Science.")).toBeInTheDocument();
    await waitFor(() => expect(listBatches.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("heading", { name: "New batch" })).not.toBeInTheDocument();
  });

  it("surfaces a server failure with a retry that keeps the selection", async () => {
    const user = userEvent.setup();
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([]);
    vi.spyOn(academicsService, "listExamDefinitions").mockResolvedValue({ ok: true, value: EXAM_DEFINITIONS });
    const createBatch = vi
      .spyOn(academicsService, "createBatch")
      .mockResolvedValueOnce({
        ok: false,
        errors: [{ subject: null, message: "result entry officer role, aal2, and exact class/subject scope required" }],
      })
      .mockResolvedValueOnce({ ok: true, value: CREATED_BATCH });

    renderQueue(PRINCIPAL_STATE);
    await user.click(await screen.findByRole("button", { name: "New batch" }));
    await screen.findByRole("heading", { name: "New batch" });
    await user.click(screen.getByRole("button", { name: "Create batch" }));

    expect(await screen.findByText("The batch could not be created")).toBeInTheDocument();
    expect(screen.getByText("result entry officer role, aal2, and exact class/subject scope required")).toBeInTheDocument();
    /* The failed selection is preserved for the retry. */
    expect(screen.getByLabelText("Term or exam")).toHaveValue("midterm");
    expect(screen.getByLabelText("Class section")).toHaveValue(EXAM_ID);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("RB-2026-0145")).toBeInTheDocument();
  });

  it("offers a retry when the exam definitions read fails, then loads the options", async () => {
    const user = userEvent.setup();
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([]);
    const listExamDefinitions = vi
      .spyOn(academicsService, "listExamDefinitions")
      .mockResolvedValueOnce({ ok: false, errors: [{ subject: null, message: "exam scope denied" }] })
      .mockResolvedValueOnce({ ok: true, value: EXAM_DEFINITIONS });

    renderQueue(PRINCIPAL_STATE);
    await user.click(await screen.findByRole("button", { name: "New batch" }));

    expect(await screen.findByText("Exam options could not be loaded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(listExamDefinitions).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText("Term or exam")).toHaveValue("midterm");
    expect(screen.getByRole("button", { name: "Create batch" })).toBeEnabled();
  });

  it("opens on a term and section that actually have configured subjects", async () => {
    const user = userEvent.setup();
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([]);
    vi.spyOn(academicsService, "listExamDefinitions").mockResolvedValue({
      ok: true,
      value: [
        { ...EXAM_DEFINITIONS[1]!, id: EXAM2_ID, term: "final", subjects: [] },
        EXAM_DEFINITIONS[0]!,
      ],
    });

    renderQueue(PRINCIPAL_STATE);
    await user.click(await screen.findByRole("button", { name: "New batch" }));

    expect(await screen.findByLabelText("Term or exam")).toHaveValue("midterm");
    expect(screen.getByLabelText("Class section")).toHaveValue(EXAM_ID);
    expect(screen.getByLabelText("Subject")).toHaveValue(SUBJECT_ID);
    expect(screen.getByRole("button", { name: "Create batch" })).toBeEnabled();
  });

  it("lists a component-less term and replaces the dead-end Subject select with an actionable empty state", async () => {
    const user = userEvent.setup();
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([]);
    vi.spyOn(academicsService, "listExamDefinitions").mockResolvedValue({
      ok: true,
      value: [
        EXAM_DEFINITIONS[0]!,
        { ...EXAM_DEFINITIONS[0]!, id: EXAM2_ID, ref: "EXM-2026-0007", term: "final", subjects: [] },
      ],
    });

    renderQueue(PRINCIPAL_STATE);
    await user.click(await screen.findByRole("button", { name: "New batch" }));

    const term = await screen.findByLabelText("Term or exam");
    expect(within(term).getByRole("option", { name: "Final" })).toBeInTheDocument();

    await user.selectOptions(term, "final");

    /* The component-less section is explained with a next step, never a
       silent disabled select. The principal also holds timetable_manager,
       so the guidance links straight to School setup. */
    expect(screen.queryByLabelText("Subject")).not.toBeInTheDocument();
    expect(
      screen.getByText(/No assessment components are configured for Class 8 · A · 2026–27 yet\./),
    ).toBeInTheDocument();
    const setupLink = screen.getByRole("link", { name: "Configure in School setup" });
    expect(setupLink).toHaveAttribute("href", "/principal/school");
    expect(screen.queryByText(/Ask the examination office/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create batch" })).toBeDisabled();

    /* A configured section in another term stays creatable. */
    await user.selectOptions(term, "midterm");
    expect(screen.getByLabelText("Subject")).toHaveValue(SUBJECT_ID);
    expect(screen.getByRole("button", { name: "Create batch" })).toBeEnabled();
  });

  it("keeps the examination-office guidance for staff without academics.configure", async () => {
    const user = userEvent.setup();
    vi.spyOn(academicsService, "listBatches").mockResolvedValue([]);
    vi.spyOn(academicsService, "listExamDefinitions").mockResolvedValue({
      ok: true,
      value: [
        EXAM_DEFINITIONS[0]!,
        { ...EXAM_DEFINITIONS[0]!, id: EXAM2_ID, ref: "EXM-2026-0007", term: "final", subjects: [] },
      ],
    });

    const entryOnly: StaffContextInitialState = {
      ...PRINCIPAL_STATE,
      summary: {
        ...PRINCIPAL_STATE.summary!,
        roles: ["result_entry_officer"],
        role: "result_entry_officer",
        roleLabel: "Result entry officer",
      },
    };
    renderQueue(entryOnly);
    await user.click(await screen.findByRole("button", { name: "New batch" }));

    const term = await screen.findByLabelText("Term or exam");
    await user.selectOptions(term, "final");

    expect(screen.queryByRole("link", { name: "Configure in School setup" })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask the examination office to add them for Final/)).toBeInTheDocument();
  });
});
