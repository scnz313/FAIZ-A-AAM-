import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoleGrant, StaffRole } from "@fass/contracts";
import { STAFF_ROLES } from "@fass/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaffDocumentsWorkspace } from "@/app/staff/documents/StaffDocumentsWorkspace";
import { StaffShell } from "@/components/layouts/StaffShell";
import {
  StaffContextProvider,
  type StaffContextInitialState,
} from "@/components/staff/StaffContextProvider";
import { documentsService, type PrivateDocumentMetadata } from "@/modules/services/documents";
import { canRole } from "@/modules/services/staff-authorization";
import { roleLabel } from "@/modules/services/staff-context";

/** Wrap a fixture list in the paged staff-document shape (000114). */
function staffPage(
  rows: PrivateDocumentMetadata[],
  nextOffset: number | null = null,
): { rows: PrivateDocumentMetadata[]; total: number; nextOffset: number | null } {
  return { rows, total: rows.length, nextOffset };
}

const uploadMocks = vi.hoisted(() => ({ uploadDocumentFile: vi.fn() }));

vi.mock("@/modules/services/document-upload", () => ({
  uploadDocumentFile: uploadMocks.uploadDocumentFile,
}));

const ACCOUNT_ID = "00000000-0000-4000-8000-000000000203";
const STAFF_MEMBER_ID = "00000000-0000-4000-8000-000000000103";
const PERSON_ID = "00000000-0000-4000-8000-000000000003";

vi.mock("next/navigation", () => ({
  usePathname: () => "/staff/documents",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/layouts/NotificationBell", () => ({
  NotificationBell: () => null,
}));

function grant(role: StaffRole, index = 1): RoleGrant {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ref: `RGR-2026-${String(index).padStart(4, "0")}`,
    accountId: ACCOUNT_ID,
    role,
    status: "active",
    grantedByPersonId: null,
    reason: "Fictional document workspace test grant",
    scope: { academicYearIds: [], gradeSectionIds: [], subjectIds: [] },
    effectiveFromIso: "2026-04-01T00:00:00.000Z",
    effectiveToIso: null,
  };
}

function initialState(role: StaffRole, roles: StaffRole[] = [role]): StaffContextInitialState {
  const workspaces = roles.map((workspaceRole, index) => grant(workspaceRole, index + 1));
  const active = workspaces.find((workspace) => workspace.role === role)!;
  return {
    identityId: ACCOUNT_ID,
    workspaces,
    summary: {
      accountId: ACCOUNT_ID,
      staffMemberId: STAFF_MEMBER_ID,
      personId: PERSON_ID,
      displayName: "Sana Wani",
      title: "Staff member",
      profileCode: null,
      profileLabel: null,
      activeRoleGrantId: active.id,
      role,
      roleLabel: roleLabel(role),
      roles,
      academicYearLabel: "2026–27",
      assignmentLabel: null,
      grantedWorkspaceCount: workspaces.length,
    },
  };
}

function documentRecord(
  overrides: Partial<PrivateDocumentMetadata> & Pick<PrivateDocumentMetadata, "ref" | "ownerDomain" | "filename">,
): PrivateDocumentMetadata {
  const { ref, ownerDomain, filename, ...optionalOverrides } = overrides;
  return {
    ref,
    ownerDomain,
    ownerReference: null,
    attachmentCode: null,
    category: "evidence",
    filename,
    processingState: "pending",
    scanState: "pending_scan",
    finalizationState: "pending",
    checksumVerified: false,
    finalizedAtIso: null,
    retentionUntilIso: null,
    mimeType: "application/pdf",
    sizeBytes: 24_000,
    version: 1,
    createdAtIso: "2026-08-10T05:00:00.000Z",
    updatedAtIso: "2026-08-10T05:00:00.000Z",
    visibility: "private",
    ...optionalOverrides,
  };
}

function renderWorkspace(role: StaffRole) {
  return render(
    <StaffContextProvider initialState={initialState(role)}>
      <StaffDocumentsWorkspace />
    </StaffContextProvider>,
  );
}

function renderWorkspaceWithRoles(activeRole: StaffRole, roles: StaffRole[]) {
  return render(
    <StaffContextProvider initialState={initialState(activeRole, roles)}>
      <StaffDocumentsWorkspace />
    </StaffContextProvider>,
  );
}

