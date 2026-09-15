/**
 * Support-service contract tests (UI-COMPLETION-PLAN.md §5.9, P1-6):
 * the demo adapter issues deterministic references from a session counter,
 * moves status per the §5.9 state machine, appends exactly one thread event
 * per response, and serves the fixtures mapped into the shared thread model.
 * The clock is pinned and the demo session key cleared before every test so
 * refs and timestamps are stable.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { sessionKey, sessionRemove } from "@/modules/services/session";
import {
  mapRequesterSupportRow,
  mapServerSupportRow,
  supportService,
  toRequesterSafeGrievance,
  type ServerSupportRow,
} from "@/modules/services/support";

const PINNED_NOW = new Date("2026-08-10T05:30:00Z");
const PINNED_ISO = PINNED_NOW.toISOString();

const INPUT = {
  category: "Fees" as const,
  subject: "Receipt not received",
  message: "Please confirm my term fee payment of 28 July was recorded and share the receipt.",
  contactName: "Demo Parent",
  contactPhone: "+91 90000 00007",
};

beforeEach(() => {
  setDemoNow(PINNED_NOW);
  sessionRemove(sessionKey("support"));
});

afterEach(() => {
  setDemoNow(null);
  sessionRemove(sessionKey("support"));
});

describe("demo support service — submissions", () => {
  it("submits as GRV-2026-0107 with status New and a single submission event", async () => {
    const { ref } = await supportService.submitGrievance(INPUT);

    expect(ref).toBe("GRV-2026-0107");

    const grievance = await supportService.getGrievance(ref);
    expect(grievance).not.toBeNull();
    expect(grievance?.status).toBe("New");
    expect(grievance?.raisedAtIso).toBe(PINNED_ISO);
    expect(grievance?.thread).toHaveLength(1);
    expect(grievance?.thread[0]?.kind).toBe("submission");
    expect(grievance?.thread[0]?.by).toBe(INPUT.contactName);
  });

  it("respond without resolve moves to In progress and appends a second thread event", async () => {
    const { ref } = await supportService.submitGrievance(INPUT);
    const updated = await supportService.respond(ref, "The office is verifying the counter deposit.", "A. Lone", false);

    expect(updated.status).toBe("In progress");
    expect(updated.thread).toHaveLength(2);
    expect(updated.thread[0]?.kind).toBe("submission");
    expect(updated.thread[1]).toMatchObject({
      kind: "response",
      by: "A. Lone",
      atIso: PINNED_ISO,
      text: "The office is verifying the counter deposit.",
    });

    /* The requester view reads the same applicant-safe record. */
    const seen = await supportService.getGrievance(ref);
    expect(seen?.status).toBe("In progress");
    expect(seen?.thread).toHaveLength(2);
  });

  it("respond with resolve moves to Resolved", async () => {
    const { ref } = await supportService.submitGrievance(INPUT);
    const updated = await supportService.respond(ref, "Ledger corrected; receipt is available.", "A. Lone", true);

    expect(updated.status).toBe("Resolved");
    expect(updated.thread).toHaveLength(2);
    expect(updated.thread[1]?.kind).toBe("response");
  });

  it("reopen returns a resolved grievance to New", async () => {
    const { ref } = await supportService.submitGrievance(INPUT);
    await supportService.respond(ref, "Resolved for now.", "A. Lone", true);
    const reopened = await supportService.reopen(ref, "A. Lone");

    expect(reopened.status).toBe("New");
    /* Reopen is a state transition only — no extra thread event. */
    expect(reopened.thread).toHaveLength(2);
  });

  it("never reuses a reference — the session counter advances", async () => {
    const first = await supportService.submitGrievance(INPUT);
    const second = await supportService.submitGrievance({ ...INPUT, subject: "Second concern" });

    expect(first.ref).toBe("GRV-2026-0107");
    expect(second.ref).toBe("GRV-2026-0108");

    const all = await supportService.listGrievances();
    const refs = all.map((item) => item.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toContain("GRV-2026-0107");
    expect(refs).toContain("GRV-2026-0108");
  });
});

