import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FamilyContextProvider, useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { setDemoNow } from "@/modules/demo/clock";
import { gradeSectionLabel, RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const IDENTITY_SESSION_KEY = sessionKey("identity");
const AARIF_ID = "00000000-0000-4000-8000-000000000901";
const MARIAM_ID = "00000000-0000-4000-8000-000000000902";
const UNLINKED_ID = "00000000-0000-4000-8000-000000009999";

function Probe() {
  const { status, students, activeStudent, switchStudent, switchError } = useFamilyContext();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <ul>
        {students.map((item) => (
          <li key={item.student.id}>
            {item.student.displayName} · {gradeSectionLabel(item.gradeSection)} · {item.academicYear.label}
            {activeStudent?.student.id === item.student.id ? " (active)" : ""}
          </li>
        ))}
      </ul>
      <p data-testid="active">{activeStudent?.student.id ?? "none"}</p>
      <button onClick={() => void switchStudent(MARIAM_ID)}>Switch to Mariam</button>
      <button onClick={() => void switchStudent(UNLINKED_ID)}>Switch to unlinked child</button>
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

describe("FamilyContextProvider", () => {
  it("loads both linked children and defaults to the first active enrollment", async () => {
    render(
      <FamilyContextProvider>
        <Probe />
      </FamilyContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByText(/Aarif Hussain · Class 8-A · 2026–27 \(active\)/)).toBeTruthy();
    expect(screen.getByText(/Mariam Hussain · Class 8-A · 2026–27/)).toBeTruthy();
    expect(screen.getByTestId("active")).toHaveTextContent(AARIF_ID);
  });

  it("switches the active child and persists the selection through the service", async () => {
    const user = userEvent.setup();
    render(
      <FamilyContextProvider>
        <Probe />
      </FamilyContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Switch to Mariam" }));

    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent(MARIAM_ID));
    expect(screen.getByText(/Mariam Hussain · Class 8-A · 2026–27 \(active\)/)).toBeTruthy();
    expect(screen.getByText(/Aarif Hussain · Class 8-A · 2026–27/)).toBeTruthy();
  });

  it("rejects an unlinked child without changing the previous selection", async () => {
    const user = userEvent.setup();
    render(
      <FamilyContextProvider>
        <Probe />
      </FamilyContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Switch to unlinked child" }));

    await waitFor(() => expect(screen.getByTestId("switch-error")).not.toHaveTextContent(""));
    expect(screen.getByTestId("active")).toHaveTextContent(AARIF_ID);
  });
});