const READY_DOCUMENT = documentRecord({
  ref: "DOC-2026-READY",
  ownerDomain: "school_document",
  ownerReference: "DOC-2026-READY",
  filename: "admission-evidence.pdf",
  processingState: "ready",
  scanState: "clean",
  finalizationState: "verified",
  checksumVerified: true,
  finalizedAtIso: "2026-08-10T05:00:00.000Z",
});

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  uploadMocks.uploadDocumentFile.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("staff document permission", () => {
  it("grants only functional document roles plus the policy-authorized read-only auditor", () => {
    const permitted = STAFF_ROLES.filter((role) => canRole(role, "documents.view"));

    expect(permitted).toEqual([
      "admissions_officer",
      "admissions_approver",
      "finance_officer",
      "finance_approver",
      "result_entry_officer",
      "exam_reviewer",
      "result_publisher",
      "hr_reviewer",
      "hr_approver",
      "auditor",
    ]);
    expect(canRole("teacher", "documents.view")).toBe(false);
    expect(canRole("support_officer", "documents.view")).toBe(false);
    expect(canRole("system_administrator", "documents.view")).toBe(false);
  });

  it("shows the navigation entry only in a document-authorized workspace", () => {
    const authorized = render(
      <StaffContextProvider initialState={initialState("finance_officer")}>
        <StaffShell initialNotifications={[]}>content</StaffShell>
      </StaffContextProvider>,
    );

    expect(screen.getByRole("link", { name: "Documents" })).toHaveAttribute("href", "/administrator/documents");

    authorized.unmount();
    render(
      <StaffContextProvider initialState={initialState("teacher")}>
        <StaffShell initialNotifications={[]}>content</StaffShell>
      </StaffContextProvider>,
    );

    expect(screen.queryByRole("link", { name: "Documents" })).toBeNull();
  });

  it("fails closed without requesting metadata for a disallowed active workspace", () => {
    const listForStaff = vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([]));

    renderWorkspace("teacher");

    expect(screen.getByRole("alert")).toHaveTextContent("This workspace cannot open documents");
    expect(screen.queryByText("Private documents")).toBeNull();
    expect(listForStaff).not.toHaveBeenCalled();
  });
});

describe("staff document processing register", () => {
  it("keeps private rows hidden while the authorized service request is pending", async () => {
    let resolveRecords: (page: { rows: PrivateDocumentMetadata[]; total: number; nextOffset: number | null }) => void = () => undefined;
    const pendingRecords = new Promise<{ rows: PrivateDocumentMetadata[]; total: number; nextOffset: number | null }>((resolve) => {
      resolveRecords = resolve;
    });
    vi.spyOn(documentsService, "listForStaff").mockReturnValue(pendingRecords);

    renderWorkspace("finance_officer");

    expect(screen.getByText("Loading authorized documents…")).toBeInTheDocument();
    expect(screen.queryByText("No authorized documents")).toBeNull();

    await act(async () => {
      resolveRecords(staffPage([]));
    });
    expect(await screen.findByText("No authorized documents")).toBeInTheDocument();
  });

  it("renders every mixed-domain record returned by the database-scoped service", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([
      documentRecord({
        ref: "DOC-2026-ADMISSION",
        ownerDomain: "admission_application",
        ownerReference: "APP-2026-7K4M2Q",
        filename: "admission-evidence.pdf",
        processingState: "ready",
        scanState: "ready",
        finalizationState: "verified",
        checksumVerified: true,
        finalizedAtIso: "2026-08-10T05:00:00.000Z",
      }),
      documentRecord({
        ref: "DOC-2026-JOB",
        ownerDomain: "job_application",
        ownerReference: "JOB-2026-8N5P3R",
        filename: "candidate-credential.pdf",
      }),
    ]));

    renderWorkspace("auditor");

    expect(await screen.findByText("admission-evidence.pdf")).toBeInTheDocument();
    expect(screen.getByText("candidate-credential.pdf")).toBeInTheDocument();
    expect(screen.getByText(/APP-2026-7K4M2Q/)).toBeInTheDocument();
    expect(screen.getByText(/JOB-2026-8N5P3R/)).toBeInTheDocument();
    expect(screen.getByText(/This authorized response contains 2 owner domains/)).toBeInTheDocument();
    expect(screen.getByText(/mixed set is rendered exactly as returned by the database projection/)).toBeInTheDocument();
    expect(screen.getByText(/Auditor access is read-only/)).toBeInTheDocument();
    expect(screen.getAllByText("Finalization")).toHaveLength(2);
    expect(screen.getByText("Awaiting byte verification")).toBeInTheDocument();
  });

  it("shows an honest empty state when the authorized projection returns no records", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([]));

    renderWorkspace("finance_officer");

    expect(await screen.findByText("No authorized documents")).toBeInTheDocument();
    expect(screen.getByText(/demo adapter intentionally exposes no private staff files/i)).toBeInTheDocument();
  });

  it("offers a retry after a recoverable list failure", async () => {
    const listForStaff = vi
      .spyOn(documentsService, "listForStaff")
      .mockRejectedValueOnce(new Error("Authorized document metadata is temporarily unavailable."))
      .mockResolvedValueOnce(staffPage([]));
    const user = userEvent.setup();

    renderWorkspace("admissions_officer");

    expect(await screen.findByText("Documents unavailable")).toBeInTheDocument();
    expect(screen.getByText("Authorized document metadata is temporarily unavailable.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(listForStaff).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No authorized documents")).toBeInTheDocument();
  });

  it("pages the register with an exact total and appends the next page on demand", async () => {
    const second = documentRecord({
      ref: "DOC-2026-SECOND",
      ownerDomain: "student",
      filename: "second-record.pdf",
      processingState: "ready",
      scanState: "clean",
    });
    const listForStaff = vi
      .spyOn(documentsService, "listForStaff")
      .mockResolvedValueOnce({ rows: [READY_DOCUMENT], total: 2, nextOffset: 1 })
      .mockResolvedValueOnce({ rows: [second], total: 2, nextOffset: null });
    const user = userEvent.setup();

    renderWorkspace("finance_officer");

    expect(await screen.findByText("admission-evidence.pdf")).toBeInTheDocument();
    expect(screen.queryByText("second-record.pdf")).toBeNull();
    expect(
      screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Showing 1 of 2 records"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show more documents (1 of 2)" }));

    await waitFor(() => expect(listForStaff).toHaveBeenCalledWith(1));
    expect(await screen.findByText("second-record.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show more documents/ })).toBeNull();
  });
});

