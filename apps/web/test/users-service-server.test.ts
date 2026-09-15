/**
 * Users service — Supabase-mode directory projection regressions.
 *
 * The staff-access directory must list staff only (accounts with a staff
 * record) plus invitation-only rows, and it must never mislabel a failed or
 * revoked invitation as an Active account. These pin the mapping rules that
 * the live `/administrator/users` surface depends on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({
  call: vi.fn(),
  mode: vi.fn(() => "supabase" as "demo" | "supabase"),
}));

vi.mock("@/modules/services/adapter-client", () => ({
  adapterCall: adapterMocks.call,
  clientAdapterMode: adapterMocks.mode,
}));

import { usersService } from "@/modules/services/users";

type DirectoryRow = {
  id: string;
  status: string;
  verified_contact: string | null;
  mfa_status?: string | null;
  people: { display_name: string };
  staff_members: Array<{
    id: string;
    reference: string;
    title: string | null;
    employment_status: string;
    access_profile_code?: string | null;
    access_profile_version?: number | null;
  }>;
  role_grants: Array<{ id: string; reference: string; role_code: string; status: string; version: number; effective_from: string; effective_to: string | null; reason?: string | null }>;
  account_invitations?: Array<{ reference: string; contact: string; status: string; expires_at: string; provider_state: string; role_code?: string; reason?: string | null; profile_code?: string | null }>;
};

function staffRow(overrides: Partial<DirectoryRow> = {}): DirectoryRow {
  return {
    id: "00000000-0000-4000-8000-000000000701",
    status: "active",
    verified_contact: "staff.member@faizaam.example",
    mfa_status: "verified",
    people: { display_name: "Staff Member" },
    staff_members: [{ id: "sm-1", reference: "STF-2026-0001", title: "Principal", employment_status: "active", access_profile_code: "principal", access_profile_version: 1 }],
    role_grants: [{ id: "rg-1", reference: "ROLE-2026-0001", role_code: "content_editor", status: "active", version: 1, effective_from: "2026-04-01T00:00:00Z", effective_to: null }],
    account_invitations: [],
    ...overrides,
  };
}

function revokedInvitationRow(providerState: string): DirectoryRow {
  return {
    id: "",
    status: "revoked",
    verified_contact: null,
    mfa_status: "not_applicable",
    people: { display_name: "Probe Synthetic" },
    staff_members: [],
    role_grants: [],
    account_invitations: [{ reference: "INV-2026-847679", contact: "staff.probe@faizaam.example", status: "revoked", expires_at: "2026-09-29T00:00:00Z", provider_state: providerState, profile_code: "principal" }],
  };
}

afterEach(() => {
  adapterMocks.call.mockReset();
  adapterMocks.mode.mockReturnValue("supabase");
});

describe("usersService.listUsers (supabase mode)", () => {
  it("excludes accounts with no staff record (guardians and applicants)", async () => {
    adapterMocks.call.mockResolvedValue({
      ok: true,
      value: [
        staffRow(),
        { ...staffRow({ id: "00000000-0000-4000-8000-000000000702", people: { display_name: "Test Guardian" }, verified_contact: "p@faizaam.example" }), staff_members: [], role_grants: [{ id: "rg-g", reference: "ROLE-2026-9001", role_code: "guardian", status: "active", version: 1, effective_from: "2026-04-01T00:00:00Z", effective_to: null }] },
      ],
    });
    const rows = await usersService.listUsers();
    expect(rows.map((row) => row.name)).toEqual(["Staff Member"]);
  });

  it("labels a revoked invitation as Revoked instead of Active", async () => {
    adapterMocks.call.mockResolvedValue({ ok: true, value: [revokedInvitationRow("failed")] });
    const rows = await usersService.listUsers();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("Revoked");
    expect(rows[0]?.twoFa).toBe("Not applicable");
    expect(rows[0]?.invitationProviderState).toBe("failed");
  });

  it("keeps a pending invitation as Invited with the acceptance note", async () => {
    const pending = revokedInvitationRow("pending");
    pending.status = "pending";
    if (pending.account_invitations?.[0]) pending.account_invitations[0].status = "pending";
    adapterMocks.call.mockResolvedValue({ ok: true, value: [pending] });
    const rows = await usersService.listUsers();
    expect(rows[0]?.status).toBe("Invited");
    expect(rows[0]?.twoFa).toBe("After acceptance");
  });

  it("surfaces a directory read failure instead of returning an empty list", async () => {
    adapterMocks.call.mockResolvedValue({ ok: false, errors: [{ code: "unavailable", message: "Directory unavailable.", field: null }] });
    await expect(usersService.listUsers()).rejects.toThrow("Directory unavailable.");
  });
});

describe("usersService.changeProfile (supabase mode)", () => {
  const legacyRow: DirectoryRow = {
    id: "00000000-0000-4000-8000-000000000703",
    status: "active",
    verified_contact: "legacy.staff@faizaam.example",
    mfa_status: "unknown",
    people: { display_name: "Legacy Staff" },
    staff_members: [{ id: "sm-3", reference: "STF-2026-0003", title: "School office", employment_status: "active", access_profile_code: null, access_profile_version: null }],
    role_grants: [],
    account_invitations: [],
  };

  it("uses the version-checked adoption command for a legacy account", async () => {
    const operations: string[] = [];
    adapterMocks.call.mockImplementation(async (op: string) => {
      operations.push(op);
      if (op === "users.list") return { ok: true, value: [legacyRow] };
      return { ok: true, value: {} };
    });
    await usersService.changeProfile({
      accountId: legacyRow.id,
      profileCode: "principal",
      reason: "Reconciled legacy office grants into the principal profile.",
      expectedVersion: 1,
    });
    expect(operations).toContain("staff.profileAdopt");
    expect(operations).not.toContain("staff.profileChange");
  });

  it("refuses a short adoption reason before calling the server", async () => {
    adapterMocks.call.mockImplementation(async (op: string) => {
      if (op === "users.list") return { ok: true, value: [legacyRow] };
      return { ok: true, value: {} };
    });
    await expect(
      usersService.changeProfile({ accountId: legacyRow.id, profileCode: "principal", reason: "short", expectedVersion: 1 }),
    ).rejects.toThrow("An adoption reason of at least 10 characters is required for a legacy account.");
  });

  it("keeps the version-checked change command for a profiled account", async () => {
    const operations: Array<{ op: string; payload: unknown }> = [];
    adapterMocks.call.mockImplementation(async (op: string, payload: unknown) => {
      operations.push({ op, payload });
      if (op === "users.list") return { ok: true, value: [staffRow()] };
      return { ok: true, value: {} };
    });
    await usersService.changeProfile({
      accountId: "00000000-0000-4000-8000-000000000701",
      profileCode: "administrator",
      reason: "Move to administrator for the new session.",
      expectedVersion: 1,
    });
    const change = operations.find((entry) => entry.op === "staff.profileChange");
    expect(change).toBeDefined();
    expect(change?.payload).toMatchObject({ accountId: "00000000-0000-4000-8000-000000000701", profileCode: "administrator", expectedVersion: 1 });
    expect(operations.some((entry) => entry.op === "staff.profileAdopt")).toBe(false);
  });
});
