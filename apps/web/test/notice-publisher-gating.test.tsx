import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NoticePublisher } from "@/components/staff/NoticePublisher";
import {
  StaffContextProvider,
  STAFF_SESSION_KEYS,
  useStaffContext,
} from "@/components/staff/StaffContextProvider";
import { setDemoNow } from "@/modules/demo/clock";
import { RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import type { ContentNotice } from "@/modules/services/content";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const IDENTITY_SESSION_KEY = sessionKey("identity");

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const AISHA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";
const CONTENT_PUBLISHER_GRANT_ID = "00000000-0000-4000-8000-000000000316";

/** Two fictional notices: one published row, one draft row. */
const NOTICES: ContentNotice[] = [
  {
    slug: "demo-photography-day",
    category: "General",
    title: "Demo photography day",
    excerpt: "Fictional notice for the gating test.",
    body: ["A fictional photography day notice."],
    dateIso: "2026-08-01T06:30:00Z",
    status: "published",
    audience: "public",
    version: 1,
    publishNote: "Demo publish note.",
    reviewDue: "2026-09-01",
    scheduledForIso: null,
  },
  {
    slug: "demo-sports-meet",
    category: "Sports",
    title: "Demo sports meet",
    excerpt: "Fictional draft notice for the gating test.",
    body: ["A fictional sports-meet notice."],
    dateIso: "2026-08-05T06:30:00Z",
    status: "draft",
    audience: "public",
    version: 0,
    reviewDue: "2026-09-15",
    scheduledForIso: null,
  },
];

function Probe() {
  const { summary, switchWorkspace, switchIdentity } = useStaffContext();
  return (
    <div>
      <p data-testid="role">{summary?.role ?? "none"}</p>
      <button onClick={() => void switchIdentity(AISHA_ACCOUNT_ID)}>Switch identity to Aisha</button>
      <button onClick={() => void switchWorkspace(CONTENT_PUBLISHER_GRANT_ID)}>Switch to publisher</button>
      <NoticePublisher notices={NOTICES} />
    </div>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  sessionRemove(STAFF_SESSION_KEYS.identity);
  setDemoNow(PINNED);
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  sessionRemove(STAFF_SESSION_KEYS.identity);
  setDemoNow(null);
});

describe("NoticePublisher role gating (content.draft vs content.publish)", () => {
  it("shows draft controls for the content editor and hides publish controls", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    /* Aisha's default workspace is content editor. */
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("finance_officer"));
    await user.click(screen.getByRole("button", { name: "Switch identity to Aisha" }));
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("content_editor"));

    /* Editors may save drafts but never publish or unpublish. */
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("shows publish controls for the content publisher and hides draft controls", async () => {
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <Probe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("finance_officer"));
    await user.click(screen.getByRole("button", { name: "Switch identity to Aisha" }));
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("content_editor"));
    await user.click(screen.getByRole("button", { name: "Switch to publisher" }));
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("content_publisher"));

    /* Publishers review and publish; drafting is an editor capability. */
    expect(screen.getByRole("button", { name: "Publish now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });
});
