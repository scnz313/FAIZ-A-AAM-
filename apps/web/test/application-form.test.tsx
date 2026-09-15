/**
 * ApplicationForm component tests. Step 1 renders, validation blocks an
 * empty submit, filling the required fields advances to step 2, and —
 * the P0-A regression guard — the "Save & continue →" button lives
 * inside the <form> so submit actually runs the validation handler.
 *
 * The final test covers the submit path: the eight-step form is filled
 * end to end and submitted through the admissions demo adapter, which
 * issues the deterministic reference APP-2026-0424 and routes to its
 * status page. (Previously the submit path was async-free; queries now
 * wait for the adapter latency with findBy/waitFor.)
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ApplicationForm, { selectAdmissionWindowRequirements } from "@/components/applicant/ApplicationForm";
import { admissionsService } from "@/modules/services/admissions";
import { DEMO_ADMISSION_CONFIGURATION, schoolConfigService, type AdmissionConfiguration } from "@/modules/services/school-config";

const { pushMock, replaceMock, uploadDocumentFileMock, getDocumentUploadStatusMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  uploadDocumentFileMock: vi.fn(),
  getDocumentUploadStatusMock: vi.fn(),
}));

vi.mock("@/modules/services/document-upload", () => ({
  uploadDocumentFile: uploadDocumentFileMock,
  getDocumentUploadStatus: getDocumentUploadStatusMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    prefetch: vi.fn(),
    replace: replaceMock,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/apply/student",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  /* The tab-session draft must not leak between tests. */
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/apply/student");
  pushMock.mockClear();
  replaceMock.mockClear();
  uploadDocumentFileMock.mockReset();
  getDocumentUploadStatusMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ApplicationForm", () => {
  it("renders step 1 with the Save & continue control", () => {
    render(<ApplicationForm />);

    expect(screen.getByRole("heading", { name: "Academic" })).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Save & continue →" });
    expect(continueButton).toBeInTheDocument();
    expect(continueButton).toHaveAttribute("type", "submit");
  });

  it("associates the Save & continue button with the form (P0-A CTA guard)", () => {
    const { container } = render(<ApplicationForm />);

    const continueButton = screen.getByRole("button", { name: "Save & continue →" });
    expect(continueButton.closest("form")).not.toBeNull();
    /* The form lives in the same section as the action bar. */
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("shows validation errors when step 1 is submitted empty", async () => {
    const user = userEvent.setup();
    render(<ApplicationForm />);

    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Please check the highlighted fields.");
    expect(screen.getByText("Select the academic session.")).toBeInTheDocument();
    expect(screen.getByText("Select the class you are applying for.")).toBeInTheDocument();
    expect(document.querySelectorAll(".field-error").length).toBeGreaterThanOrEqual(2);
    /* Still on step 1. */
    expect(screen.getByRole("heading", { name: "Academic" })).toBeInTheDocument();
  });

  it("advances to step 2 after the required fields are filled", async () => {
    const user = userEvent.setup();
    render(<ApplicationForm />);

    await user.selectOptions(screen.getByLabelText(/^Academic session/), "2026-27");
    await user.selectOptions(screen.getByLabelText(/^Class /), "Class 6");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    expect(screen.getByRole("heading", { name: "Student details" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Full name/)).toBeInTheDocument();
  });

  it("submits the completed form through the admissions service and routes to the issued reference", async () => {
    const user = userEvent.setup();
    render(<ApplicationForm />);

    /* Step 1 — academic */
    await user.selectOptions(screen.getByLabelText(/^Academic session/), "2026-27");
    await user.selectOptions(screen.getByLabelText(/^Class /), "Class 6");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 2 — student details */
    await user.type(screen.getByLabelText(/^Full name/), "Demo Student");
    await user.type(screen.getByLabelText(/^Date of birth/), "2014-04-10");
    await user.selectOptions(screen.getByLabelText(/^Gender/), "Female");
    await user.type(screen.getByLabelText(/^Place of birth/), "Bandipora");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 3 — guardian */
    await user.type(screen.getByLabelText(/^Parent \/ guardian name/), "Demo Guardian");
    await user.selectOptions(screen.getByLabelText(/^Relationship to the student/), "Father");
    await user.type(screen.getByLabelText(/^Phone/), "+919000000000");
    await user.type(screen.getByLabelText(/^Email/), "demo@example.com");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 4 — address */
    await user.type(screen.getByLabelText(/^House & street/), "Main Road");
    await user.type(screen.getByLabelText(/^Village \/ town/), "Bandipora");
    await user.type(screen.getByLabelText(/^District/), "Bandipora");
    await user.type(screen.getByLabelText(/^PIN code/), "193502");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 5 — prior school */
    await user.type(screen.getByLabelText(/^Current or last school/), "Demo High School");
    await user.selectOptions(screen.getByLabelText(/^Class last attended/), "Class 5");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 6 — medical */
    await user.click(screen.getByLabelText(/None · nothing to declare/));
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 7 — documents */
    await user.upload(screen.getByLabelText(/^Birth certificate/), new File(["x"], "birth.pdf", { type: "application/pdf" }));
    await user.upload(screen.getByLabelText(/^Student photograph/), new File(["x"], "photo.jpg", { type: "image/jpeg" }));
    await user.upload(screen.getByLabelText(/^Previous report card/), new File(["x"], "report.pdf", { type: "application/pdf" }));
    await user.upload(screen.getByLabelText(/^Address proof/), new File(["x"], "address.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 8 — review & declaration */
    await user.click(screen.getByLabelText(/I have read the declaration/));
    await user.click(screen.getByRole("button", { name: "Submit application" }));

    /* The demo adapter issues the first deterministic reference (session
       counter seeded at 424) and the form routes to its status page. */
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/apply/student/APP-2026-0424/status");
    });
  });

  it("serializes rapid autosaves and an upload into one server draft (supabase mode)", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.spyOn(schoolConfigService, "getAdmissionConfiguration").mockResolvedValue(DEMO_ADMISSION_CONFIGURATION);
    uploadDocumentFileMock.mockResolvedValue({ documentRef: "DOC-2026-0001", status: "pending_scan" });

    /* The first save is held in flight while the journey keeps editing and
       then uploads: the old code issued a second "new" save in that window. */
    const savedKeys: string[] = [];
    let releaseFirstSave: (() => void) | undefined;
    const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    vi.spyOn(admissionsService, "saveDraft").mockImplementation(async (key) => {
      savedKeys.push(key);
      if (savedKeys.length === 1) await firstSaveGate;
      return { savedAtIso: "2026-08-10T05:00:00.000Z", draftRef: "APP-2026-DRAFT-0001" };
    });

    const user = userEvent.setup();
    const view = render(<ApplicationForm />);

    /* Supabase mode starts without a configuration; wait for the fetched one. */
    await waitFor(() => expect(screen.getByRole("option", { name: "Session 2026-27" })).toBeInTheDocument());

    /* Steps 1-3 — the fields a server draft needs, edited rapidly. */
    await user.selectOptions(screen.getByLabelText(/^Academic session/), "2026-27");
    await user.selectOptions(screen.getByLabelText(/^Class /), "Class 6");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));
    await user.type(screen.getByLabelText(/^Full name/), "Demo Student");
    await user.type(screen.getByLabelText(/^Date of birth/), "2014-04-10");
    await user.selectOptions(screen.getByLabelText(/^Gender/), "Female");
    await user.type(screen.getByLabelText(/^Place of birth/), "Bandipora");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));
    await user.type(screen.getByLabelText(/^Parent \/ guardian name/), "Demo Guardian");
    await user.selectOptions(screen.getByLabelText(/^Relationship to the student/), "Father");
    await user.type(screen.getByLabelText(/^Phone/), "+919000000000");
    await user.type(screen.getByLabelText(/^Email/), "demo@example.com");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* The debounced autosave starts and is held in flight. */
    await waitFor(() => expect(savedKeys).toEqual(["new"]), { timeout: 3000 });

    /* Steps 4-6 while the first save is still in flight. */
    await user.type(screen.getByLabelText(/^House & street/), "Main Road");
    await user.type(screen.getByLabelText(/^Village \/ town/), "Bandipora");
    await user.type(screen.getByLabelText(/^District/), "Bandipora");
    await user.type(screen.getByLabelText(/^PIN code/), "193502");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));
    await user.type(screen.getByLabelText(/^Current or last school/), "Demo High School");
    await user.selectOptions(screen.getByLabelText(/^Class last attended/), "Class 5");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));
    await user.click(screen.getByLabelText(/None · nothing to declare/));
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* The upload queues behind the in-flight save instead of creating a
       second draft. */
    await user.upload(screen.getByLabelText(/^Birth certificate/), new File(["x"], "birth.pdf", { type: "application/pdf" }));
    expect(savedKeys).toEqual(["new"]);

    await act(async () => {
      releaseFirstSave?.();
    });
    await waitFor(() => {
      expect(uploadDocumentFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ ownerRecordRef: "APP-2026-DRAFT-0001" }),
      );
    });

    /* Exactly one draft was created: only the first save named "new", and
       every later save reused the reference it returned. */
    expect(savedKeys[0]).toBe("new");
    expect(savedKeys.filter((key) => key === "new")).toHaveLength(1);
    expect(savedKeys.length).toBeGreaterThan(1);
    expect(savedKeys.slice(1).every((key) => key === "APP-2026-DRAFT-0001")).toBe(true);

    view.unmount();
  });

  it("shows a failed document upload in the documents step instead of failing silently (supabase mode)", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.spyOn(schoolConfigService, "getAdmissionConfiguration").mockResolvedValue(DEMO_ADMISSION_CONFIGURATION);
    vi.spyOn(admissionsService, "saveDraft").mockResolvedValue({ savedAtIso: "2026-08-10T05:00:00.000Z", draftRef: "APP-2026-DRAFT-0001" });
    uploadDocumentFileMock.mockRejectedValue(new Error("The uploaded object does not match its authorized type or size."));

    const user = userEvent.setup();
    render(<ApplicationForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Session 2026-27" })).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText(/^Academic session/), "2026-27");
    await user.selectOptions(screen.getByLabelText(/^Class /), "Class 6");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));
    await user.type(screen.getByLabelText(/^Full name/), "Demo Student");
    await user.type(screen.getByLabelText(/^Date of birth/), "2014-04-10");
    await user.selectOptions(screen.getByLabelText(/^Gender/), "Female");
    await user.type(screen.getByLabelText(/^Place of birth/), "Bandipora");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));
    await user.type(screen.getByLabelText(/^Parent \/ guardian name/), "Demo Guardian");
    await user.selectOptions(screen.getByLabelText(/^Relationship to the student/), "Father");
    await user.type(screen.getByLabelText(/^Phone/), "+919000000000");
    await user.type(screen.getByLabelText(/^Email/), "demo@example.com");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));
    await user.type(screen.getByLabelText(/^House & street/), "Main Road");
    await user.type(screen.getByLabelText(/^Village \/ town/), "Bandipora");
    await user.type(screen.getByLabelText(/^District/), "Bandipora");
    await user.type(screen.getByLabelText(/^PIN code/), "193502");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));
    await user.type(screen.getByLabelText(/^Current or last school/), "Demo High School");
    await user.selectOptions(screen.getByLabelText(/^Class last attended/), "Class 5");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));
    await user.click(screen.getByLabelText(/None · nothing to declare/));
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    await user.upload(screen.getByLabelText(/^Birth certificate/), new File(["x"], "birth.pdf", { type: "application/pdf" }));

    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent("The uploaded object does not match its authorized type or size.");
    expect(screen.getByLabelText(/^Birth certificate/)).toHaveAttribute("aria-invalid", "true");
  });

  it("names a resumed draft as a draft, and a submitted record as a resubmission (supabase mode)", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.spyOn(schoolConfigService, "getAdmissionConfiguration").mockResolvedValue(DEMO_ADMISSION_CONFIGURATION);
    vi.spyOn(admissionsService, "getDraft").mockResolvedValue({
      session: "2026-27",
      grade: "Class 6",
      studentName: "Draft Student",
      dob: "",
      gender: "",
      placeOfBirth: "",
      guardianName: "",
      relation: "",
      phone: "",
      email: "",
      occupation: "",
      houseStreet: "",
      villageTown: "",
      district: "",
      pin: "",
      priorSchoolName: "",
      lastClassAttended: "",
      leavingCertificate: "",
      conditions: [],
      documents: { birth: "DOC-2026-RESTORE" },
      consent: false,
    });
    getDocumentUploadStatusMock.mockResolvedValue({ documentRef: "DOC-2026-RESTORE", state: "ready", checksumVerified: true });
    vi.spyOn(admissionsService, "getApplication").mockResolvedValue({
      ref: "APP-2026-DRAFT-0001",
      session: "2026-27",
      grade: "Class 6",
      studentName: "Draft Student",
      parentName: "Draft Guardian",
      contact: "+919000000000",
      submittedAtIso: "2026-08-10T05:00:00.000Z",
      status: "Draft",
      timeline: [],
    });
    window.history.replaceState(null, "", "/apply/student?edit=APP-2026-DRAFT-0001");

    const view = render(<ApplicationForm />);

    expect(await screen.findByText(/Editing draft/)).toHaveTextContent("APP-2026-DRAFT-0001");
    expect(screen.getByText(/answers save to your account as you go/)).toBeInTheDocument();
    /* A saved draft resumes on its first incomplete section, not the start. */
    expect(screen.getByRole("heading", { name: "Student details" })).toBeInTheDocument();
    /* Attached document scans are re-checked on resume instead of blocking. */
    await waitFor(() => expect(getDocumentUploadStatusMock).toHaveBeenCalledWith("DOC-2026-RESTORE"));
    view.unmount();

    vi.spyOn(admissionsService, "getApplication").mockResolvedValue({
      ref: "APP-2026-CORRECT-0001",
      session: "2026-27",
      grade: "Class 6",
      studentName: "Corrected Student",
      parentName: "Corrected Guardian",
      contact: "+919000000001",
      submittedAtIso: "2026-08-10T05:00:00.000Z",
      status: "Changes requested",
      timeline: [],
    });
    vi.spyOn(admissionsService, "getDraft").mockResolvedValue(null);
    window.history.replaceState(null, "", "/apply/student?edit=APP-2026-CORRECT-0001");
    render(<ApplicationForm />);

    expect(await screen.findByText(/Editing application/)).toHaveTextContent("APP-2026-CORRECT-0001");
    expect(screen.getByText(/re-submitted for review/)).toBeInTheDocument();
  });

  it("restores the submitted snapshot (answers and attachments) when editing a requested-change application (supabase mode)", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.spyOn(schoolConfigService, "getAdmissionConfiguration").mockResolvedValue(DEMO_ADMISSION_CONFIGURATION);
    /* The applicant opened the edit page before the fix and a partial draft
       was autosaved; that draft must not erase the submitted answers. */
    vi.spyOn(admissionsService, "getDraft").mockResolvedValue({
      session: "2026-27",
      grade: "Class 6",
      studentName: "Corrected Student",
      dob: "",
      gender: "",
      placeOfBirth: "",
      guardianName: "Corrected Guardian",
      relation: "",
      phone: "+919000000001",
      email: "",
      occupation: "",
      houseStreet: "",
      villageTown: "",
      district: "",
      pin: "",
      priorSchoolName: "",
      lastClassAttended: "",
      leavingCertificate: "",
      conditions: [],
      documents: {},
      consent: false,
    });
    getDocumentUploadStatusMock.mockResolvedValue({ documentRef: "DOC-2026-OLD-BIRTH", state: "ready", checksumVerified: true });
    vi.spyOn(admissionsService, "getApplication").mockResolvedValue({
      ref: "APP-2026-CORRECT-0002",
      session: "2026-27",
      grade: "Class 6",
      studentName: "Corrected Student",
      parentName: "Corrected Guardian",
      contact: "+919000000001",
      submittedAtIso: "2026-08-10T05:00:00.000Z",
      status: "Changes requested",
      timeline: [],
      versions: [
        {
          version: 1,
          schemaVersion: 1,
          submittedAtIso: "2026-08-10T05:00:00.000Z",
          snapshot: {
            session: "2026-27",
            grade: "Class 6",
            studentName: "Corrected Student",
            dob: "2014-04-10",
            gender: "Female",
            placeOfBirth: "Bandipora",
            guardianName: "Corrected Guardian",
            relation: "Mother",
            phone: "+919000000001",
            email: "guardian@example.com",
            occupation: "Tailor",
            houseStreet: "Main Road",
            villageTown: "Bandipora",
            district: "Bandipora",
            pin: "193502",
            priorSchoolName: "Demo High School",
            lastClassAttended: "Class 5",
            leavingCertificate: "",
            conditions: ["none"],
            documents: { birth: "DOC-2026-OLD-BIRTH" },
            consent: true,
          },
        },
      ],
    });
    window.history.replaceState(null, "", "/apply/student?edit=APP-2026-CORRECT-0002");

    render(<ApplicationForm />);

    expect(await screen.findByText(/Editing application/)).toHaveTextContent("APP-2026-CORRECT-0002");
    /* Every earlier answer is restored, so the form resumes on review. */
    expect(await screen.findByRole("heading", { name: "Review & declaration" })).toBeInTheDocument();
    expect(screen.getByText("2014-04-10")).toBeInTheDocument();
    expect(screen.getByText("Main Road")).toBeInTheDocument();
    expect(screen.getByText("Demo High School")).toBeInTheDocument();
    expect(screen.getByText(/Attached · DOC-2026-OLD-BIRTH/)).toBeInTheDocument();
    /* The attached scan is re-checked and the declaration is re-asked. */
    await waitFor(() => expect(getDocumentUploadStatusMock).toHaveBeenCalledWith("DOC-2026-OLD-BIRTH"));
    expect(screen.getByLabelText(/I have read the declaration/)).not.toBeChecked();
  });

  it("sends a submitted application opened through a stale ?edit= URL to its tracking page (supabase mode)", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.spyOn(schoolConfigService, "getAdmissionConfiguration").mockResolvedValue(DEMO_ADMISSION_CONFIGURATION);
    vi.spyOn(admissionsService, "getDraft").mockResolvedValue(null);
    const saveDraft = vi.spyOn(admissionsService, "saveDraft").mockResolvedValue({ savedAtIso: "2026-08-10T05:00:00.000Z" });
    vi.spyOn(admissionsService, "getApplication").mockResolvedValue({
      ref: "APP-2026-SUBMITTED-0001",
      session: "2026-27",
      grade: "Class 6",
      studentName: "Submitted Student",
      parentName: "Submitted Guardian",
      contact: "+919000000001",
      submittedAtIso: "2026-08-10T05:00:00.000Z",
      status: "Submitted",
      timeline: [],
    });
    window.history.replaceState(null, "", "/apply/student?edit=APP-2026-SUBMITTED-0001");

    render(<ApplicationForm />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/apply/student/APP-2026-SUBMITTED-0001/status"),
    );
    /* No conflict save is attempted on the way out. */
    expect(saveDraft).not.toHaveBeenCalled();
  });
});

