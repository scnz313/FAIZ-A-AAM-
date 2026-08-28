import { describe, expect, it } from "vitest";

import { FakeDocumentScanner, FakeStorageProvider } from "@/modules/services/document-providers";

describe("document provider contracts", () => {
  it("fake storage returns object bytes for authoritative stat tests", async () => {
    const provider = new FakeStorageProvider();
    const stat = await provider.stat({ bucket: "private", objectKey: "uploads/00000000-0000-4000-8000-000000000001.pdf" });
    expect(stat.sizeBytes).toBe(stat.bytes.byteLength);
    expect(stat.contentType).toBe("application/pdf");
  });

  it("fake scanner exposes ready/quarantine/failure outcomes without changing domain state", async () => {
    await expect(new FakeDocumentScanner({ state: "ready" }).scan({ bucket: "private", objectKey: "uploads/x.pdf", declaredMimeType: "application/pdf", sizeBytes: 1, checksumSha256: "a" })).resolves.toMatchObject({ state: "ready" });
    await expect(new FakeDocumentScanner({ state: "quarantined", detail: "malware" }).scan({ bucket: "private", objectKey: "uploads/x.pdf", declaredMimeType: "application/pdf", sizeBytes: 1, checksumSha256: "a" })).resolves.toMatchObject({ state: "quarantined", detail: "malware" });
  });
});