describe("staff public register approval", () => {
  it("offers approval only to a workspace that can publish content", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([READY_DOCUMENT]));

    renderWorkspace("auditor");

    expect(await screen.findByText("admission-evidence.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve for public" })).toBeNull();
    expect(screen.queryByText(/Approving for public view/)).toBeNull();
  });

  it("approves a ready document and switches the row to the withdraw action", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([READY_DOCUMENT]));
    const setVisibility = vi
      .spyOn(documentsService, "setPublicVisibility")
      .mockResolvedValue({ ref: READY_DOCUMENT.ref, visibility: "public_approved" });
    const user = userEvent.setup();

    renderWorkspaceWithRoles("auditor", ["auditor", "content_publisher"]);
    expect(await screen.findByText(/Approving for public view/)).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Approve for public" }));

    expect(setVisibility).toHaveBeenCalledWith(READY_DOCUMENT.ref, "public_approved");
    expect(await screen.findByRole("button", { name: "Withdraw from public" })).toBeInTheDocument();
    expect(screen.getByText("Public register")).toBeInTheDocument();
  });

  it("withdraws an approved document back to private", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([
      { ...READY_DOCUMENT, visibility: "public_approved" },
    ]));
    const setVisibility = vi
      .spyOn(documentsService, "setPublicVisibility")
      .mockResolvedValue({ ref: READY_DOCUMENT.ref, visibility: "private" });
    const user = userEvent.setup();

    renderWorkspaceWithRoles("auditor", ["auditor", "content_publisher"]);
    await user.click(await screen.findByRole("button", { name: "Withdraw from public" }));

    expect(setVisibility).toHaveBeenCalledWith(READY_DOCUMENT.ref, "private");
    expect(await screen.findByRole("button", { name: "Approve for public" })).toBeInTheDocument();
    expect(screen.queryByText("Public register")).toBeNull();
  });

  it("keeps approval disabled for a document that is not clean and finalized", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([
      documentRecord({
        ref: "DOC-2026-QUARANTINE",
        ownerDomain: "student",
        filename: "quarantined-scan.pdf",
        processingState: "quarantined",
        scanState: "quarantined",
      }),
    ]));

    renderWorkspaceWithRoles("auditor", ["auditor", "content_publisher"]);

    expect(await screen.findByRole("button", { name: "Approve for public" })).toBeDisabled();
  });

  it("never offers the public register for a ready per-student record", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([
      documentRecord({
        ref: "DOC-2026-REPORT",
        ownerDomain: "student",
        ownerReference: "STU-2026-F21DA2",
        filename: "report-card-RPR-2026-A3BD47.pdf",
        processingState: "ready",
        scanState: "ready",
        finalizationState: "verified",
        checksumVerified: true,
        finalizedAtIso: "2026-09-15T00:00:00.000Z",
      }),
    ]));
    const setVisibility = vi.spyOn(documentsService, "setPublicVisibility");

    renderWorkspaceWithRoles("auditor", ["auditor", "content_publisher"]);

    const approve = await screen.findByRole("button", { name: "Approve for public" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute(
      "title",
      "Only school documents can be approved for the public downloads register. Student, applicant, staff, and import records stay private.",
    );
    expect(screen.getByText(/Not eligible for the public downloads register/)).toBeInTheDocument();
    expect(setVisibility).not.toHaveBeenCalled();
  });

  it("shows the honest refusal message when the server rejects an approval", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([READY_DOCUMENT]));
    vi.spyOn(documentsService, "setPublicVisibility").mockRejectedValue(
      new Error("This document is past its retention period and cannot be approved for public view."),
    );
    const user = userEvent.setup();

    renderWorkspaceWithRoles("auditor", ["auditor", "content_publisher"]);
    await user.click(await screen.findByRole("button", { name: "Approve for public" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/retention period/);
    expect(screen.queryByText("Public register")).toBeNull();
  });
});

