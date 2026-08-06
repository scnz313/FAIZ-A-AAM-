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
const PUBLISHER_ROLE_GRANT_ID = "00000000-0000-4000-8000-000000000305";
const TEACHER_ROLE_GRANT_ID = "00000000-0000-4000-8000-000000000302";
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
      <button onClick={() => void switchWorkspace(PUBLISHER_ROLE_GRANT_ID)}>Switch to publisher</button>
      <button onClick={() => void switchWorkspace(TEACHER_ROLE_GRANT_ID)}>Switch to teacher</button>
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
  it("loads the seeded staff account with its granted workspaces", async () => {
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("summary")).toHaveTextContent(
      "Sana Wani · finance_officer · Finance officer · 2026–27",
    );
    expect(screen.getByText("finance_officer")).toBeTruthy();
    expect(screen.getByText("result_publisher")).toBeTruthy();
    expect(screen.getByText("admissions_officer")).toBeTruthy();
    expect(screen.getByText("exam_reviewer")).toBeTruthy();
    expect(screen.getByTestId("identity-count")).toHaveTextContent("4");
  });

  it("switches between granted workspaces", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Switch to publisher" }));

    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent("Sana Wani · result_publisher · Result publisher · 2026–27"),
    );
    void FINANCE_ROLE_GRANT_ID; // the seeded workspace grant id stays on record
  });

  it("denies a workspace that is not granted and keeps the previous one", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Switch to teacher" }));

    await waitFor(() => expect(screen.getByTestId("switch-error")).not.toHaveTextContent(""));
    expect(screen.getByTestId("summary")).toHaveTextContent("finance_officer");
  });

  it("switches the demo identity to another staff account with its own workspaces", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Switch identity to Aisha" }));

    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent("Aisha Lone · content_editor · Content editor · 2026–27"),
    );
    expect(screen.getByTestId("identity")).toHaveTextContent(AISHA_ACCOUNT_ID);
    /* Five workspaces: the four office roles plus the Phase-1 content
       publisher split, defaulting to content editor. */
    expect(screen.getByText("content_editor")).toBeTruthy();
    expect(screen.getByText("content_publisher")).toBeTruthy();
    expect(screen.getByText("support_officer")).toBeTruthy();
    expect(screen.getByText("system_administrator")).toBeTruthy();
  });

  it("switches the demo identity to Rania Mir with the admissions approver active", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Switch identity to Rania" }));

    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent("Rania Mir · admissions_approver · Admissions approver · 2026–27"),
    );
    expect(screen.getByTestId("identity")).toHaveTextContent(RANIA_ACCOUNT_ID);
    expect(screen.getByText("admissions_approver")).toBeTruthy();
    expect(screen.getByText("finance_approver")).toBeTruthy();
    expect(screen.getByText("hr_approver")).toBeTruthy();
    expect(screen.getByText("timetable_manager")).toBeTruthy();
  });
});