describe("demo support service — fixture records", () => {
  it("returns a resolved fixture with its response mapped into the thread", async () => {
    const grievance = await supportService.getGrievance("GRV-2026-0105");

    expect(grievance).not.toBeNull();
    expect(grievance?.status).toBe("Resolved");
    expect(grievance?.thread).toHaveLength(2);
    expect(grievance?.thread[0]?.kind).toBe("submission");
    expect(grievance?.thread[1]).toMatchObject({ kind: "response", by: "A. Lone" });
  });

  it("returns a new fixture with only the submission event", async () => {
    const grievance = await supportService.getGrievance("GRV-2026-0101");

    expect(grievance).not.toBeNull();
    expect(grievance?.status).toBe("New");
    expect(grievance?.thread).toHaveLength(1);
    expect(grievance?.thread[0]?.kind).toBe("submission");
  });

  it("returns null for an unknown reference", async () => {
    expect(await supportService.getGrievance("GRV-2026-9999")).toBeNull();
  });
});

describe("demo support service — requester-safe vs staff-private projections (S4)", () => {
  it("getGrievance never leaks private notes or assignment to the requester", async () => {
    const { ref } = await supportService.submitGrievance(INPUT);
    await supportService.addPrivateNote(ref, "Internal: verify the counter deposit first.", "A. Lone");
    await supportService.assign(ref, "Support Officer");

    const seen = await supportService.getGrievance(ref);
    expect(seen).not.toBeNull();
    expect(seen).not.toHaveProperty("privateNotes");
    expect(seen).not.toHaveProperty("assignee");
    /* The shared thread is applicant-safe by construction — still visible. */
    expect(seen?.thread).toHaveLength(1);
    expect(seen?.thread[0]?.kind).toBe("submission");
  });

  it("listGrievances keeps the staff-private projection for the inbox", async () => {
    const { ref } = await supportService.submitGrievance(INPUT);
    await supportService.addPrivateNote(ref, "Internal note.", "A. Lone");
    await supportService.assign(ref, "Support Officer");

    const all = await supportService.listGrievances();
    const row = all.find((item) => item.ref === ref);
    expect(row?.privateNotes).toHaveLength(1);
    expect(row?.privateNotes?.[0]).toMatchObject({ by: "A. Lone", text: "Internal note." });
    expect(row?.assignee).toMatchObject({ by: "Support Officer" });
  });

  it("toRequesterSafeGrievance strips staff-private fields without mutating the stored record", async () => {
    const { ref } = await supportService.submitGrievance(INPUT);
    await supportService.addPrivateNote(ref, "Internal note.", "A. Lone");

    const all = await supportService.listGrievances();
    const staffRow = all.find((item) => item.ref === ref)!;
    const safe = toRequesterSafeGrievance(staffRow);
    expect(safe).not.toHaveProperty("privateNotes");
    expect(safe).not.toHaveProperty("assignee");
    /* The staff copy is untouched — projection copies, never moves, the data. */
    expect(staffRow.privateNotes).toHaveLength(1);
  });

  it("mapServerSupportRow strips private notes for the requester (mine) scope only", () => {
    const row: ServerSupportRow = {
      id: "00000000-0000-4000-8000-00000000aa01",
      reference: "SR-2026-0001",
      category: "Fees",
      subject: "Receipt not received",
      requester_name: "Demo Parent",
      requester_contact: "+91 90000 00007",
      status: "in_progress",
      version: 2,
      created_at: PINNED_ISO,
      support_messages: [{ body: "Please confirm.", is_staff: false, created_at: PINNED_ISO }],
      support_private_notes: [{ body: "Internal note.", author_account_id: "staff-1", created_at: PINNED_ISO }],
    };

    const mine = mapRequesterSupportRow(row);
    expect(mine).not.toHaveProperty("privateNotes");
    expect(mine).not.toHaveProperty("assignee");
    expect(mine.thread).toHaveLength(1);

    const staff = mapServerSupportRow(row);
    expect(staff.privateNotes).toHaveLength(1);
    expect(staff.privateNotes?.[0]).toMatchObject({ by: "staff-1", text: "Internal note." });
  });
});
