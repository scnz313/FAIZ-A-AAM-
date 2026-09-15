/**
 * Applicant chooser row meta. Pre-fix duplicate drafts for one child are
 * indistinguishable, so each row states whether it was started or submitted
 * and, for editable rows, how many documents are attached. A submitted row
 * keeps its history clean: the count is reserved for drafts and
 * requested-change rows.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ApplyStudentPage from "@/app/apply/student/page";
import { admissionsService, type ApplicationDocumentView, type ApplicationRecord } from "@/modules/services/admissions";

function documentSummary(reference: string): ApplicationDocumentView {
  return {
    requirementCode: "birth",
    reference,
    filename: "document.pdf",
    category: "birth",
    scanStatus: "ready",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    uploadedAtIso: "2026-09-12T11:00:00.000Z",
    finalizedAtIso: "2026-09-12T11:01:00.000Z",
  };
}

function record(partial: Partial<ApplicationRecord>): ApplicationRecord {
  return {
    ref: "APP-2026-BASE01",
    session: "2026-27",
    grade: "Class 8",
    studentName: "Hiba Qureshi",
    parentName: "Imran Qureshi",
    contact: "+91 98000 10001",
    submittedAtIso: "2026-09-12T11:44:25.000Z",
    status: "Draft",
    timeline: [],
    documents: [],
    ...partial,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("applicant chooser row meta", () => {
  it("labels a draft as started and counts its uploaded documents", async () => {
    vi.spyOn(admissionsService, "listMyApplications").mockResolvedValue([
      record({ ref: "APP-2026-DRAFT01", status: "Draft", documents: [documentSummary("DOC-2026-0001"), documentSummary("DOC-2026-0002")] }),
      record({ ref: "APP-2026-SUBM01", status: "Submitted", documents: [documentSummary("DOC-2026-0003")] }),
    ]);

    render(<ApplyStudentPage />);

    expect(await screen.findByText(/Your applications/)).toBeInTheDocument();
    expect(screen.getByText(/Started/)).toBeInTheDocument();
    expect(screen.getByText(/2 uploaded documents/)).toBeInTheDocument();
    /* A submitted row shows the submission date without the draft count. */
    expect(screen.getByText(/Submitted Sat 12 Sept/)).toBeInTheDocument();
    expect(screen.queryByText(/1 uploaded document/)).toBeNull();
  });
});
