import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  familyContextService,
  RELATIONSHIPS_SESSION_KEY,
  type LinkRequestRecord,
} from "@/modules/services/family-context";
import { auditService, AUDIT_SESSION_KEY_EXPORT } from "@/modules/services/audit";
import {
  clearOutboxSession,
  enqueueOutboxEvent,
  listOutboxEvents,
  listPendingOutboxEvents,
  markOutboxEventDelivered,
} from "@/modules/services/outbox";
import { sessionRemove } from "@/modules/services/session";
import { financeService, FINANCE_SESSION_KEYS } from "@/modules/services/finance";
import { admissionsService, ADMISSIONS_SESSION_KEYS } from "@/modules/services/admissions";
import { convertApplication, ENROLLMENT_SESSION_KEYS } from "@/modules/services/enrollment";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const FIRDOUS_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";
const AARIF_ID = "00000000-0000-4000-8000-000000000901";
const MARIAM_ID = "00000000-0000-4000-8000-000000000902";
const ZOYA_ID = "00000000-0000-4000-8000-000000000903";

function clearAll(): void {
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
  clearOutboxSession();
  for (const key of Object.values(FINANCE_SESSION_KEYS)) sessionRemove(key);
  for (const key of Object.values(ENROLLMENT_SESSION_KEYS)) sessionRemove(key);
  for (const key of Object.values(ADMISSIONS_SESSION_KEYS)) sessionRemove(key);
}

beforeEach(() => {
  clearAll();
  setDemoNow(PINNED);
});

afterEach(() => {
  clearAll();
  setDemoNow(null);
});

