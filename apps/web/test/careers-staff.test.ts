// @vitest-environment node
/**
 * Deterministic contract tests for the careers demo adapter's staff side
 * (modules/services/careers.ts): queue listing, reasoned decisions, and
 * timeline persistence. Node environment exercises the SSR-safe in-memory
 * fallback of the session store (no window). The clock is pinned and every
 * careers session key is cleared between tests, so refs (JOB-2026-0116, …),
 * timestamps and counters are fully deterministic. Existing applicant
 * methods (saveDraft/submitApplication/getApplication/withdraw) are
 * untouched and only exercised here through submitApplication.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { CAREERS_SESSION_KEYS, careersService, mapServerJob, type JobDraft, type ServerJobRow } from "@/modules/services/careers";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-05T09:30:00Z");

const DRAFT: JobDraft = {
  fullName: "Demo Candidate Test",
  phone: "+91 90000 00000",
  email: "candidate@example.test",
  qualification: "B.Sc. Mathematics · B.Ed.",
  subject: "Mathematics",
  year: "2024",
  institution: "Demo College of Education",
  experience: "3 years — classes 8 to 10",
  currentRole: "Mathematics teacher",
  location: "Srinagar",
  message: "Available from April.",
  consent: true,
};

beforeEach(() => {
  setDemoNow(PINNED);
  Object.values(CAREERS_SESSION_KEYS).forEach((key) => sessionRemove(key));
});

afterEach(() => {
  setDemoNow(null);
  Object.values(CAREERS_SESSION_KEYS).forEach((key) => sessionRemove(key));
});

const lastEvent = (record: { timeline: { status: string; atIso: string; actor: string; note: string }[] }) =>
  record.timeline[record.timeline.length - 1];

describe("careersService staff queue", () => {
  it("lists every fixture row plus a session-submitted application, newest submitted first", async () => {
    const fixtureRows = await careersService.listStaffRecords();

    expect(fixtureRows).toHaveLength(5);
    expect(fixtureRows.map((row) => row.ref)).toEqual([
      "JOB-2026-0115",
      "JOB-2026-0114",
      "JOB-2026-0113",
      "JOB-2026-0112",
      "JOB-2026-0108",
    ]);

    const { ref } = await careersService.submitApplication("mathematics-teacher", DRAFT);
    expect(ref).toBe("JOB-2026-0116");

    const rows = await careersService.listStaffRecords();
    expect(rows).toHaveLength(6);
    expect(rows[0]?.ref).toBe("JOB-2026-0116");
    expect(rows[0]?.status).toBe("Submitted");
    expect(rows[0]?.submittedAtIso).toBe("2026-08-05T09:30:00.000Z");
    expect(rows.map((row) => row.ref)).toContain("JOB-2026-0108");
  });

  it("returns an unknown reference as null", async () => {
    expect(await careersService.getApplication("JOB-2026-9999")).toBeNull();
  });
});

describe("staffShortlist", () => {
  it("shortlists from Submitted with the standard note and the panel actor", async () => {
    const record = await careersService.staffShortlist("JOB-2026-0114");

    expect(record.status).toBe("Shortlisted");
    expect(record.timeline).toHaveLength(2);
    expect(lastEvent(record)).toEqual({
      status: "Shortlisted",
      atIso: "2026-08-05T09:30:00.000Z",
      actor: "Recruitment panel",
      note: "Candidate shortlisted for the next stage.",
    });
  });

  it("records a custom note and the named fixture reviewer as actor", async () => {
    const record = await careersService.staffShortlist("JOB-2026-0113", "Strong lesson demonstration");

    expect(record.status).toBe("Shortlisted");
    expect(lastEvent(record)).toMatchObject({
      status: "Shortlisted",
      actor: "R. Wani",
      note: "Strong lesson demonstration",
    });
  });

  it("rejects when the application is already Shortlisted (retries never double-record)", async () => {
    await expect(careersService.staffShortlist("JOB-2026-0112")).rejects.toThrow(
      /must be "Submitted" or "Eligibility review"/,
    );
    const record = await careersService.getApplication("JOB-2026-0112");
    expect(record?.status).toBe("Shortlisted");
    expect(record?.timeline).toHaveLength(3);
  });

  it("rejects an unknown reference", async () => {
    await expect(careersService.staffShortlist("JOB-2026-9999")).rejects.toThrow(/was not found/);
  });
});

describe("staffRequestInterview", () => {
  it("works from Shortlisted and attaches a demo interview slot three days from now", async () => {
    const record = await careersService.staffRequestInterview("JOB-2026-0112");

    expect(record.status).toBe("Interview");
    expect(record.timeline).toHaveLength(4);
    expect(lastEvent(record)).toEqual({
      status: "Interview",
      atIso: "2026-08-05T09:30:00.000Z",
      actor: "R. Wani",
      note: "Interview requested — the panel will confirm the slot.",
    });
    expect(record.interview).toEqual({
      atIso: "2026-08-08T09:30:00.000Z",
      note: undefined,
    });
  });

  it("records a custom note on the event and the slot", async () => {
    const record = await careersService.staffRequestInterview("JOB-2026-0112", "Panel interview, 40 minutes");

    expect(lastEvent(record)?.note).toBe("Panel interview, 40 minutes");
    expect(record.interview?.note).toBe("Panel interview, 40 minutes");
  });

  it("fails from Submitted", async () => {
    await expect(careersService.staffRequestInterview("JOB-2026-0114")).rejects.toThrow(/must be "Shortlisted"/);
    const record = await careersService.getApplication("JOB-2026-0114");
    expect(record?.status).toBe("Submitted");
    expect(record?.timeline).toHaveLength(1);
  });
});

describe("staffOffer", () => {
  it("requires a reason and rejects blank or whitespace notes", async () => {
    await expect(careersService.staffOffer("JOB-2026-0108", "")).rejects.toThrow(/requires a reason/);
    await expect(careersService.staffOffer("JOB-2026-0108", "   ")).rejects.toThrow(/requires a reason/);
  });

  it("offers from Interview and records the reason in the timeline", async () => {
    const record = await careersService.staffOffer("JOB-2026-0108", "Strong interview and demonstration.");

    expect(record.status).toBe("Offered");
    expect(record.timeline).toHaveLength(5);
    expect(lastEvent(record)).toEqual({
      status: "Offered",
      atIso: "2026-08-05T09:30:00.000Z",
      actor: "S. Bhat",
      note: "Strong interview and demonstration.",
    });
  });

  it("fails from Shortlisted — only Interview is accepted", async () => {
    await expect(careersService.staffOffer("JOB-2026-0112", "A reason.")).rejects.toThrow(/must be "Interview"/);
  });
});

describe("staffNotSelected", () => {
  it("requires a reason and works from Interview", async () => {
    await expect(careersService.staffNotSelected("JOB-2026-0108", "")).rejects.toThrow(/requires a reason/);

    const record = await careersService.staffNotSelected("JOB-2026-0108", "Vacancy filled by a stronger candidate.");

    expect(record.status).toBe("Not selected");
    expect(record.timeline).toHaveLength(5);
    expect(lastEvent(record)).toMatchObject({
      status: "Not selected",
      actor: "S. Bhat",
      note: "Vacancy filled by a stronger candidate.",
    });
  });

  it("rejects an offer after Not selected", async () => {
    await careersService.staffNotSelected("JOB-2026-0108", "Vacancy filled by a stronger candidate.");
    await expect(careersService.staffOffer("JOB-2026-0108", "Changed our mind.")).rejects.toThrow(
      /must be "Interview"/,
    );
  });
});

describe("session persistence of decisions", () => {
  it("getApplication reflects the full decision chain on a fixture reference", async () => {
    await careersService.staffShortlist("JOB-2026-0114", "Strong classroom record");

    let record = await careersService.getApplication("JOB-2026-0114");
    expect(record?.status).toBe("Shortlisted");
    expect(record?.timeline).toHaveLength(2);

    await careersService.staffRequestInterview("JOB-2026-0114", "Panel interview");
    record = await careersService.getApplication("JOB-2026-0114");
    expect(record?.status).toBe("Interview");
    expect(record?.timeline).toHaveLength(3);
    expect(record?.interview?.atIso).toBe("2026-08-08T09:30:00.000Z");
    expect(record?.interview?.note).toBe("Panel interview");

    await careersService.staffOffer("JOB-2026-0114", "Clear demonstration and strong references");
    record = await careersService.getApplication("JOB-2026-0114");
    expect(record?.status).toBe("Offered");
    expect(record?.timeline).toHaveLength(4);
    expect(lastEvent(record!)).toMatchObject({
      status: "Offered",
      note: "Clear demonstration and strong references",
    });

    /* A rejected decision never mutates the persisted record. */
    await expect(careersService.staffNotSelected("JOB-2026-0114", "No longer under consideration.")).rejects.toThrow(
      /must be "Submitted"/,
    );
    record = await careersService.getApplication("JOB-2026-0114");
    expect(record?.status).toBe("Offered");
    expect(record?.timeline).toHaveLength(4);
  });
});

