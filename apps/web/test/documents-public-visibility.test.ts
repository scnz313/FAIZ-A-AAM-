// @vitest-environment node
/**
 * Staff public-register approval contract: the service delegates to the
 * registered `documents.setPublicVisibility` adapter operation, returns the
 * persisted visibility, and surfaces the server's honest refusal message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({
  call: vi.fn(),
  mode: vi.fn(() => "demo" as "demo" | "supabase"),
}));

vi.mock("@/modules/services/adapter-client", () => ({
  adapterCall: adapterMocks.call,
  clientAdapterMode: adapterMocks.mode,
}));

import { documentsService, mapPrivateDocumentMetadata } from "@/modules/services/documents";

beforeEach(() => {
  adapterMocks.call.mockReset();
  adapterMocks.mode.mockReset();
  adapterMocks.mode.mockReturnValue("supabase");
});

describe("documentsService.setPublicVisibility", () => {
  it("calls the registered adapter operation and returns the persisted visibility", async () => {
    adapterMocks.call.mockResolvedValue({
      ok: true,
      value: { reference: "DOC-2026-0001", visibility: "public_approved" },
    });

    await expect(documentsService.setPublicVisibility("DOC-2026-0001", "public_approved")).resolves.toEqual({
      ref: "DOC-2026-0001",
      visibility: "public_approved",
    });
    expect(adapterMocks.call).toHaveBeenCalledWith("documents.setPublicVisibility", {
      reference: "DOC-2026-0001",
      visibility: "public_approved",
    });
  });

  it("sends the withdraw command unchanged", async () => {
    adapterMocks.call.mockResolvedValue({
      ok: true,
      value: { reference: "DOC-2026-0001", visibility: "private" },
    });

    await expect(documentsService.setPublicVisibility("DOC-2026-0001", "private")).resolves.toEqual({
      ref: "DOC-2026-0001",
      visibility: "private",
    });
    expect(adapterMocks.call).toHaveBeenCalledWith("documents.setPublicVisibility", {
      reference: "DOC-2026-0001",
      visibility: "private",
    });
  });

  it("surfaces the honest server refusal for a quarantined document", async () => {
    adapterMocks.call.mockResolvedValue({
      ok: false,
      errors: [
        {
          code: "conflict",
          message: "This document is quarantined. Resolve the scan finding before approving it for public view.",
          field: null,
        },
      ],
    });

    await expect(documentsService.setPublicVisibility("DOC-2026-0002", "public_approved")).rejects.toThrow(
      /quarantined/,
    );
  });

  it("is unavailable in demo mode and never reaches the adapter", async () => {
    adapterMocks.mode.mockReturnValue("demo");

    await expect(documentsService.setPublicVisibility("DOC-2026-0001", "public_approved")).rejects.toThrow(
      /demo mode/,
    );
    expect(adapterMocks.call).not.toHaveBeenCalled();
  });
});

describe("document visibility projection", () => {
  it("defaults missing visibility to private and preserves public approval", () => {
    expect(mapPrivateDocumentMetadata({ reference: "DOC-2026-0001" }).visibility).toBe("private");
    expect(mapPrivateDocumentMetadata({ reference: "DOC-2026-0002", visibility: "public_approved" }).visibility).toBe(
      "public_approved",
    );
    expect(mapPrivateDocumentMetadata({ reference: "DOC-2026-0003", visibility: "unexpected" }).visibility).toBe(
      "private",
    );
  });
});
