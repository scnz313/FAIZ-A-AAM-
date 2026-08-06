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
import { CAREERS_SESSION_KEYS, careersService, type JobDraft } from "@/modules/services/careers";
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
  documents: {},
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
