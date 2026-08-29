// @vitest-environment node
/**
 * Deterministic contract tests for the admissions staff workflow
 * (modules/services/admissions.ts, UI-COMPLETION-PLAN.md §5.3/§6-P2):
 * the staff queue lists every fixture row plus session-submitted records;
 * consequential decisions require a reason, enforce the status transition,
 * append exactly one timeline event per decision, and persist through the
 * demo session store so retries never duplicate. Node environment
 * exercises the SSR-safe in-memory fallback of the session store; the clock
 * is pinned and every admissions session key is cleared between tests, so
 * refs (APP-2026-04xx) and timestamps are fully deterministic.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { auditService } from "@/modules/services/audit";
import { resetDemoPolicy, setDemoPolicy } from "@/modules/services/demo-policy";
import { listOutboxEvents } from "@/modules/services/outbox";
import {
  ADMISSIONS_SESSION_KEYS,
  admissionsService,
  type ApplicationDraft,
} from "@/modules/services/admissions";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-05T09:30:00Z");
const PINNED_ISO = PINNED.toISOString();

/** Pinned clock + 15 days — the offer accept-by deadline. */
const OFFER_ACCEPT_BY_ISO = "2026-08-20T09:30:00.000Z";

/** A complete fictional draft; the first submission in a clean session is APP-2026-0424. */
function draft(): ApplicationDraft {
  return {
    session: "2026-27",
    grade: "Class 7",
    studentName: "Demo Student",
    dob: "2014-04-02",
    gender: "Female",
    placeOfBirth: "Bandipora",
    guardianName: "Demo Guardian",
    relation: "Mother",
    phone: "+91 90000 00001",
    email: "demo.guardian@example.com",
    occupation: "Teacher",
    houseStreet: "Demo Street",
    villageTown: "Demo Town",
    district: "Bandipora",
    pin: "193502",
    priorSchoolName: "Demo Primary School",
    lastClassAttended: "Class 6",
    leavingCertificate: "Available",
    conditions: [],
    documents: {
      birth: "birth-certificate.pdf",
      photo: "photo.jpg",
      reportCard: "report-card.pdf",
      addressProof: "address-proof.pdf",
    },
    consent: true,
  };
}

beforeEach(() => {
  setDemoNow(PINNED);
  Object.values(ADMISSIONS_SESSION_KEYS).forEach((key) => sessionRemove(key));
});

afterEach(() => {
  setDemoNow(null);
  Object.values(ADMISSIONS_SESSION_KEYS).forEach((key) => sessionRemove(key));
});

describe("admissions staff queue", () => {
  it("listStaffRecords returns every fixture row with reviewer and flag, newest first", async () => {
    const records = await admissionsService.listStaffRecords();

    expect(records.map((row) => row.ref)).toEqual([
      "APP-2026-0423",
      "APP-2026-0422",
      "APP-2026-0421",
      "APP-2026-0420",
      "APP-2026-0419",
      "APP-2026-0418",
      "APP-2026-0417",
    ]);
    expect(records.find((row) => row.ref === "APP-2026-0418")?.reviewer).toBe("A. Lone");
    expect(records.find((row) => row.ref === "APP-2026-0418")?.status).toBe("Assessment");
    expect(records.find((row) => row.ref === "APP-2026-0420")?.flagged).toBe(true);
    expect(records.find((row) => row.ref === "APP-2026-0422")?.reviewer).toBe("—");
    /* Every queue row resolves to a record with a derived timeline. */
    const underReview = records.find((row) => row.ref === "APP-2026-0419");
    expect(underReview?.timeline.map((event) => event.status)).toEqual(["Submitted", "Under review"]);
  });

  it("listStaffRecords merges session-submitted records at the top of the queue", async () => {
    const { ref } = await admissionsService.submitApplication(draft());

    expect(ref).toBe("APP-2026-0424");

    const records = await admissionsService.listStaffRecords();
    expect(records).toHaveLength(8);
    expect(records[0]?.ref).toBe("APP-2026-0424");
    expect(records[0]?.submittedAtIso).toBe(PINNED_ISO);
    expect(records.map((row) => row.ref)).toContain("APP-2026-0417");
  });
});

