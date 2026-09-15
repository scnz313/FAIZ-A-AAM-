// @vitest-environment node
/**
 * S4 domain-logic hardening (admissions + careers + enrollment demo adapters):
 * versioned transitions, maker/checker denial, applicant timeline safety,
 * single-invoice issuance, and idempotent conversion. All data is fictional.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  ADMISSIONS_SESSION_KEYS,
  admissionsService,
  mapServerApplication,
  type ServerAdmissionRow,
} from "@/modules/services/admissions";
import {
  CAREERS_SESSION_KEYS,
  careersService,
  mapServerJob,
  type ServerJobRow,
} from "@/modules/services/careers";
import {
  convertApplication,
  ENROLLMENT_SESSION_KEYS,
} from "@/modules/services/enrollment";
import { financeService, FINANCE_SESSION_KEYS } from "@/modules/services/finance";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-05T09:30:00.000Z");
const PINNED_ISO = PINNED.toISOString();

const ACTOR_A = "00000000-0000-4000-8000-000000000203";
const ACTOR_B = "00000000-0000-4000-8000-000000000205";
const ACTOR_C = "00000000-0000-4000-8000-000000000207";

function clearAll(): void {
  Object.values(ADMISSIONS_SESSION_KEYS).forEach((key) => sessionRemove(key));
  Object.values(CAREERS_SESSION_KEYS).forEach((key) => sessionRemove(key));
  Object.values(FINANCE_SESSION_KEYS).forEach((key) => sessionRemove(key));
  Object.values(ENROLLMENT_SESSION_KEYS).forEach((key) => sessionRemove(key));
}

beforeEach(() => {
  clearAll();
  setDemoNow(PINNED);
});

afterEach(() => {
  clearAll();
  setDemoNow(null);
});

describe("admissions versioned transitions (S4)", () => {
  it("rejects a stale move-to-assessment with who/when info and never overwrites", async () => {
    const before = await admissionsService.getApplication("APP-2026-0422");
    expect(before?.version ?? 1).toBe(1);

    await expect(
      admissionsService.staffMoveToAssessment("APP-2026-0422", "Stale panel.", undefined, 999),
    ).rejects.toThrow(/Stale write for APP-2026-0422: expected version 999 but current is 1.*last updated by .* at .*/);

    const unchanged = await admissionsService.getApplication("APP-2026-0422");
    expect(unchanged?.status).toBe("Submitted");
    expect(unchanged?.timeline).toHaveLength(before!.timeline.length);

    const moved = await admissionsService.staffMoveToAssessment("APP-2026-0422", "Panel review.", undefined, 1);
    expect(moved.status).toBe("Assessment");
    expect(moved.version).toBe(2);

    await expect(
      admissionsService.staffOfferSeat("APP-2026-0422", "Stale offer.", undefined, 1),
    ).rejects.toThrow(/Stale write for APP-2026-0422: expected version 1 but current is 2/);
    expect((await admissionsService.getApplication("APP-2026-0422"))?.status).toBe("Assessment");
  });

  it("bumps the version on every demo mutation and accepts the fresh version", async () => {
    const started = await admissionsService.staffStartReview("APP-2026-0422", "Review.", ACTOR_A, 1);
    expect(started.version).toBe(2);

    const assessed = await admissionsService.staffMoveToAssessment("APP-2026-0422", "Panel.", ACTOR_A, 2);
    expect(assessed.version).toBe(3);

    const offered = await admissionsService.staffOfferSeat("APP-2026-0422", "Meets the criteria.", ACTOR_B, 3);
    expect(offered.status).toBe("Offered");
    expect(offered.version).toBe(4);
  });

  it("denies the startReview maker from offering its own review", async () => {
    await admissionsService.staffStartReview("APP-2026-0422", "Review by A.", ACTOR_A);
    await expect(
      admissionsService.staffMoveToAssessment("APP-2026-0422", "Self panel.", ACTOR_A),
    ).resolves.toMatchObject({ status: "Assessment" });
    await expect(
      admissionsService.staffOfferSeat("APP-2026-0422", "Self offer.", ACTOR_A),
    ).rejects.toThrow(/cannot approve its own review/);
    const offered = await admissionsService.staffOfferSeat("APP-2026-0422", "Approver offer.", ACTOR_B);
    expect(offered.status).toBe("Offered");
  });

  it("rejects stale requestChange writes with who/when info", async () => {
    await expect(
      admissionsService.requestChange("APP-2026-0422", "Fix the photo.", 999),
    ).rejects.toThrow(/Stale write for APP-2026-0422/);
    const updated = await admissionsService.requestChange("APP-2026-0422", "Fix the photo.", 1);
    expect(updated.status).toBe("Changes requested");
    expect(updated.version).toBe(2);
  });
});

