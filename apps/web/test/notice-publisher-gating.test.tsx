import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ContentPage from "@/app/staff/content/page";
import { NoticePublisher } from "@/components/staff/NoticePublisher";
import {
  StaffContextProvider,
  STAFF_SESSION_KEYS,
  useStaffContext,
} from "@/components/staff/StaffContextProvider";
import { setDemoNow } from "@/modules/demo/clock";
import { RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import {
  CONTENT_INTENTS_SESSION_KEY,
  CONTENT_SESSION_KEY,
  PUBLIC_PAGES_SESSION_KEY,
  type ContentNotice,
  type PublicPageRow,
} from "@/modules/services/content";
import { sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";

const IDENTITY_SESSION_KEY = sessionKey("identity");

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const AISHA_ACCOUNT_ID = "00000000-0000-4000-8000-000000000204";
const CONTENT_PUBLISHER_GRANT_ID = "00000000-0000-4000-8000-000000000316";
/** A different editor so the maker/checker self-approval guard is satisfied. */
const OTHER_EDITOR_ACCOUNT_ID = "00000000-0000-4000-8000-000000000205";

/** Fictional notices exercising every workflow state the publisher and editor gates cover. */
const NOTICES: ContentNotice[] = [
  {
    slug: "demo-photography-day",
    contentKind: "notice",
    reviewStatus: "published",
    itemVersion: 1,
    authorAccountId: null,
    reviewedByAccountId: null,
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
    contentKind: "notice",
    reviewStatus: "in_review",
    itemVersion: 2,
    authorAccountId: OTHER_EDITOR_ACCOUNT_ID,
    reviewedByAccountId: null,
    category: "Sports",
    title: "Demo sports meet",
    excerpt: "Fictional in-review notice for the gating test.",
    body: ["A fictional sports-meet notice."],
    dateIso: "2026-08-05T06:30:00Z",
    status: "draft",
    audience: "public",
    version: 2,
    publishNote: "Ready for publisher review.",
    reviewDue: "2026-09-15",
    scheduledForIso: null,
  },
  {
    slug: "demo-annual-day-ready",
    contentKind: "notice",
    reviewStatus: "approved",
    itemVersion: 3,
    authorAccountId: OTHER_EDITOR_ACCOUNT_ID,
    reviewedByAccountId: AISHA_ACCOUNT_ID,
    category: "General",
    title: "Demo annual day ready",
    excerpt: "Fictional approved notice ready to release.",
    body: ["A fictional annual day notice ready to publish."],
    dateIso: "2026-08-06T06:30:00Z",
    status: "draft",
    audience: "family",
    version: 3,
    publishNote: "Approved and ready to publish.",
    reviewDue: "2026-09-20",
    scheduledForIso: null,
  },
];

const IN_REVIEW_PAGE: PublicPageRow = {
  key: "school-life",
  contentItemId: "00000000-0000-4000-8000-00000000c301",
  reference: "CTN-2026-C301",
  versionId: "00000000-0000-4000-8000-00000000c302",
  version: 2,
  itemVersion: 2,
  reviewStatus: "in_review",
  currentStatus: "draft",
  authorAccountId: OTHER_EDITOR_ACCOUNT_ID,
  reviewedByAccountId: null,
  publishNote: "Page wording reviewed",
  scheduledForIso: null,
  label: "School life",
  href: "/school-life",
  status: "In review",
  lastReviewed: "—",
  owner: "R. Mir",
};

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

function ContentPageProbe() {
  const { summary, switchWorkspace, switchIdentity } = useStaffContext();
  return (
    <div>
      <p data-testid="page-role">{summary?.role ?? "none"}</p>
      <button onClick={() => void switchIdentity(AISHA_ACCOUNT_ID)}>Use content identity</button>
      <button onClick={() => void switchWorkspace(CONTENT_PUBLISHER_GRANT_ID)}>Use publisher workspace</button>
      <ContentPage />
    </div>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  sessionRemove(STAFF_SESSION_KEYS.identity);
  sessionRemove(PUBLIC_PAGES_SESSION_KEY);
  setDemoNow(PINNED);
});

afterEach(() => {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  sessionRemove(STAFF_SESSION_KEYS.identity);
  sessionRemove(PUBLIC_PAGES_SESSION_KEY);
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

    /* Editors may save drafts but never publish, approve or unpublish. */
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpublish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
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
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.getByText("Approved audience")).toBeTruthy();
    expect(screen.getAllByText("Family").length).toBeGreaterThanOrEqual(2);
  });
});

describe("staff content page maker/checker actions", () => {
  it("lets a different publisher approve and then publish the exact in-review page version", async () => {
    sessionSet(PUBLIC_PAGES_SESSION_KEY, [{ ...IN_REVIEW_PAGE }]);
    const user = userEvent.setup();
    render(
      <StaffContextProvider>
        <ContentPageProbe />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("page-role")).toHaveTextContent("finance_officer"));
    await user.click(screen.getByRole("button", { name: "Use content identity" }));
    await waitFor(() => expect(screen.getByTestId("page-role")).toHaveTextContent("content_editor"));
    await user.click(screen.getByRole("button", { name: "Use publisher workspace" }));
    await waitFor(() => expect(screen.getByTestId("page-role")).toHaveTextContent("content_publisher"));

    const pageRow = screen.getByRole("link", { name: "School life" }).closest("tr");
    expect(pageRow).not.toBeNull();
    await user.click(within(pageRow!).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(within(pageRow!).getByText("Approved")).toBeTruthy());
    await user.click(within(pageRow!).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(within(pageRow!).getByText("Published")).toBeTruthy());

    const persisted = window.sessionStorage.getItem(PUBLIC_PAGES_SESSION_KEY);
    expect(persisted).toContain('"status":"Published"');
    expect(persisted).toContain('"reviewStatus":"published"');
  });
});