describe("link-request store (plan.md Phase 3 unification)", () => {
  it("creates a deterministic pending request and returns the same ref on retry", async () => {
    const first = await familyContextService.createPendingLinkRequest(
      FIRDOUS_ACCOUNT_ID,
      "Firdous Ahmad",
      "STU-2026-0903",
      "Parent",
    );
    expect(first).toMatchObject({
      ref: "LR-2026-0101",
      guardianAccountId: FIRDOUS_ACCOUNT_ID,
      childAdmissionRef: "STU-2026-0903",
      status: "pending",
      version: 1,
    });
    expect(first.requestedAtIso).toBe(PINNED.toISOString());

    const retry = await familyContextService.createPendingLinkRequest(
      FIRDOUS_ACCOUNT_ID,
      "Firdous Ahmad",
      "stu-2026-0903",
      "Parent",
    );
    expect(retry.ref).toBe(first.ref);
    expect((await familyContextService.listLinkRequests()).filter((row) => row.request.status === "pending")).toHaveLength(1);
  });

  it("refuses a request for a child already actively linked to the account", async () => {
    await expect(
      familyContextService.createPendingLinkRequest(FIRDOUS_ACCOUNT_ID, "Firdous Ahmad", "STU-2026-0901", "Parent"),
    ).rejects.toMatchObject({ code: "already-linked" });
  });

  it("resolves the student row from the supplied reference for the staff screen", async () => {
    await familyContextService.createPendingLinkRequest(
      FIRDOUS_ACCOUNT_ID,
      "Firdous Ahmad",
      "STU-2026-0903",
      "Parent",
    );
    const rows = await familyContextService.listLinkRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.student?.displayName).toBe("Zoya Khan");
  });

  it("approves a request by creating exactly one active link; retries never duplicate", async () => {
    const request = await familyContextService.createPendingLinkRequest(
      FIRDOUS_ACCOUNT_ID,
      "Firdous Ahmad",
      "STU-2026-0903",
      "Parent",
    );

    const approved = await familyContextService.approvePendingLinkRequest(request.id);
    expect(approved).toMatchObject({ status: "approved", version: 2 });
    expect(approved.approvedLinkId).not.toBeNull();

    const retry = await familyContextService.approvePendingLinkRequest(request.id);
    expect(retry.approvedLinkId).toBe(approved.approvedLinkId);

    /* The child is now linked: one active link exists, and the portal can
       list Zoya alongside the original two children. */
    const accessible = await familyContextService.listAccessibleStudents(FIRDOUS_ACCOUNT_ID);
    expect(accessible.map((student) => student.id)).toEqual([AARIF_ID, MARIAM_ID, ZOYA_ID]);

    const links = (await familyContextService.listLinkRequests()).length;
    expect(links).toBe(1);

    /* Exactly one outbox event + one audit row for the approval. */
    const outbox = listOutboxEvents().filter((event) => event.kind === "link.approved");
    expect(outbox).toHaveLength(1);
    const audit = await auditService.listEvents();
    expect(audit.filter((event) => event.action === "Link approved")).toHaveLength(1);
  });

  it("rejects a request terminally and requires a visible reason", async () => {
    const request = await familyContextService.createPendingLinkRequest(
      FIRDOUS_ACCOUNT_ID,
      "Firdous Ahmad",
      "STU-2026-0903",
      "Parent",
    );
    await expect(familyContextService.rejectPendingLinkRequest(request.id, "   ")).rejects.toMatchObject({
      code: "request-not-pending",
    });

    const rejected = await familyContextService.rejectPendingLinkRequest(
      request.id,
      "The reference could not be verified.",
    );
    expect(rejected).toMatchObject({
      status: "rejected",
      rejectedReason: "The reference could not be verified.",
    });
    await expect(familyContextService.approvePendingLinkRequest(request.id)).rejects.toMatchObject({
      code: "request-not-pending",
    });
    /* The child stays unlinked. */
    const accessible = await familyContextService.listAccessibleStudents(FIRDOUS_ACCOUNT_ID);
    expect(accessible.map((student) => student.id)).toEqual([AARIF_ID, MARIAM_ID]);
  });

  it("rejects approval when the supplied reference matches no student record", async () => {
    const request = await familyContextService.createPendingLinkRequest(
      FIRDOUS_ACCOUNT_ID,
      "Firdous Ahmad",
      "ADM-2026-9999",
      "Parent",
    );
    await expect(familyContextService.approvePendingLinkRequest(request.id)).rejects.toMatchObject({
      code: "student-not-linked",
    });
    expect((await familyContextService.listLinkRequests())[0]?.request.status).toBe("pending");
  });

  it("records one audit row and one outbox event per raised request", async () => {
    await familyContextService.createPendingLinkRequest(
      FIRDOUS_ACCOUNT_ID,
      "Firdous Ahmad",
      "STU-2026-0903",
      "Parent",
    );
    const audit = await auditService.listEvents();
    expect(audit.filter((event) => event.action === "Link requested")).toHaveLength(1);
    expect(listOutboxEvents().filter((event) => event.kind === "link.requested")).toHaveLength(1);
  });
});

describe("classifyStudentAccess (wrong-child resource scope)", () => {
  it("treats null-owned records as current", async () => {
    expect(await familyContextService.classifyStudentAccess(FIRDOUS_ACCOUNT_ID, null)).toBe("current");
  });

  it("classifies the active child as current, a sibling as other, and an unlinked child as none", async () => {
    await familyContextService.setActiveStudent(FIRDOUS_ACCOUNT_ID, MARIAM_ID);
    expect(await familyContextService.classifyStudentAccess(FIRDOUS_ACCOUNT_ID, MARIAM_ID)).toBe("current");
    expect(await familyContextService.classifyStudentAccess(FIRDOUS_ACCOUNT_ID, AARIF_ID)).toBe("other");
    expect(await familyContextService.classifyStudentAccess(FIRDOUS_ACCOUNT_ID, ZOYA_ID)).toBe("none");
  });

  it("falls back to the default selection when nothing is stored", async () => {
    expect(await familyContextService.classifyStudentAccess(FIRDOUS_ACCOUNT_ID, AARIF_ID)).toBe("current");
    expect(await familyContextService.classifyStudentAccess(FIRDOUS_ACCOUNT_ID, MARIAM_ID)).toBe("other");
  });
});

