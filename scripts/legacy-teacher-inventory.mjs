#!/usr/bin/env node
/**
 * Read-only masked legacy teacher-access inventory (Phase 9 gate).
 *
 * Connects with the service-role key and returns ONLY masked evidence:
 * grant references, account UUIDs, dependency counts, and booleans. No
 * names, emails, phone numbers, or contact values are printed. This report
 * is the prerequisite for any legacy retirement decision, which itself
 * requires separate explicit owner confirmation.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function readEnv(key) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const match = line.match(new RegExp(`^${key}=(.*)$`));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = readEnv("SUPABASE_SECRET_KEY") ?? readEnv("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: grants, error } = await admin
  .from("role_grants")
  .select("id, reference, account_id, status, version, effective_from, effective_to")
  .eq("role_code", "teacher")
  .order("reference");
if (error) {
  console.error("inventory read failed:", error.message);
  process.exit(1);
}

console.log("=== MASKED LEGACY TEACHER-ACCESS INVENTORY (read-only) ===");
console.log(`active teacher grants: ${grants.filter((g) => g.status === "active").length}`);
console.log("");

for (const grant of grants) {
  const { count: assignmentCount } = await admin
    .from("staff_assignments")
    .select("id", { count: "exact", head: true })
    .eq("role_grant_id", grant.id);
  const { count: periodRefs } = await admin
    .from("timetable_periods")
    .select("id", { count: "exact", head: true })
    .eq("teacher_assignment_id", grant.id);
  const { count: overrideRefs } = await admin
    .from("timetable_overrides")
    .select("id", { count: "exact", head: true })
    .eq("substitute_teacher_assignment_id", grant.id);
  const { data: otherGrants } = await admin
    .from("role_grants")
    .select("role_code, status")
    .eq("account_id", grant.account_id)
    .neq("role_code", "teacher");
  const { data: account } = await admin
    .from("user_accounts")
    .select("status")
    .eq("id", grant.account_id)
    .maybeSingle();
  const { data: staffMember } = await admin
    .from("staff_members")
    .select("id, employment_status, access_profile_code")
    .eq("person_id", (await admin.from("user_accounts").select("person_id").eq("id", grant.account_id).maybeSingle()).data?.person_id ?? "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  const { data: teachingAssignments } = await admin
    .from("teaching_assignments")
    .select("id", { count: "exact", head: true })
    .eq("staff_member_id", staffMember?.id ?? "00000000-0000-0000-0000-000000000000");

  const guardianGrant = (otherGrants ?? []).some((g) => g.role_code === "guardian" && g.status === "active");
  const otherActiveStaff = (otherGrants ?? []).filter(
    (g) => g.status === "active" && !["guardian", "student", "teacher"].includes(g.role_code),
  );

  console.log(`grant ${grant.reference} [${grant.status}] v${grant.version}`);
  console.log(`  account:        ${grant.account_id} (${account?.status ?? "unknown"})`);
  console.log(`  staff member:   ${staffMember ? `${staffMember.employment_status}${staffMember.access_profile_code ? `, profile=${staffMember.access_profile_code}` : ", no profile"}` : "none"}`);
  console.log(`  guardian grant: ${guardianGrant ? "YES — retirement must preserve family access" : "no"}`);
  console.log(`  other active staff grants: ${otherActiveStaff.length === 0 ? "none" : otherActiveStaff.map((g) => g.role_code).join(", ")}`);
  console.log(`  legacy assignments:      ${assignmentCount ?? 0}`);
  console.log(`  timetable period refs:   ${periodRefs ?? 0}`);
  console.log(`  timetable override refs: ${overrideRefs ?? 0}`);
  console.log(`  new teaching_assignments rows: ${teachingAssignments?.length ?? 0}`);
  console.log("");
}

console.log("NOTE: retirement is NOT performed by this script. It requires a");
console.log("separate explicit owner confirmation naming these exact references.");
