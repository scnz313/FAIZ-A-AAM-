import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  familyContextService,
  RELATIONSHIPS_SESSION_KEY,
} from "@/modules/services/family-context";
import { admissionsService, ADMISSIONS_SESSION_KEYS } from "@/modules/services/admissions";
import {
  convertApplication,
  ENROLLMENT_SESSION_KEYS,
  EnrollmentConversionError,
  getEnrollmentReadiness,
} from "@/modules/services/enrollment";
import { financeService, FINANCE_SESSION_KEYS } from "@/modules/services/finance";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const IDENTITY_SESSION_KEY = sessionKey("identity");

const FIRDOUS_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";
const AARIF_ID = "00000000-0000-4000-8000-000000000901";
const CLASS_8A_SECTION_ID = "00000000-0000-4000-8000-000000000702";

function clearDemoSession(): void {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  for (const key of Object.values(ADMISSIONS_SESSION_KEYS)) sessionRemove(key);
  for (const key of Object.values(FINANCE_SESSION_KEYS)) sessionRemove(key);
  for (const key of Object.values(ENROLLMENT_SESSION_KEYS)) sessionRemove(key);
}

beforeEach(() => {
  clearDemoSession();
  setDemoNow(PINNED);
});

afterEach(() => {
  clearDemoSession();
  setDemoNow(null);
});

/** Accept an offered seat (issues the admission invoice once). */
async function acceptOffer(ref: string): Promise<string> {
  const accepted = await admissionsService.respondToOffer(ref, true, "Applicant");
  return accepted.offer!.admissionInvoiceRef!;
}

/** Pay an invoice in full through the demo gateway. */
async function payInvoice(invoiceRef: string): Promise<void> {
  const view = await financeService.getInvoice(invoiceRef);
  if (!view || view.balancePaise <= 0) throw new Error("Expected an unpaid invoice.");
  const attempt = await financeService.createPaymentAttempt(invoiceRef, "UPI", view.balancePaise);
  await financeService.refreshAttempt(attempt.id);
  const succeeded = await financeService.refreshAttempt(attempt.id);
  expect(succeeded.status).toBe("succeeded");
  await financeService.confirmSuccess(attempt.id);
}

/** Accept an offered seat and pay the issued admission invoice in full. */
async function acceptAndPay(ref: string): Promise<string> {
  const invoiceRef = await acceptOffer(ref);
  await payInvoice(invoiceRef);
  return invoiceRef;
}

/** Submit a fresh application and move it through review → assessment → offer. */
async function submitAndOffer(draft: Parameters<typeof admissionsService.submitApplication>[0]): Promise<string> {
  const { ref } = await admissionsService.submitApplication(draft);
  await admissionsService.staffMoveToAssessment(ref);
  await admissionsService.staffOfferSeat(ref, "Meets the entry criteria.");
  return ref;
}

/** A valid demo application draft — every field is fictional. */
function demoDraft(overrides: { studentName: string; grade: string; parentName: string }): Parameters<typeof admissionsService.submitApplication>[0] {
  return {
    session: "2026-27",
    grade: overrides.grade,
    studentName: overrides.studentName,
    dob: "2015-03-14",
    gender: "Male",
    placeOfBirth: "Bandipora",
    guardianName: overrides.parentName,
    relation: "Father",
    phone: "+91 90000 00000",
    email: "guardian@example.com",
    occupation: "Teacher",
    houseStreet: "School Road",
    villageTown: "Bandipora",
    district: "Bandipora",
    pin: "193502",
    priorSchoolName: "Govt Boys High School",
    lastClassAttended: "Class 7",
    leavingCertificate: "Available",
    conditions: [],
    documents: { birth: "demo", photo: "demo", reportCard: "demo", addressProof: "demo" },
    consent: true,
  };
}