describe("demo outbox (plan.md Phase 4)", () => {
  it("enqueues once per event id, lists pending, and marks delivered", () => {
    const first = enqueueOutboxEvent({
      eventId: "results.published:RB-2026-0138",
      kind: "results.published",
      targetRef: "RB-2026-0138",
      actor: "Exam office",
    });
    const retry = enqueueOutboxEvent({
      eventId: "results.published:RB-2026-0138",
      kind: "results.published",
      targetRef: "RB-2026-0138",
      actor: "Exam office",
    });
    expect(retry.eventId).toBe(first.eventId);
    expect(listOutboxEvents()).toHaveLength(1);

    expect(listPendingOutboxEvents()).toHaveLength(1);
    const delivered = markOutboxEventDelivered(first.eventId);
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAtIso).toBe(PINNED.toISOString());
    expect(listPendingOutboxEvents()).toHaveLength(0);
    expect(listOutboxEvents()[0]?.status).toBe("delivered");
  });

  it("records versioned event ids as distinct events", () => {
    enqueueOutboxEvent({ eventId: "results.published:RB-2026-0138:v1", kind: "results.published", targetRef: "RB-2026-0138", actor: "Exam office" });
    enqueueOutboxEvent({ eventId: "results.published:RB-2026-0138:v2", kind: "results.published", targetRef: "RB-2026-0138", actor: "Exam office" });
    expect(listOutboxEvents()).toHaveLength(2);
  });
});

describe("consequential writes never duplicate delivery events", () => {
  it("confirmSuccess twice posts one payment and one outbox event", async () => {
    /* Accept the offered seat — this issues the admission invoice. */
    const accepted = await admissionsService.respondToOffer("APP-2026-0417", true, "Applicant");
    const invoiceRef = accepted.offer!.admissionInvoiceRef!;
    const view = await financeService.getInvoice(invoiceRef);
    expect(view).not.toBeNull();

    const attempt = await financeService.createPaymentAttempt(invoiceRef, "UPI", view!.balancePaise);
    let refreshed = await financeService.refreshAttempt(attempt.id);
    while (refreshed.status !== "succeeded") {
      refreshed = await financeService.refreshAttempt(attempt.id);
    }

    const first = await financeService.confirmSuccess(attempt.id);
    const second = await financeService.confirmSuccess(attempt.id);
    expect(second.receipt.ref).toBe(first.receipt.ref);

    const posted = listOutboxEvents().filter((event) => event.kind === "payment.posted");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.targetRef).toBe(first.receipt.ref);
    const audit = await auditService.listEvents();
    expect(audit.filter((event) => event.action === "Payment posted")).toHaveLength(1);
  });

  it("convertApplication twice creates one conversion event and one audit row", async () => {
    /* Full admission → fee → conversion path, then retry the conversion. */
    const accepted = await admissionsService.respondToOffer("APP-2026-0417", true, "Applicant");
    const invoiceRef = accepted.offer!.admissionInvoiceRef!;
    const view = await financeService.getInvoice(invoiceRef);
    const attempt = await financeService.createPaymentAttempt(invoiceRef, "UPI", view!.balancePaise);
    let refreshed = await financeService.refreshAttempt(attempt.id);
    while (refreshed.status !== "succeeded") {
      refreshed = await financeService.refreshAttempt(attempt.id);
    }
    await financeService.confirmSuccess(attempt.id);

    const first = await convertApplication("APP-2026-0417");
    const second = await convertApplication("APP-2026-0417");
    expect(second.studentRef).toBe(first.studentRef);
    expect(second.matchedExisting).toBe(first.matchedExisting);

    expect(listOutboxEvents().filter((event) => event.kind === "enrollment.converted")).toHaveLength(1);
    const audit = await auditService.listEvents();
    expect(audit.filter((event) => event.action === "Enrollment converted")).toHaveLength(1);
  });
});

/* Re-export for typing convenience in follow-up tests. */
export type { LinkRequestRecord };