describe("admissions staff decisions", () => {
  it("staffOfferSeat requires a reason, then offers from Assessment with a timeline event and offer payload", async () => {
    await expect(admissionsService.staffOfferSeat("APP-2026-0418", "  ")).rejects.toThrow(/reason/);

    const updated = await admissionsService.staffOfferSeat("APP-2026-0418", "Strong interaction; seat offered for Class 6.");

    expect(updated.status).toBe("Offered");
    expect(updated.offer).toMatchObject({
      grade: "Class 6",
      session: "2026-27",
      admissionFeePaise: 200000,
      accepted: false,
    });
    expect(updated.offer?.acceptByIso).toBe(OFFER_ACCEPT_BY_ISO);
    expect(updated.timeline).toHaveLength(4);
    expect(updated.timeline[updated.timeline.length - 1]).toEqual({
      status: "Offered",
      atIso: PINNED_ISO,
      actor: "Admissions office",
      note: "Strong interaction; seat offered for Class 6.",
    });

    /* A retry is a safe no-op: no second timeline event, no overwritten offer. */
    const retried = await admissionsService.staffOfferSeat("APP-2026-0418", "Duplicate click.");
    expect(retried.status).toBe("Offered");
    expect(retried.timeline.filter((event) => event.status === "Offered")).toHaveLength(1);
    expect(retried.offer?.admissionFeePaise).toBe(200000);

    /* The already-Offered fixture application is a no-op too. */
    const fixtureOffered = await admissionsService.staffOfferSeat("APP-2026-0417", "Retry on a fixture offer.");
    expect(fixtureOffered.status).toBe("Offered");
    expect(fixtureOffered.timeline).toHaveLength(6);
  });

  it("staffOfferSeat rejects before assessment", async () => {
    await expect(admissionsService.staffOfferSeat("APP-2026-0422", "Direct offer.")).rejects.toThrow(/after assessment/);
  });

  it("staffDecline requires a reason, works from Assessment, and blocks every later decision", async () => {
    await expect(admissionsService.staffDecline("APP-2026-0418", "")).rejects.toThrow(/reason/);

    const updated = await admissionsService.staffDecline("APP-2026-0418", "Seats are full for this grade this session.");
    expect(updated.status).toBe("Declined");
    expect(updated.timeline[updated.timeline.length - 1]).toEqual({
      status: "Declined",
      atIso: PINNED_ISO,
      actor: "Admissions office",
      note: "Seats are full for this grade this session.",
    });

    await expect(admissionsService.staffOfferSeat("APP-2026-0418", "Changed our mind.")).rejects.toThrow(/after assessment/);
    await expect(admissionsService.staffMoveToAssessment("APP-2026-0418")).rejects.toThrow(/assessment/);
    await expect(admissionsService.staffWaitlist("APP-2026-0418", "Waitlist after all.")).rejects.toThrow(/waitlisted/);
    await expect(admissionsService.staffDecline("APP-2026-0418", "Decline again.")).rejects.toThrow(/cannot be declined/);
  });

  it("staffMoveToAssessment works from Under review and appends the default note", async () => {
    const updated = await admissionsService.staffMoveToAssessment("APP-2026-0419");

    expect(updated.status).toBe("Assessment");
    expect(updated.timeline[updated.timeline.length - 1]).toEqual({
      status: "Assessment",
      atIso: PINNED_ISO,
      actor: "Admissions office",
      note: "Moved to the assessment panel.",
    });

    const withNote = await admissionsService.staffMoveToAssessment("APP-2026-0421", "Panel has capacity this week.");
    expect(withNote.timeline[withNote.timeline.length - 1]?.note).toBe("Panel has capacity this week.");

    /* Already in Assessment — the transition is invalid. */
    await expect(admissionsService.staffMoveToAssessment("APP-2026-0418")).rejects.toThrow(/assessment/);
  });

  it("staffWaitlist requires a reason and works from Assessment", async () => {
    await expect(admissionsService.staffWaitlist("APP-2026-0418", "   ")).rejects.toThrow(/reason/);

    const updated = await admissionsService.staffWaitlist("APP-2026-0418", "Second waiting list — likely a seat opens after July.");
    expect(updated.status).toBe("Waitlisted");
    expect(updated.timeline[updated.timeline.length - 1]).toEqual({
      status: "Waitlisted",
      atIso: PINNED_ISO,
      actor: "Admissions office",
      note: "Second waiting list — likely a seat opens after July.",
    });
    expect(updated.offer).toBeUndefined();
  });
});

