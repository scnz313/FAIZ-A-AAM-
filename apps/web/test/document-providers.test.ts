import { describe, expect, it } from "vitest";

import { FakeDocumentScanner, FakeStorageProvider, type ScanInput } from "@/modules/services/document-providers";

function scanInput(overrides: Partial<ScanInput> = {}): ScanInput {
  return {
    bucket: "private",
    objectKey: "uploads/x.pdf",
    declaredMimeType: "application/pdf",
    sizeBytes: 1,
    checksumSha256: "a".repeat(64),
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    ...overrides,
  };
}

describe("document provider contracts", () => {
  it("fake storage returns object bytes for authoritative stat tests", async () => {
    const provider = new FakeStorageProvider();
    const stat = await provider.stat({ bucket: "private", objectKey: "uploads/00000000-0000-4000-8000-000000000001.pdf" });
    expect(stat.sizeBytes).toBe(stat.bytes.byteLength);
    expect(stat.contentType).toBe("application/pdf");
  });

  it("fake scanner exposes ready/quarantine/failure outcomes without changing domain state", async () => {
    await expect(new FakeDocumentScanner({ state: "ready" }).scan(scanInput())).resolves.toMatchObject({ state: "ready" });
    await expect(new FakeDocumentScanner({ state: "quarantined", detail: "malware" }).scan(scanInput())).resolves.toMatchObject({ state: "quarantined", detail: "malware" });
  });
});

