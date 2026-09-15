/**
 * Portal robustness regressions (11 September 2026):
 * - failed reads must surface error + retry, never permanent loading lines or
 *   honest-looking empty states;
 * - released reports never fabricate a publication timestamp;
 * - a child switch clears the outgoing child's projections before the new
 *   one resolves;
 * - the live timetable renders the real published version and "today".
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
}));

import DocumentsPage from "@/app/portal/documents/page";
import PortalError from "@/app/portal/error";
import ProfilePage from "@/app/portal/profile/page";
import SupportPage from "@/app/portal/support/page";
import { FeeLedger } from "@/app/portal/fees/FeeLedger";
import { PortalShell } from "@/components/layouts/PortalShell";
import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { ChildOverviewRows } from "@/components/portal/ChildOverviewRows";
import { ReceiptPanel } from "@/components/portal/ReceiptPanel";
import { FamilyContextProvider, useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { OverviewFinanceBand } from "@/components/portal/OverviewFinanceBand";
import { PublicationPageClient } from "@/components/portal/PublicationPageClient";
import { ResultsPageClient } from "@/components/portal/ResultsPageClient";
import { TimetablePageClient } from "@/components/portal/TimetablePageClient";
import { setDemoNow } from "@/modules/demo/clock";
import { academicsService, type Publication } from "@/modules/services/academics";
import { documentsService } from "@/modules/services/documents";
import { familyContextService, DEMO_GUARDIAN_ACCOUNT_ID, RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import { financeService, type Invoice, type InvoiceView, type Receipt } from "@/modules/services/finance";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const SECTION_ID = "00000000-0000-4000-8000-00000000b801";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-00000000c801";
const SUBJECT_ID = "00000000-0000-4000-8000-00000000c802";
const ROOM_ID = "00000000-0000-4000-8000-00000000c803";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

async function familyInitialState() {
  const [context, students, summary] = await Promise.all([
    familyContextService.getContext(DEMO_GUARDIAN_ACCOUNT_ID),
    familyContextService.listAccessibleStudentContexts(DEMO_GUARDIAN_ACCOUNT_ID),
    familyContextService.getAccountSummary(DEMO_GUARDIAN_ACCOUNT_ID),
  ]);
  return { context, students, guardianName: summary.displayName };
}

function stubSupabaseMode(): void {
  vi.stubEnv("FASS_DATA_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function invoiceView(studentId: string, balancePaise: number): InvoiceView {
  return {
    invoice: {
      ref: `INV-${studentId.slice(-4)}`,
      term: "Term 1",
      issuedAtIso: "2026-08-01T06:00:00.000Z",
      dueAtIso: "2026-09-01T00:00:00.000Z",
      status: balancePaise > 0 ? "unpaid" : "paid",
      items: [],
      payments: [],
    },
    studentId,
    studentName: "Child",
    status: balancePaise > 0 ? "unpaid" : "paid",
    version: 1,
    totalPaise: balancePaise,
    paidPaise: 0,
    balancePaise,
    payments: [],
    receipts: [],
    ledgerEntries: [],
  } as unknown as InvoiceView;
}

beforeEach(() => {
  setDemoNow(PINNED);
  window.sessionStorage.clear();
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
});

afterEach(() => {
  setDemoNow(null);
  window.sessionStorage.clear();
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("academics service error honesty", () => {
  it("rejects released-report reads instead of returning an empty list", async () => {
    stubSupabaseMode();
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, errors: [{ code: "unavailable", message: "results offline", field: null }] }, 503)));

    await expect(academicsService.getPublications()).rejects.toThrow(/results offline/);
    await expect(academicsService.getStudentResultSnapshot("STU-1", "AY-1")).rejects.toThrow(/results offline/);
  });

  it("maps a release without a publication timestamp to null, never a fabricated date", async () => {
    stubSupabaseMode();
    vi.stubGlobal("fetch", vi.fn(async () => json({
      ok: true,
      value: [{ id: "00000000-0000-4000-8000-000000000001", reference: "PUB-1", term: "Term 1", version: 1, status: "final" }],
    })));

    const publications = await academicsService.getPublications();
    expect(publications[0]?.publishedAtIso).toBeNull();
  });
});

describe("guardian overview finance band", () => {
  it("surfaces a failed ledger read with retry instead of a permanent loading line", async () => {
    const initialState = await familyInitialState();
    const mock = vi.spyOn(financeService, "listInvoices")
      .mockRejectedValueOnce(new Error("ledger offline"))
      .mockResolvedValueOnce([]);

    render(
      <FamilyContextProvider initialState={initialState}>
        <OverviewFinanceBand />
      </FamilyContextProvider>,
    );

    await screen.findAllByText("Ledger unavailable");
    expect(screen.queryByText("Loading ledger…")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    await screen.findByText("0 invoices outstanding");
    expect(screen.queryByText("Ledger unavailable")).toBeNull();
  });

  it("clears the outgoing child's figures the moment the active child switches", async () => {
    const initialState = await familyInitialState();
    const [first, second] = initialState.students;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    const secondId = second.student.id;
    const secondLedger = deferred<InvoiceView[]>();
    const mock = vi.spyOn(financeService, "listInvoices").mockImplementation((studentId?: string) => {
      if (studentId === first.student.id) return Promise.resolve([invoiceView(first.student.id, 100_000)]);
      return secondLedger.promise;
    });

    function SwitchProbe() {
      const { switchStudent } = useFamilyContext();
      return (
        <button type="button" onClick={() => void switchStudent(secondId)}>
          Switch child
        </button>
      );
    }

    const user = userEvent.setup();
    render(
      <FamilyContextProvider initialState={initialState}>
        <OverviewFinanceBand />
        <SwitchProbe />
      </FamilyContextProvider>,
    );

    await screen.findByText("₹1,000");
    await user.click(screen.getByRole("button", { name: "Switch child" }));

    /* The previous child's balance must vanish immediately; the band shows its
       loading state until the new child's ledger resolves. */
    await waitFor(() => expect(screen.queryByText("₹1,000")).toBeNull());
    expect(screen.getAllByText("Loading ledger…").length).toBeGreaterThan(0);
    expect(mock).toHaveBeenCalledWith(secondId);

    secondLedger.resolve([invoiceView(second.student.id, 25_000)]);
    await screen.findByText("₹250");
  });
});