describe("admissions maker/checker separation (Phase 1)", () => {
  it("records the reviewer on move-to-assessment and blocks the same account from offering", async () => {
    const ACTOR_A = "00000000-0000-4000-8000-000000000203";
    const ACTOR_B = "00000000-0000-4000-8000-000000000205";

    /* The reviewer moves a fresh submission to assessment (maker step). */
    const reviewed = await admissionsService.staffMoveToAssessment("APP-2026-0422", undefined, ACTOR_A);
    expect(reviewed.status).toBe("Assessment");
    expect(reviewed.reviewedByAccountId).toBe(ACTOR_A);

    /* The same account may not approve its own review. */
    await expect(admissionsService.staffOfferSeat("APP-2026-0422", "Offered by the reviewer.", ACTOR_A)).rejects.toThrow(
      /cannot approve its own review/,
    );

    /* A different approver can record the decision. */
    const offered = await admissionsService.staffOfferSeat("APP-2026-0422", "Offered by the approver.", ACTOR_B);
    expect(offered.status).toBe("Offered");
    expect(offered.reviewedByAccountId).toBe(ACTOR_A);
  });

  it("blocks the reviewing account from waitlisting or declining its own review", async () => {
    const ACTOR_A = "00000000-0000-4000-8000-000000000203";
    const ACTOR_B = "00000000-0000-4000-8000-000000000205";

    await admissionsService.staffMoveToAssessment("APP-2026-0423", "Panel review.", ACTOR_A);
    await expect(admissionsService.staffWaitlist("APP-2026-0423", "Waitlist.", ACTOR_A)).rejects.toThrow(
      /cannot approve its own review/,
    );
    await expect(admissionsService.staffDecline("APP-2026-0423", "Decline.", ACTOR_A)).rejects.toThrow(
      /cannot approve its own review/,
    );

    /* A different approver is not blocked. */
    const declined = await admissionsService.staffDecline("APP-2026-0423", "Declined by the approver.", ACTOR_B);
    expect(declined.status).toBe("Declined");
  });

  it("lets the reviewer keep reviewing other applications", async () => {
    const ACTOR_A = "00000000-0000-4000-8000-000000000203";

    await admissionsService.staffMoveToAssessment("APP-2026-0419", undefined, ACTOR_A);
    expect((await admissionsService.getApplication("APP-2026-0419"))?.reviewedByAccountId).toBe(ACTOR_A);

    /* Another application, same reviewer: the maker step is unaffected. */
    const second = await admissionsService.staffMoveToAssessment("APP-2026-0421", "Second panel.", ACTOR_A);
    expect(second.status).toBe("Assessment");
    expect(second.reviewedByAccountId).toBe(ACTOR_A);
  });

  it("stays backward compatible when no actor account is supplied", async () => {
    /* Legacy callers/tests omit the actor: transitions are allowed and no
       reviewer identity is recorded. */
    const reviewed = await admissionsService.staffMoveToAssessment("APP-2026-0420");
    expect(reviewed.status).toBe("Assessment");
    expect(reviewed.reviewedByAccountId).toBeUndefined();

    const offered = await admissionsService.staffOfferSeat("APP-2026-0420", "Legacy offer without an actor.");
    expect(offered.status).toBe("Offered");
    expect(offered.reviewedByAccountId).toBeUndefined();
  });
});