describe("careers versioned transitions + maker/checker (S4)", () => {
  it("rejects stale shortlist writes and bumps the version on success", async () => {
    await expect(careersService.staffShortlist("JOB-2026-0114", "Stale.", undefined, 999)).rejects.toThrow(
      /Stale write for JOB-2026-0114: expected version 999 but current is 1.*last updated by .* at .*/,
    );
    expect((await careersService.getApplication("JOB-2026-0114"))?.status).toBe("Submitted");

    const shortlisted = await careersService.staffShortlist("JOB-2026-0114", "Strong record.", undefined, 1);
    expect(shortlisted.status).toBe("Shortlisted");
    expect(shortlisted.version).toBe(2);
  });

  it("denies the shortlister from offering its own shortlist", async () => {
    await careersService.staffShortlist("JOB-2026-0114", "Shortlist by A.", ACTOR_A);
    await careersService.staffRequestInterview("JOB-2026-0114", "Panel slot.");
    await expect(careersService.staffOffer("JOB-2026-0114", "Offer by the shortlister.", ACTOR_A)).rejects.toThrow(
      /shortlisted the candidate and cannot offer its own shortlist/,
    );
    const offered = await careersService.staffOffer("JOB-2026-0114", "Offer by the approver.", ACTOR_B);
    expect(offered.status).toBe("Offered");
  });

  it("denies the scorecard author from deciding its own review", async () => {
    await careersService.staffShortlist("JOB-2026-0114", "Shortlist.", ACTOR_B);
    await careersService.staffRequestInterview("JOB-2026-0114", "Panel slot.");
    await careersService.saveScorecard("JOB-2026-0114", 5, "Outstanding demonstration.", ACTOR_A);

    await expect(careersService.staffOffer("JOB-2026-0114", "Offer by the scorer.", ACTOR_A)).rejects.toThrow(
      /recorded a scorecard.*cannot approve its own review/,
    );
    await expect(careersService.staffNotSelected("JOB-2026-0114", "Reject by the scorer.", ACTOR_A)).rejects.toThrow(
      /recorded a scorecard.*cannot approve its own review/,
    );

    const offered = await careersService.staffOffer("JOB-2026-0114", "Offer by an independent approver.", ACTOR_C);
    expect(offered.status).toBe("Offered");
  });

  it("rejects stale scorecard and interview writes", async () => {
    await careersService.staffShortlist("JOB-2026-0114", "Shortlist.");
    await expect(careersService.saveScorecard("JOB-2026-0114", 4, "Good.", undefined, 1)).rejects.toThrow(
      /Stale write for JOB-2026-0114: expected version 1 but current is 2/,
    );
    const scored = await careersService.saveScorecard("JOB-2026-0114", 4, "Good.", undefined, 2);
    expect(scored.version).toBe(3);
    expect(scored.scorecards).toHaveLength(1);
  });
});

