import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StaffContextProvider, useStaffContext } from "@/components/staff/StaffContextProvider";
import { setDemoNow } from "@/modules/demo/clock";
import { RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const IDENTITY_SESSION_KEY = sessionKey("identity");
const FINANCE_ROLE_GRANT_ID = "00000000-0000-4000-8000-000000000304";
const ADMIN_FINANCE_APPROVER_GRANT_ID = "00000000-0000-4000-8000-000000000312";
const TEACHER_ROLE_GRANT_ID = "00000000-0000-4000-8000-000000000302";
const SANA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000203";
const AISHA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";
const RANIA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000205";

function Probe() {
  const { status, summary, workspaces, identityId, demoIdentities, switchWorkspace, switchIdentity, switchError } =
    useStaffContext();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="summary">
        {summary ? `${summary.displayName} · ${summary.role} · ${summary.roleLabel} · ${summary.academicYearLabel}` : "none"}
      </p>
      <p data-testid="identity">{identityId ?? "none"}</p>
      <ul>
        {workspaces.map((workspace) => (
          <li key={workspace.id}>{workspace.role}</li>
        ))}
      </ul>
      <button onClick={() => void switchWorkspace(ADMIN_FINANCE_APPROVER_GRANT_ID)}>Switch to administrator finance approver</button>
      <button onClick={() => void switchWorkspace(TEACHER_ROLE_GRANT_ID)}>Switch to teacher</button>
      <button onClick={() => void switchIdentity(SANA_ACCOUNT_ID)}>Switch identity to Sana</button>
      <button onClick={() => void switchIdentity(AISHA_ACCOUNT_ID)}>Switch identity to Aisha</button>
      <button onClick={() => void switchIdentity(RANIA_ACCOUNT_ID)}>Switch identity to Rania</button>
      <p data-testid="identity-count">{demoIdentities.length}</p>
      <p data-testid="switch-error">{switchError ?? ""}</p>
    </div>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(PINNED);
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(null);
});

describe("StaffContextProvider", () => {
  it("loads the default Administrator persona with its aggregated profile roles", async () => {
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("summary")).toHaveTextContent(
      "Aisha Lone · content_publisher · Content publisher · 2026–27",
    );
    expect(screen.getByText("content_publisher")).toBeTruthy();
    expect(screen.getByText("system_administrator")).toBeTruthy();
    expect(screen.getByText("admissions_approver")).toBeTruthy();
    expect(screen.getByText("finance_approver")).toBeTruthy();
    expect(screen.getByText("hr_approver")).toBeTruthy();
    expect(screen.getByText("exam_reviewer")).toBeTruthy();
    expect(screen.getByText("result_publisher")).toBeTruthy();
    expect(screen.getByText("auditor")).toBeTruthy();
    /* Two profile personas plus the legacy multi-role persona. */
    expect(screen.getByTestId("identity-count")).toHaveTextContent("3");
  });

  it("rejects granular workspace switching for the administrator profile account", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    /* Aisha is a profile account (administrator): granular workspace switching
       is rejected — the profile bundle is the only authorization surface. */
    await user.click(screen.getByRole("button", { name: "Switch to administrator finance approver" }));

    await waitFor(() => expect(screen.getByTestId("switch-error")).not.toHaveTextContent(""));
    expect(screen.getByTestId("switch-error")).toHaveTextContent(/not available for access-profile accounts/);
    /* The summary keeps the profile account's active workspace unchanged. */
    expect(screen.getByTestId("summary")).toHaveTextContent("content_publisher");
    void ADMIN_FINANCE_APPROVER_GRANT_ID; // the legacy grant id remains on record
  });

  it("denies a workspace that is not granted and keeps the previous one", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Switch identity to Sana" }));
    await waitFor(() => expect(screen.getByTestId("summary")).toHaveTextContent("finance_officer"));
    await user.click(screen.getByRole("button", { name: "Switch to teacher" }));

    await waitFor(() => expect(screen.getByTestId("switch-error")).not.toHaveTextContent(""));
    expect(screen.getByTestId("summary")).toHaveTextContent("finance_officer");
  });

  it("switches the demo identity to Rania Mir with the principal profile", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Switch identity to Rania" }));

    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent("Rania Mir · content_editor · Content editor · 2026–27"),
    );
    expect(screen.getByTestId("identity")).toHaveTextContent(RANIA_ACCOUNT_ID);
    expect(screen.getByText("content_editor")).toBeTruthy();
    expect(screen.getByText("admissions_officer")).toBeTruthy();
    expect(screen.getByText("finance_officer")).toBeTruthy();
    expect(screen.getByText("hr_reviewer")).toBeTruthy();
    expect(screen.getByText("result_entry_officer")).toBeTruthy();
    expect(screen.getByText("timetable_manager")).toBeTruthy();
    expect(screen.getByText("support_officer")).toBeTruthy();
  });

});
