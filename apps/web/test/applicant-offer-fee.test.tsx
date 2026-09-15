/**
 * Applicant offer fee display: an offer whose approved fee schedule has not
 * been published must not read as ₹0 (a free seat). The status view shows the
 * amount when one is recorded and an honest confirmation note when it is not.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ApplicationStatusView from "@/components/applicant/ApplicationStatusView";
import type { ApplicationRecord } from "@/modules/services/admissions";

function offeredRecord(admissionFeePaise: number): ApplicationRecord {
  return {
    ref: "APP-2026-TEST01",
    session: "2026-27",
    grade: "Class 8",
    studentName: "Test Student",
    parentName: "Test Guardian",
    contact: "+91 90000 00000",
    submittedAtIso: "2026-09-11T16:00:00.000Z",
    status: "Offered",
    timeline: [{ status: "Offered", atIso: "2026-09-11T16:05:00.000Z", actor: "Admissions office", note: "Offer extended." }],
    offer: {
      grade: "Class 8",
      session: "2026-27",
      acceptByIso: "2026-09-25T16:05:00.000Z",
      admissionFeePaise,
      accepted: false,
    },
  };
}

describe("ApplicationStatusView offer fee", () => {
  it("does not present a missing fee schedule as ₹0", () => {
    render(<ApplicationStatusView applicationRef="APP-2026-TEST01" initial={offeredRecord(0)} />);

    expect(screen.getByText("To be confirmed by the school office")).toBeInTheDocument();
    expect(screen.queryByText("₹0")).not.toBeInTheDocument();
  });

  it("shows the recorded admission amount", () => {
    render(<ApplicationStatusView applicationRef="APP-2026-TEST01" initial={offeredRecord(600000)} />);

    expect(screen.getByText("₹6,000")).toBeInTheDocument();
  });
});

describe("ApplicationStatusView decline copy", () => {
  it("labels a school decline honestly and shows the visible reason", () => {
    const record: ApplicationRecord = {
      ...offeredRecord(0),
      status: "Declined",
      offer: undefined,
      staffReviews: [
        { action: "declined", visibleReason: "The assessment did not meet the eligibility policy.", privateNote: "internal", officerAccountId: "acct-1", officerName: null, atIso: "2026-09-12T10:00:00.000Z" },
      ],
    };
    render(<ApplicationStatusView applicationRef="APP-2026-TEST01" initial={record} />);

    expect(screen.getByText("Application not successful")).toBeInTheDocument();
    expect(screen.getByText(/did not offer a seat/i)).toBeInTheDocument();
    expect(screen.getByText(/assessment did not meet the eligibility policy/i)).toBeInTheDocument();
    expect(screen.queryByText("Offer declined")).not.toBeInTheDocument();
  });

  it("keeps the offer-declined copy when the applicant declined the offer", () => {
    const record: ApplicationRecord = {
      ...offeredRecord(0),
      status: "Declined",
      offer: { ...offeredRecord(0).offer!, declined: true },
    };
    render(<ApplicationStatusView applicationRef="APP-2026-TEST01" initial={record} />);

    expect(screen.getByText("Offer declined")).toBeInTheDocument();
    expect(screen.queryByText("Application not successful")).not.toBeInTheDocument();
  });
});
