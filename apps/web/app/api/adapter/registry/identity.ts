import { z } from "zod";

import {
  accountHasStaffGrant,
  accountReactivate,
  accountSuspend,
  assignmentsCreate,
  assignmentsEnd,
  invitesCreate,
  invitesRevoke,
  contextStaffSelect,
  guardianLinksRequest,
  linksApprove,
  linksCapabilitiesSet,
  linksReject,
  linksRestrict,
  linksRevoke,
  linksList,
  linksListMine,
  resolveStaffContext,
  recordAuthEvent,
  rolesGrant,
  rolesRevoke,
  staffProfileChange,
  staffProfilesList,
  teachingAssignmentCreate,
  teachingAssignmentEnd,
  teachingStaffCreate,
  teachingStaffList,
  usersListAdmin,
} from "@/lib/supabase/domain";
import { dispatchStaffInvitation, acceptStaffInvitation } from "@/lib/auth/identity-server";

import { emptyPayload, operation, publicReference, uuid } from "./common";
import type { AdapterModule } from "./types";

export const identityModule: AdapterModule = {
  domain: "identity",
  operations: [
    operation("context.staff", z.object({ roleGrantId: uuid.optional(), roleGrantRef: publicReference.optional() }), async ({ supabase, actor, selection }, payload) => {
      if (actor.aal !== "aal2") return Promise.resolve({ ok: false as const, errors: [{ code: "forbidden" as const, message: "Staff verification is required.", field: null }] });
      if (payload.roleGrantId !== undefined) {
        const persisted = await contextStaffSelect(supabase, { roleGrantId: payload.roleGrantId });
        if (!persisted.ok) return persisted;
      }
      return resolveStaffContext(supabase, actor.personId, payload.roleGrantId ?? selection.staffRoleGrantId, actor);
    }),
    operation("context.staff.select", z.object({ roleGrantId: uuid, expectedVersion: z.number().int().nonnegative().optional() }), ({ supabase }, payload) => contextStaffSelect(supabase, payload)),
    operation("identity.hasStaff", emptyPayload, ({ supabase }) => accountHasStaffGrant(supabase)),
    operation("identity.recordAuthEvent", z.object({ event: z.enum(["signed_in", "signed_out", "password_changed"]) }), ({ supabase }, payload) => recordAuthEvent(supabase, payload.event)),
    operation("users.list", emptyPayload, ({ supabase }) => usersListAdmin(supabase)),
    operation("users.grantRole", z.object({ accountId: uuid.optional(), accountRef: publicReference.optional(), roleCode: z.string().min(1), reason: z.string().min(1), academicYearIds: z.array(uuid).optional(), gradeSectionIds: z.array(uuid).optional(), subjectIds: z.array(uuid).optional() }).refine((value) => value.accountId !== undefined || value.accountRef !== undefined, "account reference is required"), ({ supabase }, payload) => rolesGrant(supabase, payload as Parameters<typeof rolesGrant>[1])),
    operation("users.revokeRole", z.object({ grantId: uuid.optional(), grantRef: publicReference.optional(), reason: z.string().min(1), expectedVersion: z.number().int().nonnegative() }).refine((value) => value.grantId !== undefined || value.grantRef !== undefined, "grant reference is required"), ({ supabase }, payload) => rolesRevoke(supabase, payload as Parameters<typeof rolesRevoke>[1])),
    operation("users.suspend", z.object({ accountId: uuid.optional(), accountRef: publicReference.optional(), reason: z.string().min(3) }).refine((value) => value.accountId !== undefined || value.accountRef !== undefined, "account reference is required"), ({ supabase }, payload) => accountSuspend(supabase, payload as Parameters<typeof accountSuspend>[1])),
    operation("users.reactivate", z.object({ accountId: uuid.optional(), accountRef: publicReference.optional(), reason: z.string().min(3) }).refine((value) => value.accountId !== undefined || value.accountRef !== undefined, "account reference is required"), ({ supabase }, payload) => accountReactivate(supabase, payload as Parameters<typeof accountReactivate>[1])),
    operation("assignments.create", z.object({ staffMemberId: uuid.optional(), staffMemberRef: publicReference.optional(), roleGrantId: uuid.optional(), roleGrantRef: publicReference.optional(), academicYearId: uuid.optional(), academicYearRef: publicReference.optional(), gradeSectionId: uuid.nullable().optional(), gradeSectionRef: publicReference.nullable().optional(), subjectId: uuid.nullable().optional(), subjectRef: publicReference.nullable().optional(), effectiveFrom: z.string().nullable().optional() }), ({ supabase }, payload) => assignmentsCreate(supabase, payload as Parameters<typeof assignmentsCreate>[1])),
    operation("assignments.end", z.object({ assignmentId: uuid.optional(), assignmentRef: publicReference.optional(), reason: z.string().min(1), expectedVersion: z.number().int().nonnegative() }).refine((value) => value.assignmentId !== undefined || value.assignmentRef !== undefined, "assignment reference is required"), ({ supabase }, payload) => assignmentsEnd(supabase, payload as Parameters<typeof assignmentsEnd>[1])),
    operation("invites.create", z.object({ contact: z.string().min(3), expiresAt: z.string().min(1), purpose: z.enum(["guardian", "applicant", "job_applicant"]).optional() }), ({ supabase }, payload) => invitesCreate(supabase, payload)),
    operation("invites.revoke", z.object({ invitationRef: publicReference }), ({ supabase }, payload) => invitesRevoke(supabase, payload.invitationRef)),
    operation("staffInvites.create", z.object({
      contact: z.string().email(),
      expiresAt: z.string().datetime(),
      displayName: z.string().min(2),
      title: z.string().min(1).optional(),
      profileCode: z.enum(["administrator", "principal"]),
      reason: z.string().min(3),
    }), ({ supabase }, payload) => dispatchStaffInvitation(supabase, payload as Parameters<typeof dispatchStaffInvitation>[1])),
    operation("staff.profilesList", emptyPayload, ({ supabase }) => staffProfilesList(supabase)),
    operation("staff.profileChange", z.object({
      accountId: z.string().uuid(),
      profileCode: z.enum(["administrator", "principal"]),
      reason: z.string().min(3),
      expectedVersion: z.number().int().nonnegative(),
    }), ({ supabase }, payload) => staffProfileChange(supabase, payload as Parameters<typeof staffProfileChange>[1])),
    operation("staffInvites.accept", z.object({ invitationReference: publicReference, givenName: z.string().min(1), familyName: z.string().min(1) }), ({ supabase }, payload) => acceptStaffInvitation(supabase, payload)),
    operation("teachingStaff.list", emptyPayload, ({ supabase }) => teachingStaffList(supabase)),
    operation("teachingStaff.create", z.object({ displayName: z.string().min(2), title: z.string().min(1), reason: z.string().min(3) }), ({ supabase }, payload) => teachingStaffCreate(supabase, payload)),
    operation("teachingStaff.assign", z.object({ staffMemberId: uuid, academicYearId: uuid, gradeSectionId: uuid, subjectId: uuid, effectiveFrom: z.string().nullable().optional(), reason: z.string().min(3) }), ({ supabase }, payload) => teachingAssignmentCreate(supabase, payload)),
    operation("teachingStaff.endAssignment", z.object({ assignmentId: uuid, reason: z.string().min(3), expectedVersion: z.number().int().positive() }), ({ supabase }, payload) => teachingAssignmentEnd(supabase, payload)),
    operation("links.request", z.object({ studentId: uuid.optional(), studentRef: publicReference.optional(), relationshipLabel: z.string().min(2) }).refine((value) => value.studentId !== undefined || value.studentRef !== undefined, "student reference is required"), ({ supabase }, payload) => guardianLinksRequest(supabase, payload as { studentId: string; relationshipLabel: string })),
    operation("links.approve", z.object({ linkId: uuid, expectedVersion: z.number().int().nonnegative() }), ({ supabase }, payload) => linksApprove(supabase, payload)),
    operation("links.reject", z.object({ linkId: uuid, reason: z.string().min(3), expectedVersion: z.number().int().nonnegative() }), ({ supabase }, payload) => linksReject(supabase, payload)),
    operation("links.restrict", z.object({ linkId: uuid, reason: z.string().min(3), expectedVersion: z.number().int().nonnegative() }), ({ supabase }, payload) => linksRestrict(supabase, payload)),
    operation("links.revoke", z.object({ linkId: uuid, reason: z.string().min(3), expectedVersion: z.number().int().nonnegative() }), ({ supabase }, payload) => linksRevoke(supabase, payload)),
    operation("links.capabilities", z.object({ linkId: uuid, capabilities: z.array(z.enum(["academics", "finance", "documents", "notices", "profile"])), expectedVersion: z.number().int().nonnegative() }), ({ supabase }, payload) => linksCapabilitiesSet(supabase, payload)),
    operation("links.listPending", emptyPayload, ({ supabase }) => linksList(supabase, "pending_verification")),
    operation("links.listActive", emptyPayload, ({ supabase }) => linksList(supabase, "active")),
    operation("links.listMine", emptyPayload, ({ supabase }) => linksListMine(supabase)),
  ],
};