describe("applicant timeline projections leak nothing internal (S4)", () => {
  it("mapServerApplication keeps only applicant-visible events", () => {
    const row = {
      id: "adm-1",
      reference: "APP-2026-0999",
      academic_year_id: "ay-1",
      grade_id: "g-1",
      current_status: "under_review",
      student_name: "Demo Child",
      parent_name: "Demo Guardian",
      parent_contact: "+91 90000 00000",
      version: 3,
      submitted_at: PINNED_ISO,
      created_at: PINNED_ISO,
      academic_years: { label: "2026-27", starts_on: "2026-04-01", ends_on: "2027-03-31", status: "current" },
      grades: { label: "Class 8" },
      admission_drafts: null,
      admission_application_versions: null,
      admission_events: [
        { event_type: "submitted", visible_to_applicant: true, copy: "Visible to the family.", created_at: PINNED_ISO },
        { event_type: "under_review", visible_to_applicant: false, copy: "INTERNAL private note — officer only.", created_at: PINNED_ISO },
      ],
      admission_reviews: null,
      admission_offers: null,
    } as unknown as ServerAdmissionRow;

    const mapped = mapServerApplication(row);
    expect(mapped.version).toBe(3);
    expect(mapped.timeline).toHaveLength(1);
    expect(mapped.timeline[0]?.note).toBe("Visible to the family.");
    expect(mapped.timeline.map((event) => event.note).join(" ")).not.toMatch(/INTERNAL|private/i);
  });

  it("mapServerJob keeps only applicant-visible events and carries the version", () => {
    const row = {
      id: "job-1",
      reference: "JOB-2026-0999",
      current_status: "shortlisted",
      version: 2,
      created_at: PINNED_ISO,
      job_vacancies: { title: "Mathematics Teacher", reference: "mathematics-teacher" },
      job_application_versions: [{ version: 1, snapshot: { fullName: "Demo Candidate" } }],
      job_events: [
        { event_type: "submitted", visible_to_applicant: true, copy: "Visible to the candidate.", created_at: PINNED_ISO },
        { event_type: "shortlisted", visible_to_applicant: false, copy: "INTERNAL panel deliberation — do not show.", created_at: PINNED_ISO },
      ],
      job_review_assignments: null,
      job_scorecards: null,
      job_interviews: null,
    } as unknown as ServerJobRow;

    const mapped = mapServerJob(row);
    expect(mapped.version).toBe(2);
    expect(mapped.timeline).toHaveLength(1);
    expect(mapped.timeline[0]?.note).toBe("Visible to the candidate.");
    expect(mapped.timeline.map((event) => event.note).join(" ")).not.toMatch(/INTERNAL|deliberation/i);
  });

  it("mapServerJob reads the canonical assignment and scorecard columns", () => {    /* Regression guard for the staging 42703 defect: job_review_assignments
       has created_at (not assigned_at) and job_scorecards attributes the
       reviewer with reviewer_account_id (not created_by_account_id). */
    const row = {
      id: "job-2",
      reference: "JOB-2026-1000",
      current_status: "interview",
      version: 4,
      created_at: PINNED_ISO,
      job_vacancies: { title: "Science Teacher", reference: "science-teacher" },
      job_application_versions: [{ version: 1, snapshot: { fullName: "Demo Candidate" } }],
      job_events: [],
      job_interviews: null,
      job_review_assignments: [
        { reviewer_account_id: ACTOR_A, status: "completed", created_at: "2026-08-01T09:00:00.000Z" },
        { reviewer_account_id: ACTOR_B, status: "completed", created_at: "2026-08-04T09:00:00.000Z" },
      ],
      job_scorecards: [
        { score: 4, notes: "Solid demonstration.", reviewer_account_id: ACTOR_B, created_at: PINNED_ISO },
      ],
    } as unknown as ServerJobRow;

    const mapped = mapServerJob(row);
    expect(mapped.reviewerAccountId).toBe(ACTOR_B);
    expect(mapped.scorecards).toEqual([
      { score: 4, notes: "Solid demonstration.", byAccountId: ACTOR_B, atIso: PINNED_ISO },
    ]);
  });

  it("mapServerApplication carries immutable versions and staff reviews", () => {
    const row = {
      reference: "APP-2026-0999",
      academic_year_id: "year-1",
      grade_id: "grade-1",
      current_status: "changes_requested",
      student_name: "Test Child",
      parent_name: "Test Guardian",
      parent_contact: "+91 90000 00000",
      version: 3,
      submitted_at: PINNED_ISO,
      created_at: PINNED_ISO,
      academic_years: { label: "2026-27", starts_on: "", ends_on: "", status: "current" },
      grades: { label: "Class 8" },
      admission_drafts: null,
      admission_application_versions: [
        { id: "v-1", version: 1, snapshot: { studentName: "Old Name" }, schema_version: 1, created_at: "2026-08-01T00:00:00.000Z" },
        { id: "v-2", version: 2, snapshot: { studentName: "New Name" }, schema_version: 1, created_at: PINNED_ISO },
      ],
      admission_events: [],
      admission_reviews: [
        { officer_account_id: ACTOR_A, created_at: "2026-08-01T00:00:00.000Z", action: "reviewed", visible_reason: "Looked fine", private_note: "Check DOB against the register." },
      ],
      admission_offers: null,
    } as unknown as ServerAdmissionRow;

    const mapped = mapServerApplication(row);
    expect(mapped.versions?.map((entry) => entry.version)).toEqual([1, 2]);
    expect(mapped.versions?.[1]?.snapshot).toEqual({ studentName: "New Name" });
    expect(mapped.staffReviews?.[0]).toMatchObject({
      action: "reviewed",
      visibleReason: "Looked fine",
      privateNote: "Check DOB against the register.",
    });
  });

  it("demo timelines never expose account ids or private markers", async () => {
    const assessed = await admissionsService.staffMoveToAssessment("APP-2026-0422", "Visible panel reason.", ACTOR_A);
    const offered = await admissionsService.staffOfferSeat("APP-2026-0422", "Visible offer reason.", ACTOR_B);
    expect(assessed.reviewedByAccountId).toBe(ACTOR_A);
    for (const event of offered.timeline) {
      expect(event.actor).not.toContain("00000000-");
      expect(event.note).not.toMatch(/INTERNAL|private note/i);
    }
    expect(offered.timeline.at(-1)).toMatchObject({ actor: "Admissions office", note: "Visible offer reason." });

    await careersService.staffShortlist("JOB-2026-0114", "Visible shortlist reason.", ACTOR_A);
    const record = await careersService.getApplication("JOB-2026-0114");
    expect(record?.shortlistedByAccountId).toBe(ACTOR_A);
    for (const event of record!.timeline) {
      expect(event.actor).not.toContain("00000000-");
      expect(event.note).not.toMatch(/INTERNAL|private/i);
    }
  });
});

