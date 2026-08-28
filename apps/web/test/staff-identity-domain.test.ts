/**
 * Staff identity server layer tests (lib/supabase/domain.ts).
 *
 * The command RPCs require a live database, so these pin what is verifiable
 * locally: the RLS-based admin directory read maps rows faithfully and
 * surfaces RLS denial as the canonical forbidden/unavailable envelope, and
 * the invite command maps a missing-RPC failure to a clean ServiceResult.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { invitesCreate, usersListAdmin } from "@/lib/supabase/domain";
import type { Database } from "@/lib/supabase/database.types";

function clientWithUsersRpc(resolution: { data: unknown; error: { message: string } | null }): {
  client: SupabaseClient<Database>;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn().mockResolvedValue(resolution);
  const client = {
    schema: vi.fn().mockReturnValue({ rpc }),
  } as unknown as SupabaseClient<Database>;
  return { client, rpc };
}

const DIRECTORY_ROW = {
  id: "acc-1",
  status: "active",
  verified_contact: "staff@example.test",
  name: "Aisha Lone",
  mfa_status: "verified",
  staff_members: [{ id: "sm-1", reference: "STAFF-2026-0001", title: "Teacher", employment_status: "active" }],
  role_grants: [
    { reference: "ROLE-2026-0007", role_code: "teacher", status: "active", version: 1, effective_from: "2026-04-01", effective_to: null },
    { reference: "ROLE-2026-0002", role_code: "exam_reviewer", status: "revoked", version: 2, effective_from: "2026-03-01", effective_to: "2026-03-20" },
  ],
};

describe("usersListAdmin", () => {
  it("maps the authoritative users_admin_list RPC projection", async () => {
    const { client, rpc } = clientWithUsersRpc({ data: [DIRECTORY_ROW], error: null });
    const result = await usersListAdmin(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.value[0];
    expect(row?.people?.display_name).toBe("Aisha Lone");
    expect(row?.role_grants?.[0]?.role_code).toBe("teacher");
    expect(row?.role_grants?.[0]?.effective_from).toBe("2026-04-01");
    expect(row?.staff_members?.[0]?.employment_status).toBe("active");
    expect(row?.mfa_status).toBe("verified");
    expect(rpc).toHaveBeenCalledWith("users_admin_list", {});
  });

  it("surfaces RLS denial as a failed envelope", async () => {
    const { client } = clientWithUsersRpc({ data: null, error: { message: "permission denied for users_admin_list" } });
    const result = await usersListAdmin(client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("unavailable");
  });

  it("returns an empty directory without error", async () => {
    const { client } = clientWithUsersRpc({ data: [], error: null });
    const result = await usersListAdmin(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});

describe("invitesCreate", () => {
  it("returns the one-time reference from the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "a".repeat(48), error: null });
    const client = {
      schema: vi.fn().mockReturnValue({ rpc }),
    } as unknown as SupabaseClient<Database>;
    const result = await invitesCreate(client, { contact: "new.staff@example.test", expiresAt: "2026-12-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.oneTimeRef).toHaveLength(48);
    expect(rpc).toHaveBeenCalledWith(
      "invites_create",
      expect.objectContaining({
        p_contact: "new.staff@example.test",
        p_purpose: "staff",
      }),
    );
  });

  it("maps a not-yet-applied migration to a clean unavailable envelope", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Could not find the function app.invites_create" } });
    const client = {
      schema: vi.fn().mockReturnValue({ rpc }),
    } as unknown as SupabaseClient<Database>;
    const result = await invitesCreate(client, { contact: "x@y.z", expiresAt: "2026-12-01T00:00:00Z" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message.length).toBeGreaterThan(0);
  });
});
