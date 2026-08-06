#!/usr/bin/env node
/**
 * Idempotent remote seeder (plan.md §11 B0/B1): applies the deterministic
 * synthetic seed to the LINKED Supabase project through the admin client
 * (secret key, server-side). Mirrors supabase/seed.sql semantics with
 * PostgREST `resolution=ignore-duplicates` (the REST equivalent of
 * `ON CONFLICT DO NOTHING`), so re-runs are safe.
 *
 * Never place real student/guardian/applicant/financial data here (plan.md
 * §14) — synthetic data only.
 *
 * Usage: node scripts/seed-remote.mjs
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/* --- env parsing (no dotenv dependency) -------------------------------- */

const envRaw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !match[2].startsWith("#")) env[match[1]] = match[2].trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* --- seed data (must mirror supabase/seed.sql) -------------------------- */

const ROLE_DEFINITIONS = [
  ["guardian", "Guardian", "Family portal access through verified guardian/student links."],
  ["student", "Student", "Own student records; disabled until the school approves the student-account policy."],
  ["content_editor", "Content editor", "Drafts notices and public content (content.draft)."],
  ["content_publisher", "Content publisher", "Reviews and publishes notices and content (content.publish)."],
  ["admissions_officer", "Admissions officer", "Reviews applications and moves them to assessment (admissions.review)."],
  ["admissions_approver", "Admissions approver", "Decides offers, waitlists, and declines (admissions.approve)."],
  ["finance_officer", "Finance officer", "Finance operations and payment handling (finance.operate)."],
  ["finance_approver", "Finance approver", "Approves refunds, write-offs, and reconciliation (finance.approve)."],
  ["hr_reviewer", "HR reviewer", "Scores and reviews job applications (careers.review)."],
  ["hr_approver", "HR approver", "Advances, rejects, and offers on job applications (careers.approve)."],
  ["teacher", "Teacher", "Enters marks for assigned class/subject batches and views own timetable (results.enter)."],
  ["exam_reviewer", "Exam reviewer", "Moderates and approves result batches (results.approve)."],
  ["result_publisher", "Result publisher", "Publishes, corrects, and withdraws result publications (results.publish)."],
  ["timetable_manager", "Timetable manager", "Creates, validates, publishes, and overrides timetables (timetable.manage)."],
  ["support_officer", "Support officer", "Responds to support requests and verifies guardian links (support.respond, links.verify)."],
  ["auditor", "Auditor", "Read-only audit and reconciliation projections (audit.view)."],
  ["system_administrator", "System administrator", "Manages accounts, grants, and configuration — never business approvals (users.manage, settings.manage)."],
];

const ACADEMIC_YEARS = [
  { label: "2025-26", starts_on: "2025-04-01", ends_on: "2026-03-31", status: "historical" },
  { label: "2026-27", starts_on: "2026-04-01", ends_on: "2027-03-31", status: "current" },
];

const GRADES = [
  ["6", "Class 6", 6],
  ["7", "Class 7", 7],
  ["8", "Class 8", 8],
  ["9", "Class 9", 9],
  ["10", "Class 10", 10],
];

const SECTIONS = [
  ["8", "A"],
  ["9", "C"],
];

const SUBJECTS = [
  ["MAT", "Mathematics"],
  ["SCI", "General Science"],
  ["ENG", "English"],
  ["URD", "Urdu"],
  ["KAS", "Kashmiri"],
  ["SST", "Social Science"],
  ["COM", "Computer Science"],
];

const ROOMS = [
  ["R21", "Room 21 · 8-A", "classroom"],
  ["R11", "Room 11 · 9-B", "classroom"],
  ["LAB2", "Lab 2", "lab"],
  ["CLAB", "Computer lab", "lab"],
  ["GRD", "Ground", "hall"],
  ["CTYD", "Courtyard", "other"],
  ["DINE", "Dining hall", "other"],
];

const PERIOD_DAYS = [1, 2, 3, 4, 5, 6];
const PERIODS = [
  [1, "08:30", "08:45"],
  [2, "08:45", "09:30"],
  [3, "09:30", "10:15"],
  [4, "10:15", "11:00"],
  [5, "11:15", "12:00"],
  [6, "12:00", "12:45"],
  [7, "13:30", "14:15"],
  [8, "14:15", "15:00"],
];