describe("admissions staff decision persistence", () => {
  it("getApplication returns the updated record after each staff decision, and the queue agrees", async () => {
    await admissionsService.staffMoveToAssessment("APP-2026-0423");
    const afterMove = await admissionsService.getApplication("APP-2026-0423");
    expect(afterMove?.status).toBe("Assessment");

    await admissionsService.staffOfferSeat("APP-2026-0423", "Meets the entry criteria for Class 8.");
    const afterOffer = await admissionsService.getApplication("APP-2026-0423");
    expect(afterOffer?.status).toBe("Offered");
    expect(afterOffer?.offer?.acceptByIso).toBe(OFFER_ACCEPT_BY_ISO);
    expect(afterOffer?.timeline.map((event) => event.status)).toEqual(["Submitted", "Assessment", "Offered"]);

    /* The queue reads the same session record, not the fixture. */
    const rows = await admissionsService.listStaffRecords();
    expect(rows.find((row) => row.ref === "APP-2026-0423")?.status).toBe("Offered");

    /* A later offer is a no-op; a decline is refused. */
    const retried = await admissionsService.staffOfferSeat("APP-2026-0423", "Retry.");
    expect(retried.timeline.filter((event) => event.status === "Offered")).toHaveLength(1);
    await expect(admissionsService.staffDecline("APP-2026-0423", "Seats reallocated.")).rejects.toThrow(/cannot be declined/);
  });

  it("a declined fixture application stays declined through the session store", async () => {
    await admissionsService.staffDecline("APP-2026-0419", "Candidate did not meet the entry criteria.");

    const seen = await admissionsService.getApplication("APP-2026-0419");
    expect(seen?.status).toBe("Declined");
    expect(seen?.timeline[seen.timeline.length - 1]?.actor).toBe("Admissions office");

    const rows = await admissionsService.listStaffRecords();
    expect(rows.find((row) => row.ref === "APP-2026-0419")?.status).toBe("Declined");
  });
});

describe("applicant withdrawal (fictional demo policy)", () => {
  beforeEach(() => {
    resetDemoPolicy();
  });

  it("withdraws a submitted application and records timeline + audit + outbox", async () => {
    const submitted = await admissionsService.submitApplication(draft());
    expect(submitted.ref).toBe("APP-2026-0424");

    const withdrawn = await admissionsService.withdraw(submitted.ref, "Demo Guardian");
    expect(withdrawn.status).toBe("Withdrawn");
    const lastEvent = withdrawn.timeline[withdrawn.timeline.length - 1];
    expect(lastEvent?.status).toBe("Withdrawn");
    expect(lastEvent?.actor).toBe("Demo Guardian");

    /* The staff queue shows the withdrawn state. */
    const queue = await admissionsService.listStaffRecords();
    const row = queue.find((item) => item.ref === submitted.ref);
    expect(row?.status).toBe("Withdrawn");

    /* Audit evidence exists. */
    const audit = await auditService.listEvents();
    const event = audit.find((item) => item.target === submitted.ref);
    expect(event?.action).toBe("Application reviewed");
    expect(event?.outcome).toBe("Success");
    expect(event?.reason).toContain("withdrawn");

    /* One outbox event, idempotent by event id. */
    const events = listOutboxEvents();
    const withdrawnEvents = events.filter((item) => item.kind === "admissions.withdrawn" && item.targetRef === submitted.ref);
    expect(withdrawnEvents).toHaveLength(1);
  });

  it("rejects withdrawal from terminal states (offered / declined / enrolled)", async () => {
    await expect(admissionsService.withdraw("APP-2026-0417", "Demo Guardian")).rejects.toThrow(/cannot be withdrawn/);
    /* A session record declined by the office is also terminal. */
    const submitted = await admissionsService.submitApplication(draft());
    await admissionsService.staffDecline(submitted.ref, "Declined after document verification failed.", "00000000-0000-4000-8000-000000000203");
    await expect(admissionsService.withdraw(submitted.ref, "Demo Guardian")).rejects.toThrow(/cannot be withdrawn/);
  });

  it("throws the policy-pending error when the fictional rule is disabled", async () => {
    setDemoPolicy("admission.withdrawal", false);
    await expect(admissionsService.withdraw("APP-2026-0419", "Demo Guardian")).rejects.toThrow(/pending school policy/);
  });
});
