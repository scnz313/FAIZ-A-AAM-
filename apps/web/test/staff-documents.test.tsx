import { act, render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
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

    expect(screen.getByRole("link", { name: "Documents" })).toHaveAttribute("href", "/staff/documents");

    authorized.unmount();
    render(
      <StaffContextProvider initialState={initialState("teacher")}>
        <StaffShell initialNotifications={[]}>content</StaffShell>
      </StaffContextProvider>,
    );

    expect(screen.queryByRole("link", { name: "Documents" })).toBeNull();
  });

  it("fails closed without requesting metadata for a disallowed active workspace", () => {
    const listForStaff = vi.spyOn(documentsService, "listForStaff").mockResolvedValue([]);

    renderWorkspace("teacher");

    expect(screen.getByRole("alert")).toHaveTextContent("This workspace cannot open documents");
    expect(screen.queryByText("Private documents")).toBeNull();
    expect(listForStaff).not.toHaveBeenCalled();
  });
});

describe("staff document processing register", () => {
  it("keeps private rows hidden while the authorized service request is pending", async () => {
    let resolveRecords: (records: PrivateDocumentMetadata[]) => void = () => undefined;
    const pendingRecords = new Promise<PrivateDocumentMetadata[]>((resolve) => {
      resolveRecords = resolve;
    });
    vi.spyOn(documentsService, "listForStaff").mockReturnValue(pendingRecords);

    renderWorkspace("finance_officer");

    expect(screen.getByText("Loading authorized documents…")).toBeInTheDocument();
    expect(screen.queryByText("No authorized documents")).toBeNull();

    await act(async () => {
      resolveRecords([]);
    });
    expect(await screen.findByText("No authorized documents")).toBeInTheDocument();
  });

  it("renders every mixed-domain record returned by the database-scoped service", async () => {
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue([
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
    ]);

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
    vi.spyOn(documentsService, "listForStaff").mockResolvedValue([]);

    renderWorkspace("finance_officer");

    expect(await screen.findByText("No authorized documents")).toBeInTheDocument();
    expect(screen.getByText(/demo adapter intentionally exposes no private staff files/i)).toBeInTheDocument();
  });

  it("offers a retry after a recoverable list failure", async () => {
    const listForStaff = vi
      .spyOn(documentsService, "listForStaff")
      .mockRejectedValueOnce(new Error("Authorized document metadata is temporarily unavailable."))
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();

    renderWorkspace("admissions_officer");

    expect(await screen.findByText("Documents unavailable")).toBeInTheDocument();
    expect(screen.getByText("Authorized document metadata is temporarily unavailable.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(listForStaff).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No authorized documents")).toBeInTheDocument();
  });
});
