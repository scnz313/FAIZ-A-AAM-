/**
 * Applicant document upload boundary regression: the browser must run
 * authorized intent -> signed private upload -> server finalization in order,
 * and it must refuse an oversized or disallowed file before making any
 * request. All files are synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadToSignedUrl = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    storage: {
      from: () => ({ uploadToSignedUrl }),
    },
  }),
}));

import { uploadDocumentFile } from "@/modules/services/document-upload";

function pdfFile(bytes = 69): File {
  const body = new Uint8Array(bytes);
  body.set(new TextEncoder().encode("%PDF-1.4\n"), 0);
  return new File([body], "birth-certificate.pdf", { type: "application/pdf" });
}

beforeEach(() => {
  uploadToSignedUrl.mockReset();
  uploadToSignedUrl.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadDocumentFile", () => {
  it("runs upload intent -> signed storage upload -> finalize for an admission application", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/documents/upload-intent")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          ownerDomain: "admission_application",
          ownerRecordRef: "APP-2026-0001",
          attachmentCode: "birth",
          filename: "birth-certificate.pdf",
          mimeType: "application/pdf",
        });
        return new Response(JSON.stringify({
          ok: true,
          documentRef: "DOC-2026-0001",
          objectKey: "uploads/11111111-1111-4111-8111-111111111111.pdf",
          token: "signed-token",
          bucket: "fass-private-documents",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/documents/DOC-2026-0001/finalize")) {
        return new Response(JSON.stringify({
          ok: true,
          documentRef: "DOC-2026-0001",
          state: "pending_scan",
          checksumVerified: true,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = pdfFile();
    const result = await uploadDocumentFile({
      ownerDomain: "admission_application",
      ownerRecordRef: "APP-2026-0001",
      attachmentCode: "birth",
      file,
    });

    expect(result).toEqual({ documentRef: "DOC-2026-0001", status: "pending_scan" });
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      "uploads/11111111-1111-4111-8111-111111111111.pdf",
      "signed-token",
      file,
      { contentType: "application/pdf" },
    );
    expect(calls[0]).toContain("/api/documents/upload-intent");
    expect(calls.at(-1)).toContain("/api/documents/DOC-2026-0001/finalize");
  });

  it("returns ready when finalization completes the scan", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/upload-intent")) {
        return new Response(JSON.stringify({ ok: true, documentRef: "DOC-2026-0002", objectKey: "uploads/x.pdf", token: "t", bucket: "b" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, documentRef: "DOC-2026-0002", state: "ready", checksumVerified: true }), { status: 200 });
    }));

    const result = await uploadDocumentFile({
      ownerDomain: "admission_application",
      ownerRecordRef: "APP-2026-0001",
      attachmentCode: "photo",
      file: pdfFile(),
    });

    expect(result).toEqual({ documentRef: "DOC-2026-0002", status: "ready" });
  });

  it("passes a school document through the same intent -> signed upload -> finalize boundary", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/documents/upload-intent")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          ownerDomain: "school_document",
          ownerRecordRef: "00000000-0000-4000-8000-000000000203",
          attachmentCode: "circular",
          filename: "holiday-circular.pdf",
          mimeType: "application/pdf",
        });
        return new Response(JSON.stringify({
          ok: true,
          documentRef: "DOC-2026-SCHOOL",
          objectKey: "uploads/22222222-2222-4222-8222-222222222222.pdf",
          token: "signed-token",
          bucket: "fass-private-documents",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        ok: true,
        documentRef: "DOC-2026-SCHOOL",
        state: "pending_scan",
        checksumVerified: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadDocumentFile({
      ownerDomain: "school_document",
      ownerRecordRef: "00000000-0000-4000-8000-000000000203",
      attachmentCode: "circular",
      file: new File([new Uint8Array(69)], "holiday-circular.pdf", { type: "application/pdf" }),
    });

    expect(result).toEqual({ documentRef: "DOC-2026-SCHOOL", status: "pending_scan" });
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    expect(calls[0]).toContain("/api/documents/upload-intent");
    expect(calls.at(-1)).toContain("/api/documents/DOC-2026-SCHOOL/finalize");
  });

  it("refuses an oversized file before any network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadDocumentFile({
      ownerDomain: "admission_application",
      ownerRecordRef: "APP-2026-0001",
      attachmentCode: "birth",
      file: pdfFile(200),
      maxBytes: 100,
    })).rejects.toThrow(/larger than the configured document limit/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("refuses a disallowed MIME type before any network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadDocumentFile({
      ownerDomain: "admission_application",
      ownerRecordRef: "APP-2026-0001",
      attachmentCode: "photo",
      file: pdfFile(),
      allowedMimeTypes: ["image/jpeg", "image/png"],
    })).rejects.toThrow(/not allowed for the selected document/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