const SETTINGS_VERSION_1 = {
  version: 1,
  status: "policy_pending",
  policy: {
    payment: { partial_payments: true, refund_policy: "pending" },
    results: { grade_bands: "pending" },
    admissions: { window_policy: "pending" },
  },
  change_reason: "Synthetic policy-pending defaults — school decisions required (plan.md §14).",
};

const FEATURE_FLAGS = [
  ["student_accounts", false, "Disabled until the school approves the student-account policy."],
  ["payment_gateway", false, "Disabled until a gateway and merchant are approved."],
];

/* --- helpers ------------------------------------------------------------- */

let failures = 0;
function report(label, error) {
  if (error) {
    failures += 1;
    console.error(`  ✗ ${label}: ${error.message}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

async function upsert(table, rows, onConflict) {
  const { error } = await admin.from(table).upsert(rows, { onConflict, ignoreDuplicates: true });
  return error;
}

/* --- run ----------------------------------------------------------------- */

console.log(`Seeding ${url} (synthetic data only)`);

report("role_definitions", await upsert("role_definitions", ROLE_DEFINITIONS.map(([code, label, description]) => ({ code, label, description })), "code"));

report("academic_years", await upsert("academic_years", ACADEMIC_YEARS, "label"));
report("grades", await upsert("grades", GRADES.map(([code, label, sort_order]) => ({ code, label, sort_order })), "code"));
report("subjects", await upsert("subjects", SUBJECTS.map(([code, name]) => ({ code, name })), "code"));
report("rooms", await upsert("rooms", ROOMS.map(([code, label, kind]) => ({ code, label, kind })), "code"));

/* Resolve ids for FK-bound rows. */
const { data: years, error: yearsError } = await admin.from("academic_years").select("id,label");
const { data: grades, error: gradesError } = await admin.from("grades").select("id,code");
report("resolve years/grades", yearsError ?? gradesError);
const yearIdByLabel = Object.fromEntries((years ?? []).map((y) => [y.label, y.id]));
const gradeIdByCode = Object.fromEntries((grades ?? []).map((g) => [g.code, g.id]));

const currentYearId = yearIdByLabel["2026-27"];
if (currentYearId) {
  const sections = SECTIONS.map(([gradeCode, sectionLabel]) => ({
    academic_year_id: currentYearId,
    grade_id: gradeIdByCode[gradeCode],
    section_label: sectionLabel,
    status: "active",
  }));
  report("grade_sections", await upsert("grade_sections", sections, "academic_year_id,grade_id,section_label"));

  const { data: sectionsRows } = await admin.from("grade_sections").select("id,academic_year_id,grade_id,section_label");
  const sectionIdByKey = Object.fromEntries(
    (sectionsRows ?? []).map((s) => [`${s.academic_year_id}:${s.grade_id}:${s.section_label}`, s.id]),
  );

  const periods = [];
  for (const day of PERIOD_DAYS) {
    for (const [periodNumber, startsAt, endsAt] of PERIODS) {
      periods.push({
        academic_year_id: currentYearId,
        day_of_week: day,
        period_number: periodNumber,
        starts_at: startsAt,
        ends_at: endsAt,
      });
    }
  }
  report(`period_definitions (${periods.length})`, await upsert("period_definitions", periods, "academic_year_id,day_of_week,period_number"));
} else {
  failures += 1;
  console.error("  ✗ could not resolve the current academic year");
}

report("settings_versions", await upsert("settings_versions", [SETTINGS_VERSION_1], "version"));
report("feature_flags", await upsert("feature_flags", FEATURE_FLAGS.map(([code, enabled, note]) => ({ code, enabled, note })), "code"));

/* --- verification -------------------------------------------------------- */

const checks = [
  ["role_definitions", "code", null],
  ["academic_years", "label", null],
  ["grades", "code", null],
  ["grade_sections", "section_label", null],
  ["subjects", "code", null],
  ["rooms", "code", null],
  ["period_definitions", "day_of_week", null],
  ["settings_versions", "version", null],
  ["feature_flags", "code", null],
];
console.log("\nVerification:");
for (const [table, column] of checks) {
  const { data, error } = await admin.from(table).select(column);
  if (error) {
    console.error(`  ✗ ${table}: ${error.message}`);
    failures += 1;
  } else {
    console.log(`  ${table}: ${data.length} row(s)`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nRemote seed complete (idempotent — safe to re-run).");
