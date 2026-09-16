import { describe, expect, it } from "vitest";

import {
  activityByDay,
  admissionsFunnel,
  admissionsPipelineCount,
  contentBars,
  DUE_SOON_DAYS,
  dashboardService,
  feeCollection,
  guardianAccessBars,
  invoiceDueCounts,
  resultsBySection,
  supportBars,
} from "@/modules/services/dashboard";
import type { StaffQueueRecord } from "@/modules/services/admissions";
import type { EntryBatch } from "@/modules/services/academics";
import type { Grievance } from "@/modules/services/support";
import type { ContentNotice } from "@/modules/services/content";
import type { GuardianAdminRow } from "@/modules/services/guardians";
import type { InvoiceView } from "@/modules/services/finance";
import type { AuditEvent } from "@/modules/services/audit";

function application(status: string): StaffQueueRecord {
  return { status } as StaffQueueRecord;
}

function batch(className: string, status: EntryBatch["status"]): EntryBatch {
  return { className, status } as EntryBatch;
}

function invoice(totalPaise: number, paidPaise: number, dueAtIso: string): InvoiceView {
  return {
    invoice: { dueAtIso },
    totalPaise,
    paidPaise,
    balancePaise: totalPaise - paidPaise,
  } as InvoiceView;
}

function auditEvent(id: string, timestampIso: string): AuditEvent {
  return { id, timestampIso, actor: "A", action: "Login", target: "—", outcome: "Success" };
}

describe("admissionsFunnel", () => {
  it("folds adjacent statuses into the six funnel stages", () => {
    const rows = [
      application("Submitted"),
      application("Submitted"),
      application("Under review"),
      application("Changes requested"),
      application("Assessment"),
      application("Offered"),
      application("Waitlisted"),
      application("Enrolled"),
      application("Declined"),
      application("Withdrawn"),
      application("Draft"),
    ];
    const funnel = admissionsFunnel(rows);
    expect(funnel.map((bar) => [bar.label, bar.value])).toEqual([
      ["Submitted", 2],
      ["Under review", 2],
      ["Assessment", 1],
      ["Offered", 2],
      ["Enrolled", 1],
      ["Declined", 2],
    ]);
  });

  it("counts the pipeline as every non-terminal application", () => {
    const rows = [application("Submitted"), application("Offered"), application("Enrolled"), application("Declined"), application("Withdrawn")];
    expect(admissionsPipelineCount(rows)).toBe(2);
  });
});

describe("feeCollection", () => {
  const now = Date.parse("2026-09-15T04:00:00Z");

  it("buckets overdue, due-soon, and not-yet-due balances", () => {
    const views = [
      invoice(100_00, 100_00, "2026-09-01T00:00:00Z"), // fully paid
      invoice(200_00, 50_00, "2026-09-10T00:00:00Z"), // overdue balance 150
      invoice(300_00, 0, "2026-09-20T00:00:00Z"), // due soon balance 300
      invoice(400_00, 0, "2026-10-20T00:00:00Z"), // not yet due balance 400
    ];
    const result = feeCollection(views, now);
    expect(result.collectedPaise).toBe(150_00);
    expect(result.overduePaise).toBe(150_00);
    expect(result.dueSoonPaise).toBe(300_00);
    expect(result.notYetDuePaise).toBe(400_00);
    expect(result.segments.map((segment) => segment.label)).toEqual([
      "Collected",
      `Due in ${DUE_SOON_DAYS} days`,
      "Overdue",
      "Not yet due",
    ]);
  });

  it("treats an invoice due at exactly the 14-day boundary as due soon", () => {
    const dueAt = new Date(now + DUE_SOON_DAYS * 86_400_000).toISOString();
    const result = feeCollection([invoice(100_00, 0, dueAt)], now);
    expect(result.dueSoonPaise).toBe(100_00);
    expect(result.notYetDuePaise).toBe(0);
    const counts = invoiceDueCounts([invoice(100_00, 0, dueAt)], now);
    expect(counts).toEqual({ overdue: 0, dueSoon: 1 });
  });

  it("counts a balance with an unparseable due date as not yet due", () => {
    const result = feeCollection([invoice(100_00, 0, "")], now);
    expect(result.notYetDuePaise).toBe(100_00);
  });
});

describe("resultsBySection", () => {
  it("groups batches by class with status segments", () => {
    const batches = [
      batch("Class 9 · C", "draft"),
      batch("Class 9 · C", "submitted"),
      batch("Class 9 · C", "published"),
      batch("Class 8 · B", "returned"),
      batch("Class 8 · B", "approved"),
    ];
    const sections = resultsBySection(batches);
    expect(sections.map((section) => section.label)).toEqual(["Class 8 · B", "Class 9 · C"]);
    const nineC = sections[1]!;
    expect(nineC.total).toBe(3);
    expect(nineC.segments.map((segment) => [segment.label, segment.value])).toEqual([
      ["Entry", 1],
      ["In review", 1],
      ["Published", 1],
    ]);
  });
});

