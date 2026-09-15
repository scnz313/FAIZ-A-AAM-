// @vitest-environment jsdom

/**
 * Staff paging on /staff/link-requests (000114). The queues are bounded pages
 * with an exact total: "Show more" appends the next server page, duplicate
 * rows are never rendered twice (a local move can shift a server boundary),
 * and the pager disappears when the queue is exhausted.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FamilyCapability, GuardianStudentLink } from "@fass/contracts";

const staffMocks = vi.hoisted(() => ({ useStaffContext: vi.fn() }));

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: staffMocks.useStaffContext,
}));

import LinkRequestsPage from "@/app/staff/link-requests/page";
import { familyContextService, type LinkRequestSummary } from "@/modules/services/family-context";

const ALL_CAPABILITIES: FamilyCapability[] = ["academics", "finance", "documents", "notices", "profile"];

function link(id: string, ref: string): GuardianStudentLink {
  return {
    id,
    ref,
    guardianId: "00000000-0000-4000-8000-000000000201",
    studentId: "00000000-0000-4000-8000-000000000901",
    relationshipLabel: "Parent",
    status: "pending_verification",
    verificationSource: "guardian_request",
    approvedByPersonId: null,
    approvedAtIso: null,
    effectiveFromIso: "2026-07-01T05:00:00.000Z",
    effectiveToIso: null,
    restrictionReason: null,
    rejectionReason: null,
    contactPriority: 1,
    isEmergencyContact: false,
    isBillingContact: false,
    capabilities: ALL_CAPABILITIES,
    version: 1,
  };
}

function summary(id: string, ref: string, guardianName: string): LinkRequestSummary {
  return {
    link: link(id, ref),
    guardianName,
    studentName: "Aarif Khan",
    studentRef: "STU-2026-0901",
  };
}

const FIRST = summary("00000000-0000-4000-8000-000000001701", "LINK-2026-1701", "Zoya Khan");
const SECOND = summary("00000000-0000-4000-8000-000000001702", "LINK-2026-1702", "Imran Dar");

function emptyPage(): { rows: []; total: number; nextOffset: null } {
  return { rows: [], total: 0, nextOffset: null };
}

function requestPage(rows: LinkRequestSummary[]) {
  return {
    rows: rows.map((row) => ({
      request: {
        id: row.link.id,
        ref: row.link.ref,
        guardianAccountId: "server",
        guardianName: row.guardianName,
        childAdmissionRef: row.studentRef,
        relation: row.link.relationshipLabel,
        requestedAtIso: row.link.effectiveFromIso,
        status: "pending" as const,
        approvedLinkId: null,
        rejectedReason: null,
        decidedByPersonId: null,
        decidedAtIso: null,
        version: row.link.version,
      },
      student: {
        id: row.link.studentId,
        ref: row.studentRef,
        personId: row.link.studentId,
        status: "active" as const,
        displayName: row.studentName,
      },
    })),
    total: rows.length,
    nextOffset: null as number | null,
  };
}

describe("link queue paging", () => {
  beforeEach(() => {
    staffMocks.useStaffContext.mockReturnValue({
      summary: {
        profileCode: "administrator",
        roles: ["system_administrator"],
        roleLabel: "Administrator",
        displayName: "Fictional Administrator",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the exact pending total and appends the next page on demand", async () => {
    const user = userEvent.setup();
    vi.spyOn(familyContextService, "listLinkRequests")
      .mockResolvedValueOnce({ ...requestPage([FIRST]), total: 2, nextOffset: 1 })
      .mockResolvedValueOnce({ ...requestPage([SECOND]), total: 2, nextOffset: null });
    vi.spyOn(familyContextService, "listLinkRequestSummaries")
      .mockResolvedValueOnce({ rows: [FIRST], total: 2, nextOffset: 1 })
      .mockResolvedValueOnce({ rows: [SECOND], total: 2, nextOffset: null });
    vi.spyOn(familyContextService, "listActiveLinkSummaries").mockResolvedValue(emptyPage());
    vi.spyOn(familyContextService, "listRestrictedLinkSummaries").mockResolvedValue(emptyPage());

    render(<LinkRequestsPage />);

    /* The pending rows render in two sections (guardian requests and links
       awaiting verification), so each row appears twice by design. */
    expect(await screen.findAllByText("Zoya Khan")).toHaveLength(2);
    expect(screen.queryByText("Imran Dar")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show more pending links (1 of 2)" }));

    await waitFor(() => expect(familyContextService.listLinkRequestSummaries).toHaveBeenCalledWith(1));
    expect(await screen.findAllByText("Imran Dar")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Show more pending links/ })).toBeNull();
  });

  it("never renders a duplicate row when a page repeats one across a shifted boundary", async () => {
    const user = userEvent.setup();
    vi.spyOn(familyContextService, "listLinkRequests")
      .mockResolvedValueOnce({ ...requestPage([FIRST]), total: 2, nextOffset: 1 })
      .mockResolvedValueOnce({ ...requestPage([FIRST, SECOND]), total: 2, nextOffset: null });
    vi.spyOn(familyContextService, "listLinkRequestSummaries")
      .mockResolvedValueOnce({ rows: [FIRST], total: 2, nextOffset: 1 })
      .mockResolvedValueOnce({ rows: [FIRST, SECOND], total: 2, nextOffset: null });
    vi.spyOn(familyContextService, "listActiveLinkSummaries").mockResolvedValue(emptyPage());
    vi.spyOn(familyContextService, "listRestrictedLinkSummaries").mockResolvedValue(emptyPage());

    render(<LinkRequestsPage />);

    expect(await screen.findAllByText("Zoya Khan")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Show more pending links (1 of 2)" }));

    expect(await screen.findAllByText("Imran Dar")).toHaveLength(2);
    /* Deduplicated per section: one Zoya row in each of the two sections. */
    expect(screen.getAllByText("Zoya Khan")).toHaveLength(2);
  });
});