describe("careersService staff audit recording", () => {
  it("records an audit event for each staff decision", async () => {
    const { auditService } = await import("@/modules/services/audit");
    const before = await auditService.listEvents();
    const beforeIds = new Set(before.map((event) => event.id));

    await careersService.staffShortlist("JOB-2026-0114");
    await careersService.staffRequestInterview("JOB-2026-0114");
    await careersService.staffOffer("JOB-2026-0114", "Strong interview.");

    const after = await auditService.listEvents();
    const newEvents = after.filter((event) => !beforeIds.has(event.id));
    expect(newEvents).toHaveLength(3);
    expect(newEvents.every((event) => event.action === "Application reviewed")).toBe(true);
    expect(newEvents.every((event) => event.target === "JOB-2026-0114")).toBe(true);
    expect(newEvents.every((event) => event.outcome === "Success")).toBe(true);
  });
});

describe("careers version + maker/checker hardening (S4 extension)", () => {
  it("rejects stale shortlist writes and denies the shortlister from offering", async () => {
    const ACTOR_A = "00000000-0000-4000-8000-000000000203";
    const ACTOR_B = "00000000-0000-4000-8000-000000000205";
    await expect(careersService.staffShortlist("JOB-2026-0114", "Stale.", undefined, 999)).rejects.toThrow(
      /Stale write for JOB-2026-0114/,
    );
    await careersService.staffShortlist("JOB-2026-0114", "Shortlist by A.", ACTOR_A);
    await careersService.staffRequestInterview("JOB-2026-0114", "Panel slot.");
    await expect(careersService.staffOffer("JOB-2026-0114", "Self offer.", ACTOR_A)).rejects.toThrow(
      /cannot offer its own shortlist/,
    );
    const offered = await careersService.staffOffer("JOB-2026-0114", "Approver offer.", ACTOR_B);
    expect(offered.status).toBe("Offered");
  });
});

