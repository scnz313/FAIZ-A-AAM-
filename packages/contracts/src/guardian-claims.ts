/**
 * Guardian remote onboarding contracts (three-portal consolidation, Phase 5).
 *
 * Guardian onboarding is school-first: an import or enrollment conversion
 * creates/matches the student, guardian person, guardian record, contacts,
 * enrollment, and relationship; the school then issues a hashed, single-use,
 * expiring claim bound to one guardian, one recorded contact, one provider
 * subject, and an explicit approved link set. A student number, name, date of
 * birth, or phone alone never activates access.
 */

import { z } from "zod";

import { opaqueIdSchema, publicReferenceSchema } from "./relationships";

/** Normalized guardian contact with delivery state kept separate from the
 * relationship itself. Shared contact values are allowed but flagged. */
export const GUARDIAN_CONTACT_STATES = [
  "recorded",
  "delivery_verified",
  "conflicted_review",
  "revoked",
] as const;
export const guardianContactStateSchema = z.enum(GUARDIAN_CONTACT_STATES);
export type GuardianContactState = z.infer<typeof guardianContactStateSchema>;

export const GUARDIAN_CONTACT_CHANNELS = ["sms", "email"] as const;
export const guardianContactChannelSchema = z.enum(GUARDIAN_CONTACT_CHANNELS);
export type GuardianContactChannel = z.infer<typeof guardianContactChannelSchema>;

/** A school-recorded guardian contact. Values are normalized E.164/email. */
export const guardianContactSchema = z.object({
  id: opaqueIdSchema,
  guardianId: opaqueIdSchema,
  channel: z.enum(["sms", "email"]),
  /** Normalized E.164 mobile or lowercase email; display masking is UI-only. */
  value: z.string().min(3),
  state: z.enum(["recorded", "delivery_verified", "conflicted_review", "revoked"]),
  /** True when the same normalized value is recorded for another guardian. */
  sharedContactFlag: z.boolean(),
  verifiedAtIso: z.string().datetime().nullable(),
  version: z.number().int().positive(),
});
export type GuardianContact = z.infer<typeof guardianContactSchema>;

/** Administrator-run onboarding campaign over eligible guardians. */
export const guardianCampaignSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  label: z.string().min(1),
  state: z.enum(["draft", "open", "closed"]),
  academicYearId: opaqueIdSchema.nullable(),
  deliveryChannel: z.enum(["sms", "email"]),
  eligibleGuardianCount: z.number().int().nonnegative(),
  missingContactCount: z.number().int().nonnegative(),
  sharedContactCount: z.number().int().nonnegative(),
  createdByAccountId: opaqueIdSchema,
  createdAtIso: z.string().datetime(),
});
export type GuardianCampaign = z.infer<typeof guardianCampaignSchema>;

/** One hashed, single-use, expiring claim tied to an exact guardian + links. */
export const guardianClaimInvitationSchema = z.object({
  id: opaqueIdSchema,
  ref: publicReferenceSchema,
  campaignId: opaqueIdSchema.nullable(),
  guardianId: opaqueIdSchema,
  /** Exact recorded contact this claim is bound to. */
  guardianContactId: opaqueIdSchema,
  channel: z.enum(["sms", "email"]),
  /** SHA-256 of the high-entropy one-time secret; plaintext never stored. */
  secretHash: z.string().min(32),
  /** Exact preverified guardian/student links this claim may activate. */
  approvedLinkIds: z.array(opaqueIdSchema).min(1),
  status: z.enum(["pending", "dispatched", "claimed", "expired", "revoked", "failed"]),
  expiresAtIso: z.string().datetime(),
  claimedAtIso: z.string().datetime().nullable(),
  providerSubject: opaqueIdSchema.nullable(),
  consentVersion: z.number().int().positive(),
  useCount: z.number().int().nonnegative(),
});
export type GuardianClaimInvitation = z.infer<typeof guardianClaimInvitationSchema>;

export const guardianClaimStartInputSchema = z.object({
  token: z.string().min(16),
});
export type GuardianClaimStartInput = z.infer<typeof guardianClaimStartInputSchema>;

export const guardianClaimAcceptInputSchema = z.object({
  token: z.string().min(16),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  /** OTP/code proof handled by the provider; the server verifies the session. */
  consentVersion: z.number().int().positive(),
});
export type GuardianClaimAcceptInput = z.infer<typeof guardianClaimAcceptInputSchema>;

export const guardianClaimAcceptanceSchema = z.object({
  accountId: opaqueIdSchema,
  guardianId: opaqueIdSchema,
  /** Existing account reused (applicant upgrade) or newly attached. */
  reusedExistingAccount: z.boolean(),
  guardianGrantRef: publicReferenceSchema,
  activatedLinkRefs: z.array(publicReferenceSchema),
  contactDeliveryVerifiedAtIso: z.string().datetime(),
});
export type GuardianClaimAcceptance = z.infer<typeof guardianClaimAcceptanceSchema>;

/** Contact-change request requiring reauthentication and new-contact proof. */
export const guardianContactChangeInputSchema = z.object({
  newContact: z.string().min(5),
  reason: z.string().min(3),
});
export type GuardianContactChangeInput = z.infer<typeof guardianContactChangeInputSchema>;

export const guardianContactChangeStateSchema = z.object({
  accountId: opaqueIdSchema,
  pendingContactValue: z.string().nullable(),
  pendingSinceIso: z.string().datetime().nullable(),
  /** Set when the old contact is unavailable/shared/conflicting. */
  reviewRequired: z.boolean(),
  reviewReason: z.string().nullable(),
});
export type GuardianContactChange = z.infer<typeof guardianContactChangeStateSchema>;

/** Delivery attempt evidence — never contains OTPs or full message bodies. */
export const guardianClaimDeliverySchema = z.object({
  invitationRef: publicReferenceSchema,
  channel: z.enum(["sms", "email"]),
  state: z.enum(["queued", "sent", "delivered", "failed", "suppressed"]),
  attempts: z.number().int().nonnegative(),
  lastAttemptAtIso: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});
export type GuardianClaimDelivery = z.infer<typeof guardianClaimDeliverySchema>;
