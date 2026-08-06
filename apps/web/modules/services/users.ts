/**
 * Typed users-service boundary for the staff users page.
 *
 * Account rows are derived from the canonical relationship graph (people,
 * user accounts, staff members, and role grants) wherever a staff account
 * exists; the remaining fictional staff rows are seeded demo data. Emails,
 * last-activity labels, and 2FA states are fictional (the graph carries no
 * contact or security details). Role labels come from the shared
 * staff-context label map so the page never resolves roles itself.
 */

import { formatKolkata } from "@/modules/iot/domain";
import { demoNowIso } from "@/modules/demo/clock";
import { demoRelationshipGraph } from "@/modules/relationships/demo";
import { roleLabel } from "@/modules/services/staff-context";

export type UserStatus = "Active" | "Invited" | "Suspended";

export type UserRow = {
  key: string;
  name: string;
  /** Display role label; an account with several grants lists them all. */
  role: string;
  email: string;
  status: UserStatus;
  lastActiveLabel: string;
  twoFa: string;
  /** Provenance: derived from the relationship graph, or seeded demo data. */
  source: "relationship" | "seeded";
};

/** Seeded fictional staff accounts — real identities arrive with authentication. */
const SEEDED_USERS: UserRow[] = [
  {
    key: "a-lone",
    name: "A. Lone",
    role: "Admissions officer",
    email: "a.lone@faizaam.example",
    status: "Active",
    lastActiveLabel: formatKolkata("2026-08-03T02:42:00Z", { format: "short" }),
    twoFa: "Enabled",
    source: "seeded",
  },
  {
    key: "r-wani",
    name: "R. Wani",
    role: "HR reviewer",
    email: "r.wani@faizaam.example",
    status: "Active",
    lastActiveLabel: formatKolkata("2026-08-02T10:30:00Z", { format: "short" }),
    twoFa: "Enabled",
    source: "seeded",
  },
  {
    key: "m-wani",
    name: "M. Wani",
    role: "Teacher",
    email: "m.wani@faizaam.example",
    status: "Active",
    lastActiveLabel: formatKolkata("2026-08-03T02:25:00Z", { format: "short" }),
    twoFa: "—",
    source: "seeded",
  },
  {
    key: "s-bhat",
    name: "S. Bhat",
    role: "Exam reviewer",
    email: "s.bhat@faizaam.example",
    status: "Active",
    lastActiveLabel: formatKolkata("2026-08-01T05:50:00Z", { format: "short" }),
    twoFa: "Enabled",
    source: "seeded",
  },
  {
    key: "k-dar",
    name: "K. Dar",
    role: "Teacher",
    email: "k.dar@faizaam.example",
    status: "Suspended",
    lastActiveLabel: formatKolkata("2026-07-28T03:33:00Z", { format: "short" }),
    twoFa: "—",
    source: "seeded",
  },
  {
    key: "f-ahmad",
    name: "F. Ahmad",
    role: "Teacher",
    email: "f.ahmad@faizaam.example",
    status: "Active",
    lastActiveLabel: formatKolkata("2026-08-03T03:00:00Z", { format: "short" }),
    twoFa: "—",
    source: "seeded",
  },
  {
    key: "a-gani",
    name: "A. Gani",
    role: "Timetable manager",
    email: "a.gani@faizaam.example",
    status: "Active",
    lastActiveLabel: formatKolkata("2026-07-31T10:42:00Z", { format: "short" }),
    twoFa: "Enabled",
    source: "seeded",
  },
  {
    key: "t-waza",
    name: "T. Waza",
    role: "Teacher",
    email: "t.waza@faizaam.example",
    status: "Invited",
    lastActiveLabel: "—",
    twoFa: "—",
    source: "seeded",
  },
  {
    key: "n-lone",
    name: "N. Lone",
    role: "Content editor",
    email: "n.lone@faizaam.example",
    status: "Active",
    lastActiveLabel: formatKolkata("2026-08-03T03:35:00Z", { format: "short" }),
    twoFa: "Enabled",
    source: "seeded",
  },
  {
    key: "z-mir",
    name: "Z. Mir",
    role: "Auditor",
    email: "z.mir@faizaam.example",
    status: "Active",
    lastActiveLabel: formatKolkata("2026-08-02T05:18:00Z", { format: "short" }),
    twoFa: "Enabled",
    source: "seeded",
  },
];

/** Is a role grant currently effective for the account? (mirrors staff-context) */
function isEffective(fromIso: string, toIso: string | null, atIso: string): boolean {
  return fromIso <= atIso && (toIso === null || atIso < toIso);
}

/**
 * Accounts with an active staff member and at least one active non-guardian
 * role grant become rows derived from the relationship graph.
 */
function deriveGraphUsers(): UserRow[] {
  const nowIso = demoNowIso();
  const rows: UserRow[] = [];

  for (const account of demoRelationshipGraph.userAccounts) {
    const staff = demoRelationshipGraph.staffMembers.find(
      (candidate) => candidate.personId === account.personId && candidate.status === "active",
    );
    if (staff === undefined) continue;
    const grants = demoRelationshipGraph.roleGrants.filter(
      (grant) =>
        grant.accountId === account.id &&
        grant.status === "active" &&
        grant.role !== "guardian" &&
        grant.role !== "student" &&
        isEffective(grant.effectiveFromIso, grant.effectiveToIso, nowIso),
    );
    if (grants.length === 0) continue;

    const person = demoRelationshipGraph.people.find((candidate) => candidate.id === account.personId);
    const nameSlug =
      person === undefined
        ? account.ref.toLowerCase()
        : `${person.givenName}.${person.familyName}`.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    rows.push({
      key: `account-${account.ref}`,
      name: person?.displayName ?? account.ref,
      role: grants.map((grant) => roleLabel(grant.role)).join(" · "),
      /* The graph stores no contact or security details — fictional labels. */
      email: `${nameSlug}@faizaam.example`,
      status: account.status === "active" ? "Active" : "Suspended",
      lastActiveLabel: formatKolkata("2026-08-03T02:10:00Z", { format: "short" }),
      twoFa: "Enabled",
      source: "relationship",
    });
  }
  return rows;
}

export interface UsersService {
  /** Staff accounts: relationship-graph accounts first, then seeded rows. */
  listUsers(): Promise<UserRow[]>;
}

export const usersService: UsersService = {
  async listUsers() {
    return [...deriveGraphUsers(), ...SEEDED_USERS.map((row) => ({ ...row }))];
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createUsersService = (): UsersService => usersService;