describe("live PostgREST to-one embeds (staging shape regression)", () => {
  function baseRow(patch: Record<string, unknown>): ServerAdmissionRow {
    return {
      id: "adm-1",
      reference: "APP-2026-1000",
      academic_year_id: "ay-1",
      grade_id: "grade-1",
      current_status: "offered",
      student_name: "Live Child",
      parent_name: "Live Guardian",
      parent_contact: "+91 90000 00000",
      version: 4,
      submitted_at: PINNED_ISO,
      created_at: PINNED_ISO,
      academic_years: { label: "2026-27", starts_on: "2026-04-01", ends_on: "2027-03-31", status: "current" },
      grades: { label: "Class 8" },
      admission_drafts: null,
      admission_application_versions: null,
      admission_events: [],
      admission_reviews: null,
      admission_offers: null,
      ...patch,
    } as unknown as ServerAdmissionRow;
  }

  /* admission_offers.application_id is UNIQUE, so PostgREST embeds a to-one
     relationship as an object; the applicant status page lost every offer
     until the mapper read both shapes. */
  it("maps a to-one offer object into the applicant record", () => {
    const mapped = mapServerApplication(baseRow({
      admission_offers: {
        id: "offer-1",
        grade_id: "grade-1",
        academic_year_id: "ay-1",
        conditions: { admissionFeePaise: 500000 },
        expires_at: "2026-09-25T00:00:00.000Z",
        fee_required: true,
        admission_invoice_ref: null,
        response: "pending",
        responded_at: null,
        version: 4,
      },
    }));

    expect(mapped.status).toBe("Offered");
    expect(mapped.offer).toMatchObject({
      grade: "Class 8",
      session: "2026-27",
      acceptByIso: "2026-09-25T00:00:00.000Z",
      admissionFeePaise: 500000,
      accepted: false,
      declined: false,
    });
  });

  it("maps an accepted to-one offer with its issued invoice reference", () => {
    const mapped = mapServerApplication(baseRow({
      admission_offers: {
        id: "offer-1",
        grade_id: "grade-1",
        academic_year_id: "ay-1",
        conditions: {},
        expires_at: "2026-09-25T00:00:00.000Z",
        fee_required: true,
        admission_invoice_ref: "INV-2026-0001",
        response: "accepted",
        responded_at: PINNED_ISO,
        version: 4,
      },
    }));

    expect(mapped.offer?.accepted).toBe(true);
    expect(mapped.offer?.admissionInvoiceRef).toBe("INV-2026-0001");
  });

  it("maps linked admission_documents into staff-readable document views", () => {
    const mapped = mapServerApplication(baseRow({
      admission_documents: [
        {
          requirement_code: "birth",
          documents: {
            reference: "DOC-2026-0101",
            safe_filename: "birth-certificate.pdf",
            category: "birth",
            scan_status: "ready",
            mime_type: "application/pdf",
            size_bytes: 2048,
            created_at: PINNED_ISO,
            finalized_at: PINNED_ISO,
          },
        },
        /* A pending row the reader may not see embeds as null; it is omitted
           rather than rendered as an empty attachment. */
        { requirement_code: "photo", documents: null },
      ],
    }));

    expect(mapped.documents).toHaveLength(1);
    expect(mapped.documents?.[0]).toMatchObject({
      requirementCode: "birth",
      reference: "DOC-2026-0101",
      filename: "birth-certificate.pdf",
      scanStatus: "ready",
    });
  });

  it("maps a to-one draft object and a to-one duplicate-review object without throwing", () => {
    const mapped = mapServerApplication(baseRow({
      current_status: "duplicate_review",
      admission_drafts: {
        draft: { studentName: "Live Child" },
        schema_version: 1,
        expires_at: PINNED_ISO,
        updated_at: PINNED_ISO,
      },
      admission_duplicate_reviews: {
        status: "pending",
        candidate_student_id: "candidate-1",
        reference: "DUP-2026-0001",
        reason: "Possible match",
        reviewed_at: null,
        students: { reference: "STU-2026-0001", people: { display_name: "Existing Child" } },
      },
    }));

    expect(mapped.duplicateReview).toBe(true);
    expect(mapped.duplicateReviewRef).toBe("DUP-2026-0001");
    expect(mapped.candidateStudentId).toBe("candidate-1");
    expect(mapped.candidateStudentName).toBe("Existing Child");
  });
});

