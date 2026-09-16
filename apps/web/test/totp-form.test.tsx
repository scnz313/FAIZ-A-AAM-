/**
 * TotpForm factor selection: a verified "Staff access" factor is challenged;
 * verified "Dev auto-elevation" factors are purged server-side before a fresh
 * enrolment; stale unverified real factors are unenrolled client-side first.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mfaMocks = vi.hoisted(() => ({
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn().mockResolvedValue({ error: null }),
  challenge: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { mfa: mfaMocks } }),
}));

import TotpForm from "@/components/identity/TotpForm";

const ENROLLED = {
  data: { id: "new-factor", totp: { qr_code: "otpauth://qr", secret: "JBSWY3DPEHPK3PXP" } },
  error: null,
};

function factors(list: Array<{ id: string; friendly_name: string; status: string }>) {
  mfaMocks.listFactors.mockResolvedValue({ data: { totp: list, all: list }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  mfaMocks.unenroll.mockResolvedValue({ error: null });
  mfaMocks.enroll.mockResolvedValue(ENROLLED);
});

afterEach(() => vi.unstubAllGlobals());

describe("TotpForm factor selection", () => {
  it("challenges a verified real factor", async () => {
    factors([{ id: "real-1", friendly_name: "Staff access", status: "verified" }]);

    render(<TotpForm adapter="supabase" totpRequired />);

    await waitFor(() => expect(screen.getByText(/enter the current code/i)).toBeTruthy());
    expect(mfaMocks.enroll).not.toHaveBeenCalled();
  });

  it("purges verified dev factors then enrols fresh", async () => {
    factors([
      { id: "dev-1", friendly_name: "Dev auto-elevation", status: "verified" },
      { id: "dev-2", friendly_name: "Dev auto-elevation", status: "unverified" },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ removed: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TotpForm adapter="supabase" totpRequired />);

    await waitFor(() => expect(screen.getByText(/one-time setup/i)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/mfa/purge-dev-factors",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mfaMocks.enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "Staff access" });
  });

  it("does not purge when a verified real factor exists alongside a dev factor", async () => {
    factors([
      { id: "dev-1", friendly_name: "Dev auto-elevation", status: "verified" },
      { id: "real-1", friendly_name: "Staff access", status: "verified" },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<TotpForm adapter="supabase" totpRequired />);

    await waitFor(() => expect(screen.getByText(/enter the current code/i)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mfaMocks.enroll).not.toHaveBeenCalled();
  });

  it("unenrols a stale unverified Staff access factor before enrolling", async () => {
    factors([{ id: "stale-1", friendly_name: "Staff access", status: "unverified" }]);

    render(<TotpForm adapter="supabase" totpRequired />);

    await waitFor(() => expect(screen.getByText(/one-time setup/i)).toBeTruthy());
    expect(mfaMocks.unenroll).toHaveBeenCalledWith({ factorId: "stale-1" });
    expect(mfaMocks.enroll).toHaveBeenCalled();
  });

  it("enrols fresh when no factors exist", async () => {
    factors([]);

    render(<TotpForm adapter="supabase" totpRequired />);

    await waitFor(() => expect(screen.getByText(/one-time setup/i)).toBeTruthy());
    expect(mfaMocks.enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "Staff access" });
  });

  it("shows the error state when enrolment fails", async () => {
    factors([]);
    mfaMocks.enroll.mockResolvedValue({ data: null, error: { message: "factor already exists" } });

    render(<TotpForm adapter="supabase" totpRequired />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/setup could not start/i));
  });
});
