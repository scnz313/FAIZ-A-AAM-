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

/* Hard target guard: this script writes to a remote project. It must point at
   the approved staging ref and the operator must have confirmed staging. */
const PROJECT_REF = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) ?? [])[1];
const APPROVED_STAGING_REF = "jxegiamjcawdywqyutdz";
if (PROJECT_REF !== APPROVED_STAGING_REF || env.FASS_STAGING_CONFIRMED !== "true") {
  console.error(
    `Refusing to run: this script seeds a remote project.\n` +
      `Expected project ${APPROVED_STAGING_REF} with FASS_STAGING_CONFIRMED=true ` +
      `(got ${PROJECT_REF ?? "unknown"}, FASS_STAGING_CONFIRMED=${env.FASS_STAGING_CONFIRMED ?? "unset"}).`,
  );
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* --- seed data (must mirror supabase/seed.sql) -------------------------- */

const ROLE_DEFINITIONS = [
  ["guardian", "Guardian", "Family portal access through verified guardian/student links.", true],
  ["student", "Student", "Own student records; disabled — students are school records linked to guardians and do not sign in.", false],
  ["content_editor", "Content editor", "Drafts notices and public content (content.draft).", true],
  ["content_publisher", "Content publisher", "Reviews and publishes notices and content (content.publish).", true],
  ["admissions_officer", "Admissions officer", "Reviews applications and moves them to assessment (admissions.review).", true],
  ["admissions_approver", "Admissions approver", "Decides offers, waitlists, and declines (admissions.approve).", true],
  ["finance_officer", "Finance officer", "Finance operations and payment handling (finance.operate).", true],
  ["finance_approver", "Finance approver", "Approves refunds, write-offs, and reconciliation (finance.approve).", true],
  ["hr_reviewer", "HR reviewer", "Scores and reviews job applications (careers.review).", true],
  ["hr_approver", "HR approver", "Advances, rejects, and offers on job applications (careers.approve).", true],
  ["teacher", "Teacher", "Legacy role — teachers are non-login school records. Retained for history/audit only; not assignable.", false],
  ["result_entry_officer", "Result entry officer", "Enters and imports marks for result batches (results.enter). Principal profile.", true],
  ["exam_reviewer", "Exam reviewer", "Moderates and approves result batches (results.approve). Administrator profile.", true],
  ["result_publisher", "Result publisher", "Publishes, corrects, and withdraws result publications (results.publish). Administrator profile.", true],
  ["timetable_manager", "Timetable manager", "Creates, validates, publishes, and overrides timetables (timetable.manage). Principal profile.", true],
  ["support_officer", "Support officer", "Responds to support requests (support.respond). Principal profile.", true],
  ["auditor", "Auditor", "Read-only audit and reconciliation projections (audit.view). Administrator profile.", true],
  ["system_administrator", "System administrator", "Manages accounts, grants, and configuration — never business approvals (users.manage, settings.manage). Administrator profile.", true],
];

/* The canonical profile bundles are migration-inserted reference rows
   (000042); a staging reset that truncates tables must reseed them too. */
const STAFF_ACCESS_PROFILES = [
  ["administrator", "Administrator",
    "Manages accounts, configuration, import/export, audit, and guardian-access approval, and performs final admissions, finance, HR, content, and result decisions."],
  ["principal", "Principal",
    "Handles daily admissions, careers, finance operations, result entry/import, timetable management, content drafting, and support."],
];

const STAFF_ACCESS_PROFILE_ROLES = [
  ["administrator", "system_administrator", 1],
  ["administrator", "content_publisher", 2],
  ["administrator", "admissions_approver", 3],
  ["administrator", "finance_approver", 4],
  ["administrator", "hr_approver", 5],
  ["administrator", "exam_reviewer", 6],
  ["administrator", "result_publisher", 7],
  ["administrator", "auditor", 8],
  ["principal", "content_editor", 1],
  ["principal", "admissions_officer", 2],
  ["principal", "finance_officer", 3],
  ["principal", "hr_reviewer", 4],
  ["principal", "result_entry_officer", 5],
  ["principal", "timetable_manager", 6],
  ["principal", "support_officer", 7],
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

report("role_definitions", await upsert("role_definitions", ROLE_DEFINITIONS.map(([code, label, description, is_assignable]) => ({ code, label, description, is_assignable })), "code"));
report("staff_access_profiles", await upsert("staff_access_profiles", STAFF_ACCESS_PROFILES.map(([code, label, description]) => ({ code, label, description, version: 1 })), "code"));
report("staff_access_profile_roles", await upsert("staff_access_profile_roles", STAFF_ACCESS_PROFILE_ROLES.map(([profile_code, role_code, sort_order]) => ({ profile_code, role_code, sort_order })), "profile_code,role_code"));

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
let sectionsRows = [];
if (currentYearId) {
  const sections = SECTIONS.map(([gradeCode, sectionLabel]) => ({
    academic_year_id: currentYearId,
    grade_id: gradeIdByCode[gradeCode],
    section_label: sectionLabel,
    status: "active",
  }));
  report("grade_sections", await upsert("grade_sections", sections, "academic_year_id,grade_id,section_label"));

  ({ data: sectionsRows } = await admin.from("grade_sections").select("id,academic_year_id,grade_id,section_label"));
  sectionsRows = sectionsRows ?? [];
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

/* --- B2: admission windows (synthetic; policy-pending) --------------------- */
if (currentYearId) {
  const windows = ["6", "7", "8", "9", "10"].map((gradeCode) => ({
    academic_year_id: currentYearId,
    grade_id: gradeIdByCode[gradeCode],
    opens_at: "2026-08-01T00:00:00+05:30",
    closes_at: "2026-10-31T23:59:59+05:30",
    capacity: 60,
    policy: { synthetic: true, admission_policy: "pending" },
    status: "planned",
  }));
  report(`admission_windows (${windows.length})`, await upsert("admission_windows", windows, "academic_year_id,grade_id"));

  /* Document requirements are configuration data, not fixture content: after
     a reset they were missing entirely, so the applicant form had no file
     inputs and no application document could ever attach. Reseed the four
     synthetic requirements for every window (idempotent). */
  const { data: windowRows, error: windowReadError } = await admin
    .from("admission_windows")
    .select("id")
    .eq("academic_year_id", currentYearId);
  report("resolve admission windows", windowReadError);
  const REQUIREMENT_DEFINITIONS = [
    ["birth", "Birth certificate", ["application/pdf", "image/jpeg", "image/png"]],
    ["photo", "Student photograph", ["image/jpeg", "image/png"]],
    ["reportCard", "Previous report card", ["application/pdf", "image/jpeg", "image/png"]],
    ["addressProof", "Address proof", ["application/pdf", "image/jpeg", "image/png"]],
  ];
  const requirements = (windowRows ?? []).flatMap((window) =>
    REQUIREMENT_DEFINITIONS.map(([code, label, allowedMimeTypes]) => ({
      admission_window_id: window.id,
      code,
      label,
      required: true,
      allowed_mime_types: allowedMimeTypes,
      max_bytes: 5 * 1024 * 1024,
      status: "active",
      version: 1,
    })),
  );
  report(`admission_document_requirements (${requirements.length})`, await upsert("admission_document_requirements", requirements, "admission_window_id,code,version"));
}

/* --- B4: fee schedule draft (never effective until approved) -------------- */
report("fee_schedule_versions", await upsert("fee_schedule_versions", [
  { version: 1, status: "draft", policy: { synthetic: true, school_decision: "pending" } },
], "version"));

const { data: scheduleRows, error: scheduleError } = await admin
  .from("fee_schedule_versions")
  .select("id,version");
report("resolve fee schedule", scheduleError);
const scheduleIdByVersion = Object.fromEntries((scheduleRows ?? []).map((s) => [s.version, s.id]));
if (scheduleIdByVersion[1]) {
  const items = [
    ["tuition", "Tuition fee", 1200000, "annual", "fee", 10],
    ["admission", "Admission fee", 500000, "once", "fee", 20],
    ["development", "Development fund", 300000, "annual", "fee", 30],
    ["exam", "Examination fee", 200000, "annual", "fee", 40],
  ].map(([code, label, amount_paise, period, kind, sort_order]) => ({
    schedule_version_id: scheduleIdByVersion[1],
    code,
    label,
    amount_paise,
    currency: "INR",
    period,
    kind,
    sort_order,
  }));
  report(`fee_schedule_items (${items.length})`, await upsert("fee_schedule_items", items, "schedule_version_id,code"));
}

/* --- B5: grade bands + exam definitions + draft timetable ------------------ */
report("grade_band_versions", await upsert("grade_band_versions", [
  {
    version: 1,
    status: "draft",
    bands: {
      synthetic: true,
      bands: [
        { min: 90, grade: "A1" },
        { min: 75, grade: "A" },
        { min: 60, grade: "B" },
        { min: 45, grade: "C" },
        { min: 33, grade: "D" },
        { min: 0, grade: "E" },
      ],
      school_decision: "pending",
    },
  },
], "version"));

if (currentYearId && sectionsRows.length > 0) {
  const examDefs = [];
  for (const section of sectionsRows) {
    for (const term of ["midterm", "final"]) {
      examDefs.push({ academic_year_id: currentYearId, grade_section_id: section.id, term, status: "planned" });
    }
  }
  report(`exam_definitions (${examDefs.length})`, await upsert("exam_definitions", examDefs, "academic_year_id,grade_section_id,term"));

  const { data: examRows } = await admin.from("exam_definitions").select("id,term");
  const { data: subjectRows } = await admin.from("subjects").select("id,code");
  const subjectIdByCode = Object.fromEntries((subjectRows ?? []).map((s) => [s.code, s.id]));
  const components = (examRows ?? [])
    .filter((e) => e.term === "midterm")
    .flatMap((e) =>
      ["MAT", "SCI", "ENG", "URD", "KAS", "SST", "COM"].map((code) => ({
        exam_definition_id: e.id,
        subject_id: subjectIdByCode[code],
        name: "Midterm",
        max_marks: 100,
        weight: 1,
        sort_order: 0,
      })),
    );
  /* 000028 replaced the compound unique constraint with a case-insensitive
     expression index, which PostgREST cannot target with `onConflict`; read
     the existing keys and insert only missing rows so re-runs stay
     idempotent. */
  const { data: existingComponents, error: componentReadError } = await admin
    .from("assessment_components")
    .select("exam_definition_id, subject_id, name");
  const existingComponentKeys = new Set(
    (existingComponents ?? []).map((c) => `${c.exam_definition_id}:${c.subject_id}:${c.name.toLowerCase()}`),
  );
  const missingComponents = components.filter(
    (c) => !existingComponentKeys.has(`${c.exam_definition_id}:${c.subject_id}:${c.name.toLowerCase()}`),
  );
  const componentError = componentReadError ?? (missingComponents.length > 0 ? (await admin.from("assessment_components").insert(missingComponents)).error : null);
  report(`assessment_components (${components.length})`, componentError);

  /* Draft timetable for 8-A (Monday only; drafts are never family-visible). */
  const sectionA = sectionsRows.find((s) => s.section_label === "A");
  if (sectionA) {
    report("timetable_versions", await upsert("timetable_versions", [
      { grade_section_id: sectionA.id, status: "draft", version: 1, effective_from: "2026-04-06" },
    ], "grade_section_id,version"));
    const { data: ttvRows } = await admin.from("timetable_versions").select("id,version");
    const ttv = (ttvRows ?? []).find((t) => t.version === 1);
    if (ttv) {
      const { data: roomRows } = await admin.from("rooms").select("id,code");
      const roomIdByCode = Object.fromEntries((roomRows ?? []).map((r) => [r.code, r.id]));
      const periods = [
        [1, "08:30", "08:45", "assembly", "MAT", "GRD"],
        [2, "08:45", "09:30", "class", "MAT", "R21"],
        [3, "09:30", "10:15", "class", "SCI", "R11"],
        [4, "10:15", "11:00", "class", "ENG", "R11"],
        [5, "11:15", "12:00", "break", null, null],
        [6, "12:00", "12:45", "class", "URD", "R11"],
        [7, "13:30", "14:15", "class", "KAS", "R11"],
        [8, "14:15", "15:00", "class", "SST", "R11"],
      ].map(([period_number, starts_at, ends_at, kind, subjectCode, roomCode]) => ({
        timetable_version_id: ttv.id,
        day_of_week: 1,
        period_number,
        starts_at,
        ends_at,
        subject_id: subjectCode ? subjectIdByCode[subjectCode] : null,
        teacher_assignment_id: null,
        room_id: roomCode ? roomIdByCode[roomCode] : null,
        kind,
      }));
      report(`timetable_periods (${periods.length})`, await upsert("timetable_periods", periods, "timetable_version_id,day_of_week,period_number"));
    }
  }
}

/* The CMS is seeded empty on purpose: notices and pages are school-authored
   content, never fixture data. Seed structural configuration only. */

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
  ["admission_windows", "reference", null],
  ["admission_document_requirements", "code", null],
  ["fee_schedule_versions", "version", null],
  ["fee_schedule_items", "code", null],
  ["grade_band_versions", "version", null],
  ["exam_definitions", "term", null],
  ["assessment_components", "name", null],
  ["timetable_versions", "reference", null],
  ["timetable_periods", "period_number", null],
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
