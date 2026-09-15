// @vitest-environment node
/**
 * Staff workspace grant fallback: when the stored active-workspace
 * preference (or an old cookie) points at a grant that has since been
 * revoked, the resolver must fall back to an active grant instead of
 * locking the staff member out of their whole portal. Verified live on
 * 15 September 2026 after a revoked grant left the dev administrator
 * unable to open /administrator.
 */
import { describe, expect, it } from "vitest";

import { resolveStaffContext } from "@/lib/supabase/domain";

const PERSON_ID = "00000000-0000-4000-8000-000000000106";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000203";
const ACTIVE_GRANT_ID = "00000000-0000-4000-8000-000000000311";
const REVOKED_GRANT_ID = "00000000-0000-4000-8000-000000000399";

const ACTOR = { accountId: ACCOUNT_ID, personId: PERSON_ID, displayName: "Dev Administrator" };

const ACTIVE_GRANT = {
  id: ACTIVE_GRANT_ID,
  reference: "ROLE-2026-0311",
  account_id: ACCOUNT_ID,
  role_code: "hr_approver",
  status: "active",
  granted_by_account_id: null,
  reason: "Staging fixture",
  effective_from: "2026-01-01T00:00:00.000Z",
  effective_to: null,
  version: 1,
};

function fakeClient(rows: {
  staff_members?: unknown;
  account_context_preferences?: unknown;
  role_grants?: unknown[];
  staff_assignments?: unknown[];
}) {
  function chain(table: keyof typeof rows) {
    const query: Record<string, unknown> = {};
    const passthrough = () => query;
    query.select = passthrough;
    query.eq = passthrough;
    query.lte = passthrough;
    query.or = passthrough;
    query.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
    return query;
  }
  return { from: (table: keyof typeof rows) => chain(table) } as never;
}

function baseRows(activeGrants: unknown[], preferenceGrantId: string | null) {
  return {
    staff_members: {
      id: "00000000-0000-4000-8000-000000000402",
      reference: "STF-2026-0402",
      employment_status: "active",
      title: "Administrator",
      access_profile_code: "administrator",
      access_profile_version: 1,
    },
    account_context_preferences: preferenceGrantId === null ? null : { active_role_grant_id: preferenceGrantId },
    role_grants: activeGrants,
    staff_assignments: [],
  };
}

describe("resolveStaffContext workspace grant fallback", () => {
  it("falls back to an active grant when an old cookie names a revoked grant", async () => {
    const result = await resolveStaffContext(
      fakeClient(baseRows([ACTIVE_GRANT], null)),
      PERSON_ID,
      REVOKED_GRANT_ID,
      ACTOR,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { activeRoleGrantId: string }).activeRoleGrantId).toBe(ACTIVE_GRANT_ID);
    expect((result.value as { activeRole: string }).activeRole).toBe("hr_approver");
  });

  it("falls back to the first active grant when the stored preference was revoked", async () => {
    const result = await resolveStaffContext(
      fakeClient(baseRows([ACTIVE_GRANT], REVOKED_GRANT_ID)),
      PERSON_ID,
      undefined,
      ACTOR,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { activeRoleGrantId: string }).activeRoleGrantId).toBe(ACTIVE_GRANT_ID);
  });

  it("keeps the requested grant when it is active", async () => {
    const result = await resolveStaffContext(
      fakeClient(baseRows([{ ...ACTIVE_GRANT }, { ...ACTIVE_GRANT, id: "00000000-0000-4000-8000-000000000312", role_code: "auditor" }], null)),
      PERSON_ID,
      ACTIVE_GRANT_ID,
      ACTOR,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { activeRoleGrantId: string }).activeRoleGrantId).toBe(ACTIVE_GRANT_ID);
    expect((result.value as { activeRole: string }).activeRole).toBe("hr_approver");
  });

  it("still denies an account with no active grants", async () => {
    const result = await resolveStaffContext(
      fakeClient(baseRows([], REVOKED_GRANT_ID)),
      PERSON_ID,
      undefined,
      ACTOR,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toBe("That staff workspace is not granted to this account");
  });
});