describe("single invoice + idempotent conversion (S4)", () => {
  it("issues exactly one admission invoice under sequential double-accept", async () => {
    const first = await admissionsService.respondToOffer("APP-2026-0417", true, "Applicant");
    const invoiceRef = first.offer!.admissionInvoiceRef!;
    await expect(admissionsService.respondToOffer("APP-2026-0417", true, "Applicant")).rejects.toThrow(
      /already been responded/,
    );
    const invoices = (await financeService.listAllInvoices()).filter(
      (item) => item.invoice.applicantRef === "APP-2026-0417",
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.invoice.ref).toBe(invoiceRef);
  });

  it("issues exactly one admission invoice under concurrent double-accept", async () => {
    const settled = await Promise.allSettled([
      admissionsService.respondToOffer("APP-2026-0417", true, "Applicant"),
      admissionsService.respondToOffer("APP-2026-0417", true, "Applicant"),
    ]);
    const fulfilled = settled.filter((item) => item.status === "fulfilled");
    const rejected = settled.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const invoices = (await financeService.listAllInvoices()).filter(
      (item) => item.invoice.applicantRef === "APP-2026-0417",
    );
    expect(invoices).toHaveLength(1);
  });

  it("returns the same conversion result under sequential double-submit without duplicating effects", async () => {
    const accepted = await admissionsService.respondToOffer("APP-2026-0417", true, "Applicant");
    const view = await financeService.getInvoice(accepted.offer!.admissionInvoiceRef!);
    const attempt = await financeService.createPaymentAttempt(view!.invoice.ref, "UPI", view!.balancePaise);
    await financeService.refreshAttempt(attempt.id);
    await financeService.refreshAttempt(attempt.id);
    await financeService.confirmSuccess(attempt.id);

    const first = await convertApplication("APP-2026-0417");
    const second = await convertApplication("APP-2026-0417");
    expect(second).toEqual(first);
    const record = await admissionsService.getApplication("APP-2026-0417");
    expect(record?.timeline.filter((event) => event.status === "Enrolled")).toHaveLength(1);
  }, 15_000);
});
