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

import { invitesCreate, linksListMine, mapServerLinkRow, usersListAdmin } from "@/lib/supabase/domain";
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

describe("guardian-link name projection", () => {
  const baseRow = {
    id: "00000000-0000-4000-8000-000000000901",
    reference: "LINK-2026-B55517",
    guardian_id: "00000000-0000-4000-8000-000000000201",
    student_id: "00000000-0000-4000-8000-000000000902",
    relationship_label: "Parent",
    status: "active",
    verification_source: "guardian_request",
    approved_at: "2026-09-01T00:00:00Z",
    effective_from: "2026-09-01T00:00:00Z",
    effective_to: null,
    restriction_reason: null,
    rejection_reason: null,
    contact_priority: 1,
    is_emergency_contact: false,
    is_billing_contact: false,
    version: 1,
    guardian_link_capabilities: [{ capability: "profile" }],
  };

  it("never renders a blank guardian or student name on a link row", () => {
    const blank = mapServerLinkRow({ ...baseRow, guardian_name: "", student_name: "   " });
    expect(blank.guardianName).toBe("Unnamed guardian");
    expect(blank.studentName).toBe("Unnamed student");
    expect(blank.studentRef).toBe("");
  });

  it("keeps recorded names when present", () => {
    const named = mapServerLinkRow({ ...baseRow, guardian_name: "Test Guardian", student_name: "Test Student One", student_reference: "STU-2026-F456A1" });
    expect(named.guardianName).toBe("Test Guardian");
    expect(named.studentName).toBe("Test Student One");
    expect(named.studentRef).toBe("STU-2026-F456A1");
  });

  it("shows the creation instant for a pending link with no effective_from", () => {
    const pending = mapServerLinkRow({
      ...baseRow,
      status: "pending_verification",
      approved_at: null,
      effective_from: null,
      created_at: "2026-09-15T05:30:00.000Z",
    });
    expect(pending.link.effectiveFromIso).toBe("2026-09-15T05:30:00.000Z");
    expect(pending.link.effectiveFromIso).not.toBe(new Date(0).toISOString());
  });

  it("keeps the recorded effective_from when the link is active", () => {
    const active = mapServerLinkRow({ ...baseRow, created_at: "2026-08-01T00:00:00.000Z" });
    expect(active.link.effectiveFromIso).toBe("2026-09-01T00:00:00Z");
  });
});

describe("linksListMine", () => {
  function clientWithAppRpc(resolution: { data: unknown; error: { message: string } | null }): {
    client: SupabaseClient<Database>;
    rpc: ReturnType<typeof vi.fn>;
  } {
    const rpc = vi.fn().mockResolvedValue(resolution);
    const client = {
      schema: vi.fn().mockReturnValue({ rpc }),
    } as unknown as SupabaseClient<Database>;
    return { client, rpc };
  }

  const PENDING_ROW = {
    id: "00000000-0000-4000-8000-000000000901",
    reference: "LINK-2026-B0B263C8F1",
    guardian_id: "00000000-0000-4000-8000-000000000201",
    student_id: "00000000-0000-4000-8000-000000000902",
    relationship_label: "Father",
    status: "pending_verification",
    verification_source: "guardian_request",
    approved_at: null,
    effective_from: null,
    effective_to: null,
    restriction_reason: null,
    rejection_reason: null,
    contact_priority: 1,
    is_emergency_contact: false,
    is_billing_contact: false,
    version: 1,
    created_at: "2026-09-15T16:28:27.752584+00:00",
    guardian_name: "Firdous Ahmad",
    student_name: "Aayan Yousuf",
    student_reference: "STU-2026-2E5844DDB8",
    guardian_link_capabilities: [],
  };

  it("surfaces the requested student reference and name for a pending link", async () => {
    const { client, rpc } = clientWithAppRpc({ data: [PENDING_ROW], error: null });
    const result = await linksListMine(client);
    expect(rpc).toHaveBeenCalledWith("guardian_links_mine", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.studentRef).toBe("STU-2026-2E5844DDB8");
    expect(result.value[0]?.studentName).toBe("Aayan Yousuf");
    expect(result.value[0]?.guardianName).toBe("Firdous Ahmad");
    expect(result.value[0]?.link.effectiveFromIso).toBe("2026-09-15T16:28:27.752584+00:00");
  });

  it("keeps the queue's pending-only read scope", async () => {
    const activeRow = {
      ...PENDING_ROW,
      id: "00000000-0000-4000-8000-000000000903",
      reference: "LINK-2026-2B35722A6C",
      status: "active",
      effective_from: "2026-08-01T00:00:00Z",
    };
    const { client } = clientWithAppRpc({ data: [PENDING_ROW, activeRow], error: null });
    const result = await linksListMine(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((row) => row.link.ref)).toEqual(["LINK-2026-B0B263C8F1"]);
  });

  it("maps a projection failure to the canonical envelope", async () => {
    const { client } = clientWithAppRpc({ data: null, error: { message: "permission denied for function guardian_links_mine" } });
    const result = await linksListMine(client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("unavailable");
  });

  it("returns an empty queue without error", async () => {
    const { client } = clientWithAppRpc({ data: [], error: null });
    const result = await linksListMine(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});
