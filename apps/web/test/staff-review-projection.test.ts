/**
 * Staff review projection regressions: reviewer identity never leaks a raw
 * account id into the interface, and the admissions document list tells the
 * current upload apart from superseded earlier uploads.
 */
import { describe, expect, it } from "vitest";

import { currentDocumentReferences, staffReviewKey, timelineEventKey } from "@/components/staff/ApplicationReview";
import { contactDetailRows, documentLabel, mergeAttachedDocuments, reviewerDisplayName } from "@/components/staff/JobReview";
import { queueReviewerLabel } from "@/components/staff/CareersQueue";

describe("contactDetailRows", () => {
  it("shows the recorded contact identity for an anonymous applicant", () => {
    expect(contactDetailRows({ contactEmail: "zareen@example.test", contactPhone: "+91 90000 12345" })).toEqual([
      { label: "Email", value: "zareen@example.test" },
      { label: "Phone", value: "+91 90000 12345" },
    ]);
  });

  it("omits absent or blank values instead of inventing a placeholder", () => {
    expect(contactDetailRows({})).toEqual([]);
    expect(contactDetailRows({ contactEmail: "   ", contactPhone: undefined })).toEqual([]);
  });
});

describe("queueReviewerLabel", () => {
  const timeline = [{ status: "Shortlisted" as const, atIso: "2026-09-15T06:00:00.000Z", actor: "HR office", note: "" }];

  it("states the live assignment honestly instead of borrowing the last actor", () => {
    expect(queueReviewerLabel({ reviewerAccountId: "9f101233-8cd6-4fc0-bbb7-1900e6a9d50f", timeline }, false)).toBe("Assigned reviewer");
    expect(queueReviewerLabel({ timeline }, false)).toBe("—");
  });

  it("keeps the demo fixture reviewer actor for demo records", () => {
    expect(queueReviewerLabel({ timeline }, true)).toBe("HR office");
  });
});

describe("reviewerDisplayName", () => {
  it("resolves an account id from the loaded directory", () => {
    expect(
      reviewerDisplayName("9f101233-8cd6-4fc0-bbb7-1900e6a9d50f", [
        { accountId: "9f101233-8cd6-4fc0-bbb7-1900e6a9d50f", name: "Aam Principal" },
      ]),
    ).toBe("Aam Principal");
  });

  it("never renders an unresolved raw account id as a name", () => {
    expect(reviewerDisplayName("9f101233-8cd6-4fc0-bbb7-1900e6a9d50f", [])).toBe("Assigned reviewer");
  });

  it("passes through a recorded reviewer name and treats blanks as unassigned", () => {
    expect(reviewerDisplayName("HR office", [])).toBe("HR office");
    expect(reviewerDisplayName(undefined, [])).toBeNull();
    expect(reviewerDisplayName("   ", [])).toBeNull();
  });
});

describe("documentLabel", () => {
  it("humanizes requirement codes and categories", () => {
    expect(documentLabel("profile_photo")).toBe("Profile photo");
    expect(documentLabel("identity-proof")).toBe("Identity proof");
    expect(documentLabel("profile_photo_scan")).toBe("Profile photo scan");
  });

  it("never renders an empty label", () => {
    expect(documentLabel("")).toBe("Document");
    expect(documentLabel("___")).toBe("Document");
  });
});

describe("mergeAttachedDocuments", () => {
  const linked = {
    requirementCode: "profile_photo",
    reference: "DOC-2026-6187D7",
    filename: "pi-profile-photo.png",
    category: "profile_photo",
    scanStatus: "ready",
    mimeType: "image/png",
    sizeBytes: 89,
    uploadedAtIso: "2026-09-15T02:04:50.978Z",
  };

  it("adds a linked attachment with its humanized label and filename", () => {
    const merged = mergeAttachedDocuments(undefined, [linked]);

    expect(merged).toEqual([{ label: "Profile photo", reference: "DOC-2026-6187D7", filename: "pi-profile-photo.png" }]);
  });

  it("keeps snapshot documents and dedupes a linked reference already present", () => {
    const merged = mergeAttachedDocuments({ documents: { CV: "DOC-2026-6187D7" } }, [linked]);

    expect(merged).toEqual([{ label: "CV", reference: "DOC-2026-6187D7" }]);
  });

  it("tolerates a malformed snapshot document map", () => {
    expect(mergeAttachedDocuments({ documents: ["not-a-map"] }, [linked])).toHaveLength(1);
    expect(mergeAttachedDocuments(undefined, [])).toEqual([]);
  });
});

describe("currentDocumentReferences", () => {
  it("marks the newest upload per requirement as current", () => {
    const current = currentDocumentReferences([
      { reference: "DOC-1", requirementCode: "birth", category: "admission_document", uploadedAtIso: "2026-09-11T10:00:00.000Z" },
      { reference: "DOC-2", requirementCode: "birth", category: "admission_document", uploadedAtIso: "2026-09-12T10:00:00.000Z" },
      { reference: "DOC-3", requirementCode: "photo", category: "admission_document", uploadedAtIso: "2026-09-11T10:00:00.000Z" },
    ]);

    expect(current.has("DOC-2")).toBe(true);
    expect(current.has("DOC-1")).toBe(false);
    expect(current.has("DOC-3")).toBe(true);
  });

  it("falls back to the category when a requirement code is absent", () => {
    const current = currentDocumentReferences([
      { reference: "DOC-A", category: "admission_document", uploadedAtIso: "2026-09-11T10:00:00.000Z" },
      { reference: "DOC-B", category: "admission_document", uploadedAtIso: "2026-09-12T10:00:00.000Z" },
    ]);

    expect([...current]).toEqual(["DOC-B"]);
  });
});

describe("timeline sibling keys", () => {
  it("keeps offer events distinct when they share a status and timestamp", () => {
    const first = { status: "Offered" as const, atIso: "2026-09-15T16:52:00.000Z" };
    const second = { status: "Offered" as const, atIso: "2026-09-15T16:52:00.000Z" };
    const keys = [first, second].map((event, index) => timelineEventKey(event, index));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps staff review notes distinct when recorded together", () => {
    const review = { action: "reviewed", atIso: "2026-09-15T15:13:00.000Z" };
    const keys = [review, review].map((entry, index) => staffReviewKey(entry, index));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