describe("careersService reviewer assignment and scorecards", () => {
  it("assigns a reviewer and persists it on the record", async () => {
    const updated = await careersService.assignReviewer("JOB-2026-0114", "00000000-0000-4000-8000-000000000204");
    expect(updated.reviewerAccountId).toBe("00000000-0000-4000-8000-000000000204");

    /* The assignment survives a reload through the same service. */
    const reloaded = await careersService.getApplication("JOB-2026-0114");
    expect(reloaded?.reviewerAccountId).toBe("00000000-0000-4000-8000-000000000204");
  });

  it("saves an attributed scorecard and rejects invalid scores", async () => {
    await expect(careersService.saveScorecard("JOB-2026-0114", 6)).rejects.toThrow(/Score must be/);

    const updated = await careersService.saveScorecard("JOB-2026-0114", 4, "Strong subject knowledge.");
    expect(updated.scorecards).toHaveLength(1);
    expect(updated.scorecards?.[0]).toMatchObject({ score: 4, notes: "Strong subject knowledge." });

    const reloaded = await careersService.getApplication("JOB-2026-0114");
    expect(reloaded?.scorecards).toHaveLength(1);
  });
});

describe("mapServerJob timeline labels (Supabase projection)", () => {
  const serverRow = (
    events: Array<{ event_type: string; visible_to_applicant: boolean; copy: string; created_at: string }>,
  ): ServerJobRow => ({
    id: "00000000-0000-4000-8000-00000000f201",
    reference: "JOB-2026-0200",
    current_status: "offered",
    version: 5,
    created_at: "2026-08-01T05:00:00.000Z",
    job_application_versions: [{ version: 1, snapshot: { fullName: "Live Candidate" } }],
    job_events: events,
  });

  const serverEvent = (eventType: string, day: number, copy: string) => ({
    event_type: eventType,
    visible_to_applicant: true,
    copy,
    created_at: `2026-08-0${day}T05:00:00.000Z`,
  });

  it("labels each decision event from its own event type, never the Submitted fallback", () => {
    const record = mapServerJob(
      serverRow([
        serverEvent("submitted", 1, "Application submitted"),
        serverEvent("shortlist", 2, "Strong record"),
        serverEvent("interview", 3, "Panel interview"),
        serverEvent("offer", 4, "Offer extended"),
      ]),
    );

    expect(record.timeline.map((event) => event.status)).toEqual([
      "Submitted",
      "Shortlisted",
      "Interview",
      "Offered",
    ]);
    expect(record.timeline.map((event) => event.actor)).toEqual([
      "Applicant",
      "HR office",
      "HR office",
      "HR office",
    ]);
    expect(record.timeline.map((event) => event.note)).toEqual([
      "Application submitted",
      "Strong record",
      "Panel interview",
      "Offer extended",
    ]);
  });

  it("keeps the legacy shortlisted/offered event vocabulary and not-selected mapping", () => {
    const record = mapServerJob(
      serverRow([
        serverEvent("shortlisted", 2, "Shortlisted"),
        serverEvent("offered", 4, "Offer extended"),
        serverEvent("not_selected", 5, "Application closed"),
      ]),
    );

    expect(record.timeline.map((event) => event.status)).toEqual(["Shortlisted", "Offered", "Not selected"]);
  });

  it("omits events that are not visible to the applicant", () => {
    const record = mapServerJob(
      serverRow([
        serverEvent("submitted", 1, "Application submitted"),
        { ...serverEvent("shortlist", 2, "Internal note"), visible_to_applicant: false },
      ]),
    );

    expect(record.timeline).toHaveLength(1);
  });
});