describe("selectAdmissionWindowRequirements", () => {
  const configuration: AdmissionConfiguration = {
    academicYears: [{ id: "year-2026", ref: "YR-2026", label: "2026–27", startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current" }],
    grades: [
      { id: "grade-6", ref: "6", code: "6", label: "Class 6", sortOrder: 6 },
      { id: "grade-8", ref: "8", code: "8", label: "Class 8", sortOrder: 8 },
    ],
    windows: [
      { id: "window-6", ref: "W-6", academicYearId: "year-2026", gradeId: "grade-6", opensAtIso: "2026-08-01T00:00:00.000Z", closesAtIso: "2026-10-31T00:00:00.000Z", capacity: 60, status: "open", version: 1, policy: {}, eligibilityPolicy: {} },
      { id: "window-8", ref: "W-8", academicYearId: "year-2026", gradeId: "grade-8", opensAtIso: "2026-08-01T00:00:00.000Z", closesAtIso: "2026-10-31T00:00:00.000Z", capacity: 60, status: "open", version: 1, policy: {}, eligibilityPolicy: {} },
    ],
    documentRequirements: [
      { id: "req-6-birth", ref: "R-6-B", windowId: "window-6", code: "birth", label: "Birth certificate", required: true, allowedMimeTypes: ["application/pdf"], maxBytes: 1024, status: "active", version: 1 },
      { id: "req-8-report", ref: "R-8-R", windowId: "window-8", code: "reportCard", label: "Previous report card", required: true, allowedMimeTypes: ["application/pdf"], maxBytes: 1024, status: "active", version: 1 },
      { id: "req-8-archived", ref: "R-8-A", windowId: "window-8", code: "photo", label: "Student photograph", required: true, allowedMimeTypes: ["image/png"], maxBytes: 1024, status: "archived", version: 1 },
    ],
    policy: null,
  };

  it("returns only the active requirements of the window for the chosen class and session", () => {
    expect(selectAdmissionWindowRequirements(configuration, "Class 8", "2026-27").map((requirement) => requirement.id)).toEqual(["req-8-report"]);
    expect(selectAdmissionWindowRequirements(configuration, "Class 6", "2026–27").map((requirement) => requirement.id)).toEqual(["req-6-birth"]);
  });

  it("returns nothing for an unconfigured class, an empty selection, or missing configuration", () => {
    expect(selectAdmissionWindowRequirements(configuration, "Class 10", "2026-27")).toEqual([]);
    expect(selectAdmissionWindowRequirements(configuration, "", "")).toEqual([]);
    expect(selectAdmissionWindowRequirements(null, "Class 8", "2026-27")).toEqual([]);
  });
});
