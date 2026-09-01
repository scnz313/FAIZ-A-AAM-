#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !match[2].startsWith("#")) env[match[1]] = match[2].trim();
}

if (env.FASS_DATA_ADAPTER !== "supabase" || env.NEXT_PUBLIC_FASS_DATA_ADAPTER !== "supabase") {
  throw new Error("Development users require both data adapters to be supabase.");
}
if (!['true', '1', 'on'].includes((env.FASS_DEV_AUTH_BYPASS ?? "").toLowerCase())) {
  throw new Error("FASS_DEV_AUTH_BYPASS must be enabled before seeding development users.");
}
if ((env.FASS_DEV_TEST_PASSWORD ?? "").length < 8) {
  throw new Error("FASS_DEV_TEST_PASSWORD must contain at least 8 characters.");
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  throw new Error("Supabase development credentials are missing.");
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const password = env.FASS_DEV_TEST_PASSWORD;
const now = new Date().toISOString();

const staffAccounts = [
  {
    email: "ad@faizaam.example",
    givenName: "Dev",
    familyName: "Administrator",
    displayName: "Dev Administrator",
    title: "Administrator",
    roles: [
      "system_administrator",
      "content_publisher",
      "admissions_approver",
      "finance_approver",
      "hr_approver",
      "exam_reviewer",
      "result_publisher",
      "auditor",
    ],
  },
  {
    email: "pr@faizaam.example",
    givenName: "Dev",
    familyName: "Principal",
    displayName: "Dev Principal",
    title: "Principal",
    roles: [
      "content_editor",
      "admissions_officer",
      "finance_officer",
      "hr_reviewer",
      "result_entry_officer",
      "timetable_manager",
      "support_officer",
    ],
  },
];

const applicantAccounts = [
  {
    email: "a@faizaam.example",
    givenName: "Dev",
    familyName: "Applicant",
    displayName: "Dev Student Applicant",
    purpose: "student_admission",
  },
  {
    email: "j@faizaam.example",
    givenName: "Dev",
    familyName: "Candidate",
    displayName: "Dev Job Applicant",
    purpose: "job_application",
  },
];

async function listAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...(data.users ?? []));
    if ((data.users ?? []).length < 1000) return users;
  }
}

const initialUsers = await listAuthUsers();
const nonSynthetic = initialUsers.filter((user) => {
  const email = user.email?.toLowerCase() ?? "";
  return email !== "" && !email.endsWith("@faizaam.example") && !email.endsWith("@example.in");
});
if (nonSynthetic.length > 0) {
  throw new Error("The linked project contains an unexpected email domain; refusing to seed development users.");
}

const authUsers = new Map(initialUsers.map((user) => [user.email?.toLowerCase(), user]));

async function ensureAuthUser(email) {
  const existing = authUsers.get(email);
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error(`Could not update ${email}.`);
    return data.user;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`Could not create ${email}.`);
  authUsers.set(email, data.user);
  return data.user;
}

async function ensurePersonAccount(definition) {
  const user = await ensureAuthUser(definition.email);
  const { data: existingAccount, error: accountReadError } = await admin
    .from("user_accounts")
    .select("id, person_id")
    .eq("id", user.id)
    .maybeSingle();
  if (accountReadError) throw accountReadError;
  if (existingAccount) {
    const { error } = await admin
      .from("user_accounts")
      .update({ status: "active", verified_contact: definition.email })
      .eq("id", user.id);
    if (error) throw error;
    return { user, personId: existingAccount.person_id };
  }
  const { data: person, error: personError } = await admin
    .from("people")
    .insert({
      given_name: definition.givenName,
      family_name: definition.familyName,
      display_name: definition.displayName,
    })
    .select("id")
    .single();
  if (personError) throw personError;
  const { error: accountError } = await admin.from("user_accounts").insert({
    id: user.id,
    person_id: person.id,
    status: "active",
    verified_contact: definition.email,
  });
  if (accountError) throw accountError;
  await admin.from("access_revalidation").upsert({ account_id: user.id, security_version: 1 }, { onConflict: "account_id" });
  return { user, personId: person.id };
}