describe("mapServerJob linked documents (public intake photo projection)", () => {
  const rowWithDocuments = (documents: ServerJobRow["job_documents"]): ServerJobRow => ({
    id: "00000000-0000-4000-8000-00000000f202",
    reference: "JOB-2026-0300",
    applicant_name: "Public Applicant",
    owner_account_id: undefined,
    current_status: "submitted",
    version: 1,
    created_at: "2026-09-15T02:00:00.000Z",
    job_application_versions: [{ version: 1, snapshot: { source: "public_intake" } }],
    job_events: [{ event_type: "submitted", visible_to_applicant: true, copy: "Application submitted", created_at: "2026-09-15T02:00:00.000Z" }],
    job_documents: documents,
  });

  it("maps the readable linked document into the staff record", () => {
    const record = mapServerJob(
      rowWithDocuments([
        {
          requirement_code: "profile_photo",
          documents: {
            reference: "DOC-2026-6187D7",
            safe_filename: "pi-profile-photo.png",
            category: "profile_photo",
            scan_status: "ready",
            mime_type: "image/png",
            size_bytes: 89,
            created_at: "2026-09-15T02:04:50.978Z",
          },
        },
      ]),
    );

    expect(record.attachedDocuments).toEqual([
      {
        requirementCode: "profile_photo",
        reference: "DOC-2026-6187D7",
        filename: "pi-profile-photo.png",
        category: "profile_photo",
        scanStatus: "ready",
        mimeType: "image/png",
        sizeBytes: 89,
        uploadedAtIso: "2026-09-15T02:04:50.978Z",
      },
    ]);
  });

  it("drops a link whose document row was withheld by RLS (scan pending)", () => {
    const record = mapServerJob(rowWithDocuments([{ requirement_code: "profile_photo", documents: null }]));

    expect(record.attachedDocuments).toEqual([]);
  });

  it("maps a record without links to an empty list, never undefined output", () => {
    expect(mapServerJob(rowWithDocuments(null)).attachedDocuments).toEqual([]);
    expect(mapServerJob(rowWithDocuments(undefined)).attachedDocuments).toEqual([]);
  });
});

describe("mapServerJob contact identity (anonymous public intake)", () => {
  const row = (applicant_email: string | null, applicant_phone: string | null): ServerJobRow => ({
    id: "00000000-0000-4000-8000-00000000f203",
    reference: "JOB-2026-F01291",
    applicant_name: "Zareen Fictional Applicant",
    applicant_email,
    applicant_phone,
    current_status: "submitted",
    version: 1,
    created_at: "2026-09-15T02:00:00.000Z",
    job_application_versions: [{ version: 1, snapshot: { source: "public_intake" } }],
    job_events: [{ event_type: "submitted", visible_to_applicant: true, copy: "Application submitted", created_at: "2026-09-15T02:00:00.000Z" }],
  });

  it("carries the recorded email and phone so HR can contact an anonymous applicant", () => {
    const record = mapServerJob(row("zareen@example.test", "+91 90000 12345"));

    expect(record.contactEmail).toBe("zareen@example.test");
    expect(record.contactPhone).toBe("+91 90000 12345");
  });

  it("omits blank or absent contact values instead of rendering empty identity rows", () => {
    expect(mapServerJob(row(null, null)).contactEmail).toBeUndefined();
    expect(mapServerJob(row("   ", "")).contactPhone).toBeUndefined();
    expect(mapServerJob(row("   ", "")).contactEmail).toBeUndefined();
  });
});