describe("enrollment readiness", () => {
  it("rejects unknown applications and reports the gates that block readiness", async () => {
    await expect(getEnrollmentReadiness("APP-2026-0999")).rejects.toMatchObject({
      code: "application-not-found",
    });

    const notOffered = await getEnrollmentReadiness("APP-2026-0422");
    expect(notOffered).toMatchObject({ offered: false, ready: false });
    expect(notOffered.reason).toMatch(/no offered seat/i);

    const notAccepted = await getEnrollmentReadiness("APP-2026-0417");
    expect(notAccepted).toMatchObject({ offered: true, accepted: false, ready: false });
    expect(notAccepted.reason).toMatch(/not been accepted/i);

    const accepted = await admissionsService.respondToOffer("APP-2026-0417", true, "Applicant");
    const unpaid = await getEnrollmentReadiness("APP-2026-0417");
    expect(unpaid).toMatchObject({ accepted: true, admissionInvoiceRef: accepted.offer!.admissionInvoiceRef, feePaid: false });
    expect(unpaid.reason).toMatch(/not been recorded as paid/i);

    await payInvoice(accepted.offer!.admissionInvoiceRef!);
    const ready = await getEnrollmentReadiness("APP-2026-0417");
    expect(ready).toMatchObject({ ready: true, feePaid: true, documentsComplete: true, capacityAvailable: true, finalApproved: true });
    expect(ready.reason).toBeNull();
  }, 15_000);

  it("issues the admission invoice exactly once at acceptance", async () => {
    const first = await admissionsService.respondToOffer("APP-2026-0417", true, "Applicant");
    expect(first.offer?.admissionInvoiceRef).toBe("INV-2026-0301");
    expect(first.timeline.at(-1)?.note).toContain("INV-2026-0301");

    const view = await financeService.getInvoice("INV-2026-0301");
    expect(view).toMatchObject({ studentId: null, balancePaise: 200000 });
    expect(view?.invoice.applicantRef).toBe("APP-2026-0417");

    /* A second acceptance attempt is rejected; the invoice is not duplicated. */
    await expect(admissionsService.respondToOffer("APP-2026-0417", true, "Applicant")).rejects.toThrow(/already been responded/);
    expect((await financeService.listAllInvoices()).filter((item) => item.invoice.applicantRef === "APP-2026-0417")).toHaveLength(1);
  });
});

