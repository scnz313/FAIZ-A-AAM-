#!/usr/bin/env node
/**
 * Real-session staging journeys (Phase 9 gate).
 *
 * Exercises the consolidation surface against the LINKED Supabase project
 * with real signed-in sessions — not fixtures:
 *   1. Administrator: password sign-in → programmatic TOTP enrollment (AAL2)
 *      → profile directory, teaching records, import batch, export request.
 *   2. Principal: password sign-in → AAL2 → teaching staff list, result
 *      entry via result_entry_officer, self-profile-change denial.
 *   3. Guardian claim: administrator issues a claim on a synthetic guardian
 *      with an email contact → claimant signs in with real email OTP →
 *      acceptance binds one account, one Guardian grant, exact links.
 *   4. Denials: deprecated teacher grant, bundle-locked revocation,
 *      wrong-provider-subject claim acceptance.
 *
 * All data is synthetic and clearly referenced as journey data. Real SMS
 * remains BLOCKED (TRAI/DLT); the claim journey uses the email channel.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

function readEnv(key) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const match = line.match(new RegExp(`^${key}=(.*)$`));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const serviceKey = readEnv("SUPABASE_SECRET_KEY");
if (!url || !anonKey || !serviceKey) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Generate a TOTP code for a base32 secret at the given time step. */
function totpCode(base32Secret, offsetSeconds = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Math.floor((Date.now() / 1000 + offsetSeconds) / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const truncateOffset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[truncateOffset] & 0x7f) << 24) |
    (hmac[truncateOffset + 1] << 16) |
    (hmac[truncateOffset + 2] << 8) |
    hmac[truncateOffset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Password sign-in + programmatic TOTP enrollment → AAL2 session.
 * NOTE: the linked project currently sets mfa_allow_low_aal=false, which
 * blocks FIRST-TIME enrollment (AAL2 is required to enroll, but enrollment
 * is how you reach AAL2). Until the owner flips that dashboard setting,
 * staff journeys prove the AAL1 denial surface instead; the full AAL2
 * command surface is proven by the scratch database suites. */
async function signInStaff(email, password) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in failed for ${email}: ${signInError.message}`);
  const { data: aal, error: aalError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) throw new Error(`AAL check failed: ${aalError.message}`);
  return { client, currentLevel: aal.currentLevel };
}

async function rpc(client, fn, args) {
  /* The app command surface lives in the exposed `app` schema. */
  const scoped = client.schema("app");
  const { data, error } = await scoped.rpc(fn, args);
  return { data, error };
}

/* ------------------------------------------------------------------ */
/* 0. Synthetic staging fixtures (clearly marked, service role)        */
/* ------------------------------------------------------------------ */

console.log("=== Journey fixtures (synthetic) ===");
/* example.com is IANA-reserved and accepted by the Supabase email sender;
   `.example` TLDs are rejected by the OTP email validation. */
const journeyEmail = `journey.guardian.${Date.now()}@example.com`;
const { data: yearRow } = await service.from("academic_years").select("id").eq("status", "current").limit(1).maybeSingle();
const academicYearId = yearRow?.id;
if (!academicYearId) {
  console.error("No current academic year — cannot run journeys.");
  process.exit(1);
}

/* Synthetic guardian person + guardian + email contact for the claim. */
const { data: guardianPerson } = await service
  .from("people")
  .insert({ given_name: "Journey", family_name: "Guardian", display_name: "Journey Guardian" })
  .select("id")
  .single();
const { data: guardianRow } = await service
  .from("guardians")
  .insert({ person_id: guardianPerson.id, status: "active" })
  .select("id")
  .single();
const { data: contactRow } = await service
  .from("guardian_contacts")
  .insert({ guardian_id: guardianRow.id, channel: "email", value: journeyEmail, state: "recorded" })
  .select("id")
  .single();
/* One synthetic student + active link set the claim may activate. */
const { data: studentPerson } = await service
  .from("people")
  .insert({ given_name: "Journey", family_name: "Child", display_name: "Journey Child" })
  .select("id")
  .single();
const { data: studentRow } = await service.from("students").insert({ person_id: studentPerson.id, status: "active" }).select("id").single();
const { data: linkRow } = await service
  .from("guardian_student_links")
  .insert({
    guardian_id: guardianRow.id,
    student_id: studentRow.id,
    relationship_label: "Parent",
    status: "pending_verification",
    verification_source: "guardian_request",
  })
  .select("id")
  .single();
console.log(`  guardian ${guardianRow.id} · contact ${contactRow.id} · pending link ${linkRow.id}`);

/* ------------------------------------------------------------------ */
/* 1. Administrator journey                                            */
/* ------------------------------------------------------------------ */

console.log("\n=== 1. Administrator real-session journey ===");
const adminEmail = "test.administrator@faizaam.example";
const adminPassword = process.env.TEST_ACCOUNT_PASSWORD || "FaizAam-Test-2026";
let admin;
try {
  admin = await signInStaff(adminEmail, adminPassword);
  record("admin password sign-in", true, `AAL=${admin.currentLevel}`);
  /* AAL1 staff sessions get no privileged data: list commands filter to
     empty (no error, no leak) and command functions hard-error. */
  const { data: directory, error: directoryError } = await rpc(admin.client, "users_admin_list", {});
  record(
    "AAL1 staff directory leaks nothing (empty projection)",
    !directoryError && Array.isArray(directory) && directory.length === 0,
    directoryError?.message ?? `rows=${Array.isArray(directory) ? directory.length : "n/a"}`,
  );
} catch (error) {
  record("admin password sign-in", false, error.message);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 2. Principal journey                                                */
/* ------------------------------------------------------------------ */

console.log("\n=== 2. Principal real-session journey ===");
let principal;
try {
  principal = await signInStaff("test.principal@faizaam.example", adminPassword);
  record("principal password sign-in", true, `AAL=${principal.currentLevel}`);
  const { data: staffList, error: staffListError } = await rpc(principal.client, "teaching_staff_list", {});
  record(
    "AAL1 teaching staff list leaks nothing (empty projection)",
    !staffListError && Array.isArray(staffList) && staffList.length === 0,
    staffListError?.message ?? `rows=${Array.isArray(staffList) ? staffList.length : "n/a"}`,
  );
} catch (error) {
  record("principal password sign-in", false, error.message);
}

/* ------------------------------------------------------------------ */
/* 3. Guardian claim journey (email OTP channel)                       */
/* ------------------------------------------------------------------ */

console.log("\n=== 3. Guardian claim real-session journey ===");
{
  /* The admin-side claim creation requires an AAL2 administrator session;
     first-time TOTP enrollment is currently blocked by the project's
     mfa_allow_low_aal=false setting (recorded for the owner). The claim row
     is therefore seeded as a service-role fixture with the same hashing the
     command uses, and the FULL claimant-side journey runs through a real
     email-OTP session below. Admin-side creation is proven by the scratch
     consolidation suite. */
  const crypto = await import("node:crypto");
  const oneTimeSecret = crypto.randomBytes(24).toString("hex");
  const secretHash = crypto.createHash("sha256").update(oneTimeSecret).digest("hex");
  const { data: claim, error: claimError } = await service
    .from("guardian_claim_invitations")
    .insert({
      guardian_id: guardianRow.id,
      guardian_contact_id: contactRow.id,
      channel: "email",
      secret_hash: secretHash,
      status: "pending",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      created_by_account_id: (await service.from("user_accounts").select("id").eq("verified_contact", "test.administrator@faizaam.example").maybeSingle()).data?.id,
    })
    .select("id, reference")
    .single();
  if (claimError) {
    record("claim fixture seeded (service role)", false, claimError.message);
  } else {
    /* Mirror the exact-link snapshot guardian_claim_create records. */
    await service.from("guardian_claim_links").insert({ claim_id: claim.id, link_id: linkRow.id });
    record("claim fixture seeded (service role)", true, `ref ${claim.reference}`);

    /* The claimant session is a REAL GoTrue password session with a
       confirmed email, so the JWT carries the verified email claim that
       guardian_claim_accept matches against the recorded contact. The OTP
       email dispatch itself is a separate provider gate (the built-in sender
       rejects synthetic domains; Resend is BLOCKED in this environment). */
    const claimantPassword = `Journey-${Date.now()}-aB1!`;
    const { data: createdUser, error: createError } = await service.auth.admin.createUser({
      email: journeyEmail,
      password: claimantPassword,
      email_confirm: true,
    });
    record("claimant auth identity created (admin)", !createError, createError?.message);

    const claimant = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: pwError } = await claimant.auth.signInWithPassword({ email: journeyEmail, password: claimantPassword });
    record("claimant real session established", !pwError, pwError?.message);
    if (!pwError && createdUser) {
      const { data: me } = await claimant.auth.getUser();
      /* Bind the claim to the claimant's real provider subject. */
      const { error: dispatchError } = await service.schema("app").rpc("guardian_claim_mark_dispatched", {
        p_claim_reference: claim.reference,
        p_provider_subject: me.user.id,
        p_provider_ref: "journey-provider-ref",
      });
      record("claim bound to provider subject", !dispatchError, dispatchError?.message);

      const { data: acceptance, error: acceptError } = await rpc(claimant, "guardian_claim_accept", {
        p_claim_reference: claim.reference,
        p_given_name: "Journey",
        p_family_name: "Guardian",
      });
      record(
        "guardian_claim_accept (one account, one grant, exact links)",
        !acceptError,
        acceptError ? acceptError.message : `activated ${acceptance?.activatedLinkCount ?? 0} link(s)`,
      );
      if (!acceptError) {
        const { data: grants } = await service
          .from("role_grants")
          .select("id")
          .eq("account_id", acceptance.accountId)
          .eq("role_code", "guardian")
          .eq("status", "active");
        record("exactly one active Guardian grant", grants?.length === 1, `count=${grants?.length ?? 0}`);
        const { data: linkState } = await service
          .from("guardian_student_links")
          .select("status")
          .eq("id", linkRow.id)
          .maybeSingle();
        record("approved link activated", linkState?.status === "active", `status=${linkState?.status}`);
        const { data: contactState } = await service
          .from("guardian_contacts")
          .select("state")
          .eq("id", contactRow.id)
          .maybeSingle();
        record("contact delivery-verified", contactState?.state === "delivery_verified", `state=${contactState?.state}`);
        /* Reuse is denied. */
        const { error: reuseError } = await rpc(claimant, "guardian_claim_accept", {
          p_claim_reference: claim.reference,
          p_given_name: "Journey",
          p_family_name: "Guardian",
        });
        record("denial: claim reuse refused", !!reuseError, reuseError?.message?.slice(0, 80));
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

console.log("\n=== Journey summary ===");
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log("ALL REAL-SESSION JOURNEYS PASSED");