async function ensureRole(accountId, role) {
  const { data: existing, error: readError } = await admin
    .from("role_grants")
    .select("id")
    .eq("account_id", accountId)
    .eq("role_code", role)
    .eq("status", "active")
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing.id;
  const { data, error } = await admin
    .from("role_grants")
    .insert({
      account_id: accountId,
      role_code: role,
      status: "active",
      effective_from: now,
      reason: "Local synthetic development account",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureStaffAccount(definition) {
  const { user, personId } = await ensurePersonAccount(definition);
  const { data: existingMember, error: memberReadError } = await admin
    .from("staff_members")
    .select("id")
    .eq("person_id", personId)
    .maybeSingle();
  if (memberReadError) throw memberReadError;
  let memberId = existingMember?.id;
  if (memberId) {
    const { error } = await admin
      .from("staff_members")
      .update({ employment_status: "active", title: definition.title })
      .eq("id", memberId);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("staff_members")
      .insert({ person_id: personId, employment_status: "active", title: definition.title })
      .select("id")
      .single();
    if (error) throw error;
    memberId = data.id;
  }

  const grants = new Map();
  for (const role of definition.roles) grants.set(role, await ensureRole(user.id, role));
  const defaultRole = definition.roles[0];
  const { error: preferenceError } = await admin.from("account_context_preferences").upsert(
    { account_id: user.id, active_role_grant_id: grants.get(defaultRole) },
    { onConflict: "account_id" },
  );
  if (preferenceError) throw preferenceError;
}

async function ensureApplicantAccount(definition) {
  const { user } = await ensurePersonAccount(definition);
  const { data: identity, error: readError } = await admin
    .from("applicant_identities")
    .select("id")
    .eq("account_id", user.id)
    .eq("purpose", definition.purpose)
    .maybeSingle();
  if (readError) throw readError;
  if (!identity) {
    const { error } = await admin.from("applicant_identities").insert({
      account_id: user.id,
      purpose: definition.purpose,
      verified_contact: definition.email,
      status: "active",
    });
    if (error) throw error;
  }
}

const { data: currentYear, error: yearError } = await admin
  .from("academic_years")
  .select("id")
  .eq("status", "current")
  .single();
if (yearError) throw yearError;

for (const definition of staffAccounts) await ensureStaffAccount(definition);
for (const definition of applicantAccounts) await ensureApplicantAccount(definition);

const parentDefinition = {
  email: "p@faizaam.example",
  givenName: "Dev",
  familyName: "Parent",
  displayName: "Dev Parent",
};
const { user: parentUser, personId: parentPersonId } = await ensurePersonAccount(parentDefinition);
await ensureRole(parentUser.id, "guardian");
const { data: existingGuardian, error: guardianReadError } = await admin
  .from("guardians")
  .select("id")
  .eq("person_id", parentPersonId)
  .maybeSingle();
if (guardianReadError) throw guardianReadError;
let guardianId = existingGuardian?.id;
if (guardianId) {
  const { error } = await admin.from("guardians").update({ status: "active" }).eq("id", guardianId);
  if (error) throw error;
} else {
  const { data, error } = await admin
    .from("guardians")
    .insert({ person_id: parentPersonId, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  guardianId = data.id;
}

const { data: activeEnrollments, error: enrollmentsError } = await admin
  .from("enrollments")
  .select("student_id")
  .eq("status", "active")
  .eq("academic_year_id", currentYear.id)
  .order("created_at")
  .limit(2);
if (enrollmentsError) throw enrollmentsError;
if ((activeEnrollments ?? []).length < 2) throw new Error("Two fictional active students are required for the parent account.");

const capabilities = ["academics", "finance", "documents", "notices", "profile"];
const linkedStudents = [];
for (const [index, enrollment] of activeEnrollments.entries()) {
  const { data: existingLink, error: linkReadError } = await admin
    .from("guardian_student_links")
    .select("id")
    .eq("guardian_id", guardianId)
    .eq("student_id", enrollment.student_id)
    .limit(1)
    .maybeSingle();
  if (linkReadError) throw linkReadError;
  let linkId = existingLink?.id;
  if (linkId) {
    const { error } = await admin
      .from("guardian_student_links")
      .update({
        relationship_label: "Parent",
        status: "active",
        verification_source: "staff_review",
        approved_at: now,
        effective_from: now,
        effective_to: null,
        restriction_reason: null,
        rejection_reason: null,
        is_emergency_contact: index === 0,
        is_billing_contact: index === 0,
      })
      .eq("id", linkId);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("guardian_student_links")
      .insert({
        guardian_id: guardianId,
        student_id: enrollment.student_id,
        relationship_label: "Parent",
        status: "active",
        verification_source: "staff_review",
        approved_at: now,
        effective_from: now,
        contact_priority: index + 1,
        is_emergency_contact: index === 0,
        is_billing_contact: index === 0,
      })
      .select("id")
      .single();
    if (error) throw error;
    linkId = data.id;
  }
  const { error: capabilityError } = await admin
    .from("guardian_link_capabilities")
    .upsert(capabilities.map((capability) => ({ link_id: linkId, capability })), {
      onConflict: "link_id,capability",
    });
  if (capabilityError) throw capabilityError;
  linkedStudents.push(enrollment.student_id);
}
const { error: parentPreferenceError } = await admin.from("account_context_preferences").upsert(
  { account_id: parentUser.id, active_student_id: linkedStudents[0] },
  { onConflict: "account_id" },
);
if (parentPreferenceError) throw parentPreferenceError;

console.log("Development users are ready:");
for (const email of [
  "p@faizaam.example",
  "a@faizaam.example",
  "j@faizaam.example",
  "ad@faizaam.example",
  "pr@faizaam.example",
]) console.log(`  ${email}`);
console.log("Use the one-click account buttons on the local sign-in pages.");