describe("enrollment conversion", () => {
  it("denies conversion before the admission fee is paid", async () => {
    await admissionsService.respondToOffer("APP-2026-0417", true, "Applicant");
    await expect(convertApplication("APP-2026-0417")).rejects.toMatchObject({ code: "fee-unpaid" });
    expect(await admissionsService.getApplication("APP-2026-0417")).toMatchObject({ status: "Offered" });
  }, 15_000);

  it("matches the already-enrolled student when the application is for the same child", async () => {
    /* APP-2026-0417 is the original admission application of the already
       enrolled Aarif — conversion confirms his records, never duplicates. */
    await acceptAndPay("APP-2026-0417");

    const result = await convertApplication("APP-2026-0417");
    expect(result).toMatchObject({
      applicationRef: "APP-2026-0417",
      studentRef: "STU-2026-0901",
      enrollmentRef: "ENR-2026-1202",
      linkId: "00000000-0000-4000-8000-000000001101",
      portalAvailable: true,
      matchedExisting: true,
    });
    expect(result.createdAtIso).toBe(PINNED.toISOString());

    /* The application is Enrolled with its permanent references. */
    const record = await admissionsService.getApplication("APP-2026-0417");
    expect(record).toMatchObject({ status: "Enrolled", studentRef: "STU-2026-0901", enrollmentRef: "ENR-2026-1202" });
    expect(record?.timeline.at(-1)?.status).toBe("Enrolled");

    /* Retry is idempotent — same references, no duplicate records, no
       second timeline event, and no new child in the portal. */
    expect(await convertApplication("APP-2026-0417")).toEqual(result);
    expect(await familyContextService.listAccessibleStudentContexts(FIRDOUS_ACCOUNT_ID)).toHaveLength(2);
    expect((await admissionsService.getApplication("APP-2026-0417"))?.timeline.filter((e) => e.status === "Enrolled")).toHaveLength(1);
  }, 15_000);

  it("creates a new student, enrollment, and guardian link for a fresh application", async () => {
    /* A brand-new application for a child not on the register: conversion
       creates the permanent records and activates the guardian link. */
    const ref = await submitAndOffer(
      demoDraft({ studentName: "Tawseef Ganie", grade: "Class 8", parentName: "Firdous Ahmad" }),
    );
    await acceptAndPay(ref);

    const result = await convertApplication(ref);
    expect(result).toMatchObject({
      studentRef: "STU-2026-0904",
      enrollmentRef: "ENR-2026-1206",
      linkId: "00000000-0000-4000-8000-000000001106",
      portalAvailable: true,
      matchedExisting: false,
    });

    /* The converted child is visible in the guardian portal with placement. */
    const contexts = await familyContextService.listAccessibleStudentContexts(FIRDOUS_ACCOUNT_ID);
    expect(contexts).toHaveLength(3);
    const converted = contexts.find((item) => item.student.ref === "STU-2026-0904");
    expect(converted).toMatchObject({
      enrollment: expect.objectContaining({ status: "active", gradeSectionId: CLASS_8A_SECTION_ID }),
      gradeSection: expect.objectContaining({ gradeLabel: "Class 8", sectionLabel: "A" }),
      academicYear: expect.objectContaining({ status: "current" }),
    });
    /* The first active enrollment stays the default selection. */
    expect((await familyContextService.getContext(FIRDOUS_ACCOUNT_ID)).activeStudentId).toBe(AARIF_ID);

    /* The paid admission invoice and receipt are adopted into the new ledger. */
    const studentLedger = await financeService.listInvoices(result.studentId);
    const admission = studentLedger.find((view) => view.invoice.ref === "INV-2026-0301");
    expect(admission).toMatchObject({ status: "paid", balancePaise: 0, studentId: result.studentId });
    expect(admission?.invoice.applicantRef).toBeNull();
    expect(admission?.receipts[0]?.studentId).toBe(result.studentId);

    /* Retry never duplicates. */
    expect((await convertApplication(ref)).studentRef).toBe("STU-2026-0904");
    expect(await familyContextService.listAccessibleStudentContexts(FIRDOUS_ACCOUNT_ID)).toHaveLength(3);
  }, 20_000);

  it("converts a second Class 8 application to distinct records; unknown guardians enroll without portal access", async () => {
    /* Two creations in one session: records must not collide. */
    const refA = await submitAndOffer(
      demoDraft({ studentName: "Tawseef Ganie", grade: "Class 8", parentName: "Firdous Ahmad" }),
    );
    await acceptAndPay(refA);
    const first = await convertApplication(refA);
    expect(first.studentRef).toBe("STU-2026-0904");

    /* APP-2026-0423's parent is not in the graph — the child enrolls but
       no guardian link is activated (portalAvailable false). */
    await admissionsService.staffMoveToAssessment("APP-2026-0423");
    await admissionsService.staffOfferSeat("APP-2026-0423", "Meets the entry criteria for Class 8.");
    await acceptAndPay("APP-2026-0423");

    const second = await convertApplication("APP-2026-0423");
    expect(second).toMatchObject({ studentRef: "STU-2026-0905", enrollmentRef: "ENR-2026-1207", linkId: null, portalAvailable: false, matchedExisting: false });
    expect(second.studentId).not.toBe(first.studentId);
    expect((await admissionsService.getApplication("APP-2026-0423"))?.status).toBe("Enrolled");
  }, 25_000);

  it("rejects conversion when no section is configured for the grade", async () => {
    /* APP-2026-0418 is already in Assessment in the fixture queue. */
    await admissionsService.staffOfferSeat("APP-2026-0418", "Seat offered for Class 6.");
    await acceptAndPay("APP-2026-0418");

    try {
      await convertApplication("APP-2026-0418");
      expect.unreachable("Expected a no-section-for-grade error.");
    } catch (error) {
      expect(error).toBeInstanceOf(EnrollmentConversionError);
      expect((error as EnrollmentConversionError).code).toBe("no-section-for-grade");
    }
    /* No partial conversion state was left behind. */
    expect((await admissionsService.getApplication("APP-2026-0418"))?.status).toBe("Offered");
    expect(await familyContextService.listAccessibleStudents(FIRDOUS_ACCOUNT_ID)).toHaveLength(2);
  }, 15_000);
});