describe("guardian fee ledger state honesty", () => {
  it("replaces the ledger with a retryable error when a child switch reload fails, never the previous child's rows", async () => {
    const initialState = await familyInitialState();
    const [first, second] = initialState.students;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    const secondId = second.student.id;
    const mock = vi.spyOn(financeService, "listInvoices")
      .mockResolvedValueOnce([invoiceView(first.student.id, 100_000)])
      .mockRejectedValueOnce(new Error("ledger offline"))
      .mockResolvedValueOnce([]);

    function SwitchProbe() {
      const { switchStudent } = useFamilyContext();
      return (
        <button type="button" onClick={() => void switchStudent(secondId)}>
          Switch child
        </button>
      );
    }

    const user = userEvent.setup();
    render(
      <FamilyContextProvider initialState={initialState}>
        <FeeLedger initial={[]} initialFilter="all" />
        <SwitchProbe />
      </FamilyContextProvider>,
    );

    expect((await screen.findAllByText(/₹1,000/)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Switch child" }));

    await screen.findByText("The fee ledger could not be loaded");
    expect(screen.queryByText(/₹1,000/)).toBeNull();
    expect(mock).toHaveBeenCalledWith(secondId);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("No invoices yet");
    expect(screen.queryByText("The fee ledger could not be loaded")).toBeNull();
  });

  it("opens the invoice from the ledger row while leaving the inner actions in charge", async () => {
    const initialState = await familyInitialState();
    const [first] = initialState.students;
    if (first === undefined) return;
    const view = invoiceView(first.student.id, 100_000);
    vi.spyOn(financeService, "listInvoices").mockResolvedValue([view]);
    routerPush.mockClear();

    render(
      <FamilyContextProvider initialState={initialState}>
        <FeeLedger initial={[view]} initialFilter="all" />
      </FamilyContextProvider>,
    );

    const user = userEvent.setup();
    await screen.findAllByText(/₹1,000/);
    const row = screen.getByText(view.invoice.ref).closest("tr");
    expect(row).not.toBeNull();
    if (row === null) return;

    await user.click(row);
    expect(routerPush).toHaveBeenCalledWith(`/portal/fees/${view.invoice.ref}`);
  });

  it("keeps the filter URL in step when the empty filter state offers Show all invoices", async () => {
    const initialState = await familyInitialState();
    const [first] = initialState.students;
    if (first === undefined) return;
    vi.spyOn(financeService, "listInvoices").mockResolvedValue([invoiceView(first.student.id, 100_000)]);

    render(
      <FamilyContextProvider initialState={initialState}>
        <FeeLedger initial={[invoiceView(first.student.id, 100_000)]} initialFilter="paid" />
      </FamilyContextProvider>,
    );

    await screen.findByText("No invoices match this filter");
    const showAll = screen.getByRole("link", { name: "Show all invoices" });
    expect(showAll).toHaveAttribute("href", "/portal/fees");
  });
});

describe("active child line without an active child", () => {
  it("states that no child is linked instead of claiming a load is still running", async () => {
    const initialState = await familyInitialState();
    vi.spyOn(familyContextService, "getContext").mockResolvedValue({
      ...initialState.context,
      activeStudentId: "00000000-0000-4000-8000-000000000999",
    });

    render(
      <FamilyContextProvider>
        <ActiveChildLine />
      </FamilyContextProvider>,
    );

    await screen.findByText(/No linked child yet/);
    expect(screen.queryByText("Loading linked student…")).toBeNull();
    expect(screen.getByRole("link", { name: /link a child to see their records/ })).toHaveAttribute(
      "href",
      "/portal/link-child",
    );
  });
});

describe("receipt sheet demo labelling", () => {
  const invoice = {
    ref: "INV-2026-0101",
    studentId: null,
    term: "Term 1",
    issuedAtIso: "2026-04-01T06:00:00Z",
    dueAtIso: "2026-04-20T14:00:00Z",
    status: "paid",
    items: [],
    payments: [],
  } as unknown as Invoice;
  const receipt: Receipt = {
    ref: "RC-2026-0102",
    invoiceRef: "INV-2026-0101",
    studentId: null,
    issuedAtIso: "2026-04-05T08:30:00Z",
    method: "UPI",
    amountPaise: 920000,
    counter: "Finance office",
  };

  it("never marks a live receipt projection as demo", () => {
    render(<ReceiptPanel receipt={receipt} invoice={invoice} studentName="Aarif Hussain" live />);
    expect(screen.getByText(/finance office receipt record/)).toBeInTheDocument();
    expect(screen.queryByText(/This is a demo receipt/)).toBeNull();
  });

  it("keeps the demo marker for demo receipts", () => {
    render(<ReceiptPanel receipt={receipt} invoice={invoice} studentName="Aarif Hussain" />);
    expect(screen.getByText(/This is a demo receipt/)).toBeInTheDocument();
  });
});

describe("family context error states", () => {
  beforeEach(() => {
    vi.spyOn(familyContextService, "getContext").mockRejectedValue(new Error("context offline"));
    vi.spyOn(familyContextService, "listAccessibleStudentContexts").mockRejectedValue(new Error("context offline"));
    vi.spyOn(familyContextService, "getAccountSummary").mockRejectedValue(new Error("context offline"));
  });

  it("shows the overview child panel error with retry, not a fabricated empty list", async () => {
    render(
      <FamilyContextProvider>
        <ChildOverviewRows />
      </FamilyContextProvider>,
    );

    await screen.findByText(/The linked children could not be loaded/);
    expect(screen.queryByText(/No linked children yet/)).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows the documents page error state instead of a permanent skeleton", async () => {
    render(
      <FamilyContextProvider>
        <DocumentsPage />
      </FamilyContextProvider>,
    );

    await screen.findByText("Documents unavailable");
    expect(screen.queryByText("Loading documents…")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
  });

  it("shows the profile page error state instead of a permanent loading label", async () => {
    render(
      <FamilyContextProvider>
        <ProfilePage />
      </FamilyContextProvider>,
    );

    await screen.findByText("Your profile could not be loaded");
    expect(screen.queryByText("Loading linked children…")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
  });
});

describe("results error state", () => {
  it("surfaces a failed publications read with retry instead of an empty state", async () => {
    const initialState = await familyInitialState();
    stubSupabaseMode();
    vi.spyOn(academicsService, "getPublications").mockRejectedValue(new Error("results offline"));
    vi.spyOn(academicsService, "getStudentResultSnapshot").mockResolvedValue(null);

    render(
      <FamilyContextProvider initialState={initialState}>
        <ResultsPageClient initialPublications={null} />
      </FamilyContextProvider>,
    );

    await screen.findByText("Results could not be loaded");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows a dash for a missing teacher remark, never the literal None", async () => {
    const initialState = await familyInitialState();
    stubSupabaseMode();
    const publication: Publication = {
      ref: "PUB-REMARK",
      term: "Term 1",
      status: "final",
      publishedAtIso: "2026-06-15T06:00:00Z",
      version: 1,
    };
    vi.spyOn(academicsService, "getPublications").mockResolvedValue([publication]);
    vi.spyOn(academicsService, "getStudentResultSnapshot").mockResolvedValue({
      studentId: initialState.context.activeStudentId ?? "STU-1",
      academicYearId: initialState.context.activeEnrollmentId ?? "AY-1",
      terms: { "Term 1": [{ subject: "Mathematics", max: 100, obtained: 88 }] },
    });

    render(
      <FamilyContextProvider initialState={initialState}>
        <ResultsPageClient initialPublications={[publication]} />
      </FamilyContextProvider>,
    );

    await screen.findByText("Mathematics");
    expect(screen.queryByText("None")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("released report child switch", () => {
  it("re-resolves the release for the new child and never mixes children", async () => {
    const initialState = await familyInitialState();
    stubSupabaseMode();
    const [first, second] = initialState.students;
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    const secondId = second.student.id;
    /* The switch command itself is stubbed so the test exercises the
       component's active-child re-resolution without an adapter round trip. */
    vi.spyOn(familyContextService, "setActiveStudent").mockResolvedValue({
      ...initialState.context,
      activeStudentId: secondId,
      activeEnrollmentId: second.enrollment.id,
    });
    const publication: Publication = {
      ref: "PUB-OLD",
      term: "Term 1",
      status: "final",
      publishedAtIso: "2026-06-15T06:00:00Z",
      version: 1,
    };
    const getPublication = vi.spyOn(academicsService, "getPublication").mockResolvedValue(null);
    vi.spyOn(academicsService, "getStudentResultSnapshot").mockResolvedValue(null);

    function SwitchProbe() {
      const { switchStudent, generation } = useFamilyContext();
      return (
        <>
          <button type="button" onClick={() => void switchStudent(secondId)}>
            Switch child
          </button>
          <p data-testid="gen">{generation}</p>
        </>
      );
    }

    const user = userEvent.setup();
    render(
      <FamilyContextProvider initialState={initialState}>
        <PublicationPageClient publicationRef="PUB-OLD" initialPublication={publication} />
        <SwitchProbe />
      </FamilyContextProvider>,
    );

    await screen.findByText("PUB-OLD");
    await user.click(screen.getByRole("button", { name: "Switch child" }));
    await waitFor(() => expect(screen.getByTestId("gen")).toHaveTextContent("1"));

    await waitFor(() => expect(getPublication).toHaveBeenCalledWith("PUB-OLD"));
    await screen.findByRole("heading", { name: "Report not found" });
    expect(screen.queryByRole("heading", { name: /Term 1 · released report/ })).toBeNull();
    expect(screen.queryByText("No released snapshot for this child")).toBeNull();
  });
});

describe("live timetable honesty", () => {
  const config = {
    gradeSections: [{ id: SECTION_ID, ref: "GS-8-A", gradeLabel: "Class 8", sectionLabel: "A" }],
    subjects: [{ id: SUBJECT_ID, code: "BIO", name: "Biology" }],
    assignments: [{ id: ASSIGNMENT_ID, ref: "SA-8A-BIO", gradeSectionId: SECTION_ID, subjectId: SUBJECT_ID, teacherName: "Z. Qadri" }],
    rooms: [{ id: ROOM_ID, code: "LAB", label: "Biology lab" }],
    periods: [{ dayOfWeek: 1, periodNumber: 1, startsAt: "09:30:00", endsAt: "10:15:00" }],
  };
  const timetable = {
    id: "00000000-0000-4000-8000-00000000c804",
    reference: "TTV-8A-5",
    grade_section_id: SECTION_ID,
    status: "published",
    version: 5,
    effective_from: "2026-09-14",
    effective_to: null,
    created_at: "2026-09-10T08:00:00Z",
    timetable_periods: [{
      day_of_week: 1,
      period_number: 1,
      starts_at: "09:30:00",
      ends_at: "10:15:00",
      subject_id: SUBJECT_ID,
      teacher_assignment_id: ASSIGNMENT_ID,
      room_id: ROOM_ID,
      kind: "class",
      subjects: { name: "Biology" },
      staff_assignments: { staff_members: { people: { display_name: "Z. Qadri" } } },
      rooms: { label: "Biology lab" },
    }],
    timetable_publications: [{ reference: "TTP-8A-5", published_at: "2026-09-10T08:00:00Z", note: "Published Class 8-A timetable" }],
  };

  it("shows the real published version, or a retryable error — never the demo v4 claim", async () => {
    const initialState = await familyInitialState();
    stubSupabaseMode();
    let failEffective = true;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { op: string };
      if (request.op === "config.read") return json({ ok: true, value: config });
      if (request.op === "timetable.effective") {
        if (failEffective) return json({ ok: false, errors: [{ code: "unavailable", message: "timetable offline", field: null }] }, 503);
        return json({ ok: true, value: timetable });
      }
      if (request.op === "timetable.listOverrides") return json({ ok: true, value: [] });
      if (request.op === "timetable.listDateSheets") return json({ ok: true, value: [] });
      return json({ ok: false, errors: [{ code: "unavailable", message: "unexpected operation", field: null }] }, 500);
    }));

    const user = userEvent.setup();
    render(
      <FamilyContextProvider initialState={initialState}>
        <TimetablePageClient todayIso="2026-09-14T05:30:00.000Z" />
      </FamilyContextProvider>,
    );

    await screen.findByText("The timetable could not be loaded");
    expect(document.body.textContent).not.toContain("version 4");

    failEffective = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Showing published v5", { exact: false });
    expect(screen.getByText("Biology")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("version 4");
  });
});

describe("released report download", () => {
  it("resolves the report card by active student id and offers the generated PDF", async () => {
    const initialState = await familyInitialState();
    stubSupabaseMode();
    const child = initialState.students[0]!;
    const publication: Publication = {
      ref: "PUB-DOC",
      term: "Term 1",
      status: "final",
      publishedAtIso: "2026-06-15T06:00:00Z",
      version: 1,
    };
    vi.spyOn(academicsService, "getStudentResultSnapshot").mockResolvedValue({
      studentId: child.student.id,
      academicYearId: initialState.context.activeEnrollmentId ?? "AY-1",
      terms: { "Term 1": [{ subject: "Mathematics", max: 100, obtained: 88 }] },
    });
    const listForStudent = vi.spyOn(documentsService, "listForStudent").mockResolvedValue({
      studentId: child.student.id,
      studentRef: child.student.ref,
      enrollmentRef: child.enrollment.ref,
      gradeSectionLabel: "Class 8-A",
      reportCards: [],
      receipts: [],
      certificates: [],
      metadata: [{
        ref: "DOC-2026-273239B515",
        ownerDomain: "student",
        ownerReference: child.student.ref,
        attachmentCode: null,
        category: "generated_report_card",
        filename: `report-card-${publication.ref}.pdf`,
        processingState: "ready",
        scanState: "ready",
        finalizationState: "verified",
        checksumVerified: true,
        finalizedAtIso: "2026-09-15T16:48:48.552Z",
        retentionUntilIso: null,
        mimeType: "application/pdf",
        sizeBytes: 2148,
        version: 1,
        createdAtIso: null,
        updatedAtIso: null,
        visibility: "private",
      }],
    });

    render(
      <FamilyContextProvider initialState={initialState}>
        <PublicationPageClient publicationRef={publication.ref} initialPublication={publication} />
      </FamilyContextProvider>,
    );

    /* The document boundary takes the student id; passing the public
       reference silently resolved nothing and hid a generated report card. */
    await waitFor(() => expect(listForStudent).toHaveBeenCalledWith(expect.any(String), child.student.id));
    expect(screen.getByRole("button", { name: "Download official report (PDF)" })).toBeEnabled();
  });
});

describe("documents empty report cards", () => {
  it("renders an honest empty state instead of a blank table", async () => {
    const initialState = await familyInitialState();
    const child = initialState.students[0]!;
    vi.spyOn(documentsService, "listForStudent").mockResolvedValue({
      studentId: child.student.id,
      studentRef: child.student.ref,
      enrollmentRef: child.enrollment.ref,
      gradeSectionLabel: "Class 8-A",
      reportCards: [],
      receipts: [],
      certificates: [],
      metadata: [],
    });

    render(
      <FamilyContextProvider initialState={initialState}>
        <DocumentsPage />
      </FamilyContextProvider>,
    );

    await screen.findByText(/No report cards yet/);
  });
});

describe("portal shell child switcher", () => {
  it("describes the student reference (never a claim reference) and returns focus on Escape", async () => {
    const initialState = await familyInitialState();
    render(
      <FamilyContextProvider initialState={initialState}>
        <PortalShell initialNotifications={[]}>
          <div>Workspace content</div>
        </PortalShell>
      </FamilyContextProvider>,
    );

    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: /Your children/ });
    await user.click(trigger);

    expect(screen.getByText("Use the student reference the office issued")).toBeInTheDocument();
    expect(screen.queryByText(/claim reference/)).toBeNull();

    /* APG menu-button pattern: focus enters the menu, arrow keys move
       between the child options. */
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Use the student reference the office issued")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe("portal error boundary", () => {
  it("offers a reset and a safe way back to the overview", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reset = vi.fn();
    render(<PortalError error={new Error("boom")} reset={reset} />);

    expect(screen.getByText("This page could not be loaded")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /Back to overview/ })).toHaveAttribute("href", "/portal");
    consoleError.mockRestore();
  });
});

describe("support contact details", () => {
  it("uses the school's canonical contact number, matching the public contact page", async () => {
    const initialState = await familyInitialState();
    render(
      <FamilyContextProvider initialState={initialState}>
        <SupportPage />
      </FamilyContextProvider>,
    );

    expect(screen.getByText("+91 90000 00000")).toBeInTheDocument();
    expect(screen.queryByText("+91 000 000 0000")).toBeNull();
  });
});
