import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StaffInvitationForm from "@/components/identity/StaffInvitationForm";
import { setDemoNow } from "@/modules/demo/clock";
import { STAFF_INVITATIONS_SESSION_KEY, usersService } from "@/modules/services/users";
import { sessionRemove } from "@/modules/services/session";

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(STAFF_INVITATIONS_SESSION_KEY);
  setDemoNow(new Date("2026-08-10T05:00:00.000Z"));
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(STAFF_INVITATIONS_SESSION_KEY);
  setDemoNow(null);
});

describe("StaffInvitationForm", () => {
  it("accepts a locally created invitation and exposes the materialized references", async () => {
    const invitation = await usersService.inviteUser({
      name: "New Teacher",
      email: "new.teacher@faizaam.example",
      role: "teacher",
      reason: "Class 8 staffing.",
    });
    const user = userEvent.setup();
    render(<StaffInvitationForm initialInvitationRef={invitation.invitationRef} />);

    await user.type(screen.getByLabelText(/one-time reference/i), invitation.oneTimeRef);
    await user.type(screen.getByLabelText(/given name/i), "New");
    await user.type(screen.getByLabelText(/family name/i), "Teacher");
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Your staff account is ready." })).toBeTruthy());
    expect(screen.getByText("Teacher", { exact: true })).toBeTruthy();
    expect(screen.getByText(/ACC-2026-/)).toBeTruthy();
  });

  it("shows a recoverable error for a reused reference", async () => {
    const invitation = await usersService.inviteUser({
      name: "Reuse Teacher",
      email: "reuse.teacher@faizaam.example",
      role: "teacher",
      reason: "Replacement coverage.",
    });
    await usersService.acceptInvitation({
      invitationRef: invitation.invitationRef,
      oneTimeRef: invitation.oneTimeRef,
      givenName: "Reuse",
      familyName: "Teacher",
    });
    const user = userEvent.setup();
    render(<StaffInvitationForm initialInvitationRef={invitation.invitationRef} />);
    await user.type(screen.getByLabelText(/one-time reference/i), invitation.oneTimeRef);
    await user.type(screen.getByLabelText(/given name/i), "Reuse");
    await user.type(screen.getByLabelText(/family name/i), "Teacher");
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already been used/));
  });

  it("uses the verified Auth invitation session in Supabase mode instead of rendering a manual token field", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("staff-invite-accept")) {
        return new Response(JSON.stringify({ ok: true, value: { accountId: "acct-1", staffMemberId: "staff-1", grantRef: "ROLE-1" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, value: [{ id: "acct-1", status: "active", verified_contact: "new@example.test", people: { display_name: "New Teacher" }, staff_members: [], role_grants: [{ id: "grant-1", reference: "ROLE-1", role_code: "teacher", status: "active", version: 1, effective_from: "2026-01-01T00:00:00Z", effective_to: null }] }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StaffInvitationForm initialInvitationRef="INV-2026-0501" />);

    expect(screen.queryByLabelText(/one-time reference/i)).toBeNull();
    await user.type(screen.getByLabelText(/given name/i), "New");
    await user.type(screen.getByLabelText(/family name/i), "Teacher");
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Your staff account is ready." })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/staff-invite-accept", expect.objectContaining({ method: "POST" }));
  });
});