describe("staff school document upload", () => {
  it("hides the upload panel from a workspace without content.publish", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([]));

    renderWorkspace("auditor");

    expect(await screen.findByText("No authorized documents")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Add a school document" })).toBeNull();
    expect(screen.queryByLabelText("Document file")).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload document" })).toBeNull();
  });

  it("shows the upload panel to a content publisher with the fixed register categories", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([]));

    renderWorkspaceWithRoles("auditor", ["auditor", "content_publisher"]);

    expect(await screen.findByRole("heading", { name: "Add a school document" })).toBeInTheDocument();
    expect(screen.getByLabelText("Document file")).toHaveAttribute("accept", ".pdf,.jpg,.jpeg,.png");
    const categories = within(screen.getByLabelText("Register category")).getAllByRole("option");
    expect(categories.map((option) => option.textContent)).toEqual([
      "School policy",
      "Disclosure",
      "Fee schedule",
      "Circular",
      "Prospectus",
    ]);
  });

  it("uploads a school document, shows the pending-scan message, clears the input, and refreshes the register", async () => {
    const listForStaff = vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([]));
    uploadMocks.uploadDocumentFile.mockResolvedValue({ documentRef: "DOC-2026-SCHOOL", status: "pending_scan" });
    const user = userEvent.setup();

    renderWorkspaceWithRoles("auditor", ["auditor", "content_publisher"]);
    await screen.findByText("No authorized documents");

    const file = new File([new Uint8Array(64)], "holiday-circular.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Document file"), file);
    await user.selectOptions(screen.getByLabelText("Register category"), "circular");
    await user.click(screen.getByRole("button", { name: "Upload document" }));

    expect(uploadMocks.uploadDocumentFile).toHaveBeenCalledWith({
      ownerDomain: "school_document",
      ownerRecordRef: ACCOUNT_ID,
      attachmentCode: "circular",
      file,
    });
    expect(await screen.findByText("Uploaded · waiting for the security scan")).toBeInTheDocument();
    expect((screen.getByLabelText("Document file") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(listForStaff).toHaveBeenCalledTimes(2));
  });

  it("shows an honest alert when the upload fails and keeps the register unchanged", async () => {
    const listForStaff = vi.spyOn(documentsService, "listForStaff").mockResolvedValue(staffPage([]));
    uploadMocks.uploadDocumentFile.mockRejectedValue(new Error("The uploaded document could not be finalized."));
    const user = userEvent.setup();

    renderWorkspaceWithRoles("auditor", ["auditor", "content_publisher"]);
    await screen.findByText("No authorized documents");

    await user.upload(
      screen.getByLabelText("Document file"),
      new File([new Uint8Array(64)], "fee-schedule.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload document" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The uploaded document could not be finalized.");
    expect(screen.queryByText("Uploaded · waiting for the security scan")).toBeNull();
    expect(listForStaff).toHaveBeenCalledTimes(1);
  });
});