describe("supportBars and contentBars", () => {
  it("count grievances by status", () => {
    const rows = [
      { status: "New" },
      { status: "New" },
      { status: "In progress" },
      { status: "Resolved" },
    ] as Grievance[];
    expect(supportBars(rows).map((bar) => [bar.label, bar.value])).toEqual([
      ["New", 2],
      ["In progress", 1],
      ["Resolved", 1],
    ]);
  });

  it("count notices by review status", () => {
    const rows = [
      { reviewStatus: "draft" },
      { reviewStatus: "in_review" },
      { reviewStatus: "approved" },
      { reviewStatus: "published" },
      { reviewStatus: "published" },
    ] as ContentNotice[];
    expect(contentBars(rows).map((bar) => [bar.label, bar.value])).toEqual([
      ["Draft", 1],
      ["In review", 1],
      ["Approved", 1],
      ["Published", 2],
    ]);
  });
});

describe("guardianAccessBars", () => {
  it("counts the derived access states", () => {
    const rows = [
      { accessState: "active" },
      { accessState: "active" },
      { accessState: "invited" },
      { accessState: "not_activated" },
      { accessState: "expired" },
      { accessState: "no_contact" },
      { accessState: "suspended" },
    ] as GuardianAdminRow[];
    expect(guardianAccessBars(rows).map((bar) => [bar.label, bar.value])).toEqual([
      ["Active", 2],
      ["Activation pending", 1],
      ["Awaiting activation", 2],
      ["No email recorded", 1],
      ["Suspended", 1],
    ]);
  });
});

describe("activityByDay", () => {
  const now = Date.parse("2026-09-16T12:00:00Z"); // 16 Sep, 17:30 IST

  it("buckets events across the Asia/Kolkata midnight boundary", () => {
    const events = [
      auditEvent("a", "2026-09-15T18:29:00Z"), // 15 Sep 23:59 IST
      auditEvent("b", "2026-09-15T18:31:00Z"), // 16 Sep 00:01 IST
      auditEvent("c", "2026-09-16T06:00:00Z"), // 16 Sep 11:30 IST
    ];
    const model = activityByDay(events, now, 14);
    expect(model.days).toHaveLength(14);
    const penultimate = model.days[model.days.length - 2]!;
    const last = model.days[model.days.length - 1]!;
    expect(penultimate.key).toBe("2026-09-15");
    expect(penultimate.count).toBe(1);
    expect(last.key).toBe("2026-09-16");
    expect(last.count).toBe(2);
    expect(model.latest.map((event) => event.id)).toEqual(["c", "b", "a"]);
    expect(model.total).toBe(3);
  });

  it("anchors the window to the most recent event when activity predates today", () => {
    const events = [auditEvent("old", "2026-08-03T10:00:00Z")];
    const model = activityByDay(events, now, 14);
    expect(model.days[model.days.length - 1]!.key).toBe("2026-08-03");
    expect(model.days[model.days.length - 1]!.count).toBe(1);
  });

  it("yields a non-zero bar when events exist only on the last day", () => {
    const events = [
      auditEvent("x", "2026-09-16T01:30:00Z"),
      auditEvent("y", "2026-09-16T02:00:00Z"),
      auditEvent("z", "2026-09-15T20:00:00Z"), // 16 Sep 01:30 IST — same Kolkata day
    ];
    const model = activityByDay(events, now, 14);
    const last = model.days[model.days.length - 1]!;
    expect(last.key).toBe("2026-09-16");
    expect(last.count).toBe(3);
    expect(model.days.slice(0, -1).every((day) => day.count === 0)).toBe(true);
    expect(model.windowTotal).toBe(3);
  });
});

describe("dashboardService gating", () => {
  it("hides every source for an account with no grants", async () => {
    const model = await dashboardService.loadAdministrator([], { nowMs: Date.now() });
    expect(model.kpis).toEqual([]);
    expect(model.approvalsState).toBe("hidden");
    expect(model.funnel.kind).toBe("hidden");
    expect(model.feeCollection.kind).toBe("hidden");
    expect(model.activity.kind).toBe("hidden");
    expect(model.guardianAccess.kind).toBe("hidden");
  });

  it("hides every source for a principal with no grants", async () => {
    const model = await dashboardService.loadPrincipal([], { nowMs: Date.now() });
    expect(model.kpis).toEqual([]);
    expect(model.draftingState).toBe("hidden");
    expect(model.timetable.kind).toBe("hidden");
  });
});
