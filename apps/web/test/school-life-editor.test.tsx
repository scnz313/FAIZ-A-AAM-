// @vitest-environment jsdom
/**
 * School life page editor: loads the managed page record, edits the
 * structured sections, saves through contentService.savePageDraft with the
 * school-life slug, keeps the publisher self-publish rule visible, and
 * restores earlier versions into the form.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const staffMocks = vi.hoisted(() => ({ useStaffContext: vi.fn() }));

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: staffMocks.useStaffContext,
}));
vi.mock("@/modules/services/adapter-client", () => ({
  clientAdapterMode: () => "demo",
  adapterCall: vi.fn(async () => ({ ok: false, errors: [{ code: "unavailable", message: "demo" }] })),
}));

import { DEFAULT_SCHOOL_LIFE_BODY, type SchoolLifePageBody } from "@fass/contracts";
import SchoolLifePageEditor from "@/app/staff/content/pages/school-life/SchoolLifePageEditor";
import {
  contentService,
  MANAGED_PAGES_SESSION_KEY,
  PUBLIC_PAGES_SESSION_KEY,
  type ManagedPageState,
} from "@/modules/services/content";
import { sessionRemove } from "@/modules/services/session";

const EDITOR_SUMMARY = {
  accountId: "acct-editor",
  displayName: "Demo Editor",
  role: "content_editor",
  roleLabel: "Content editor",
  roles: ["content_editor"],
  profileCode: "principal",
  profileLabel: "Principal",
};
const PUBLISHER_SUMMARY = {
  accountId: "acct-publisher",
  displayName: "Demo Publisher",
  role: "content_publisher",
  roleLabel: "Content publisher",
  roles: ["content_publisher"],
  profileCode: "administrator",
  profileLabel: "Administrator",
};

function bodyWithTitle(title: string): SchoolLifePageBody {
  const body = JSON.parse(JSON.stringify(DEFAULT_SCHOOL_LIFE_BODY)) as SchoolLifePageBody;
  body.intro.title = title;
  return body;
}

function managedState(overrides: Partial<ManagedPageState> = {}): ManagedPageState {
  return {
    slug: "school-life",
    contentItemId: "item-school-life",
    reference: "CTN-2026-SLIFE",
    itemVersion: 2,
    currentStatus: "draft",
    versions: [
      {
        id: "v2",
        version: 2,
        title: "School life",
        reviewStatus: "draft",
        authorAccountId: EDITOR_SUMMARY.accountId,
        authorDisplayName: EDITOR_SUMMARY.displayName,
        reviewedByAccountId: null,
        publishedAt: null,
        createdAt: "2026-09-16T05:00:00.000Z",
        body: bodyWithTitle("Drafted school life"),
      },
      {
        id: "v1",
        version: 1,
        title: "School life",
        reviewStatus: "published",
        authorAccountId: "acct-founder",
        authorDisplayName: "Demo founder",
        reviewedByAccountId: "acct-publisher",
        publishedAt: "2026-09-10T05:00:00.000Z",
        createdAt: "2026-09-10T05:00:00.000Z",
        body: bodyWithTitle("Earlier published title"),
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  staffMocks.useStaffContext.mockReset();
  staffMocks.useStaffContext.mockReturnValue({ summary: EDITOR_SUMMARY, status: "ready" });
  sessionRemove(MANAGED_PAGES_SESSION_KEY);
  sessionRemove(PUBLIC_PAGES_SESSION_KEY);
});

describe("SchoolLifePageEditor", () => {
  it("loads the section editors, the live preview and the version history", async () => {
    render(<SchoolLifePageEditor />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Introduction" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Programmes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Facilities" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Gallery" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByText("Version history")).toBeInTheDocument();
    /* Not dirty yet — the seeded draft body loads into the form. */
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    /* The preview renders the real page composition. */
    expect(screen.getAllByText("Sports").length).toBeGreaterThan(0);
  });

  it("shows the version author's display name in the status strip", async () => {
    staffMocks.useStaffContext.mockReturnValue({ summary: PUBLISHER_SUMMARY, status: "ready" });
    vi.spyOn(contentService, "getPage").mockResolvedValue(managedState());
    render(<SchoolLifePageEditor />);
    /* The latest version is authored by EDITOR_SUMMARY — the publisher sees
       the resolved name rather than a raw account id or a bare "staff". */
    await waitFor(() => expect(screen.getByText(/Last saved by Demo Editor/)).toBeInTheDocument());
  });

  it("switches between edit and preview views with the status-strip toggle", async () => {
    const user = userEvent.setup();
    const { container } = render(<SchoolLifePageEditor />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Programmes" })).toBeInTheDocument());

    const grid = container.querySelector("[data-view]");
    expect(grid).toHaveAttribute("data-view", "edit");
    const previewToggle = screen.getByRole("button", { name: "Preview" });
    expect(previewToggle).toHaveAttribute("aria-pressed", "false");

    await user.click(previewToggle);
    expect(grid).toHaveAttribute("data-view", "preview");
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(grid).toHaveAttribute("data-view", "edit");
  });

  it("adds, reorders and removes programmes with labelled buttons", async () => {
    const user = userEvent.setup();
    render(<SchoolLifePageEditor />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Programmes" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Add programme" }));
    expect(screen.getByText("7 · Item")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Move Arts & crafts up" }));
    expect(screen.getByText("1 · Arts & crafts")).toBeInTheDocument();
    expect(screen.getByText("2 · Sports")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Sports" }));
    await user.click(screen.getByRole("button", { name: "Confirm removal of Sports" }));
    expect(screen.queryByText(/· Sports/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
  });

  it("saves through savePageDraft with the school-life slug and structured body", async () => {
    const spy = vi.spyOn(contentService, "savePageDraft");
    const user = userEvent.setup();
    render(<SchoolLifePageEditor />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Introduction" })).toBeInTheDocument());

    const titleInput = screen.getByLabelText("Deck");
    await user.clear(titleInput);
    await user.type(titleInput, "A changed deck.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(screen.getByText(/Draft version 2 saved/)).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith(
      "school-life",
      expect.objectContaining({
        body: expect.objectContaining({ schemaVersion: 1, page: "school-life" }),
      }),
    );
    expect(screen.queryAllByText("Unsaved changes")).toHaveLength(0);
  });

  it("refuses to save while fields fail the schema", async () => {
    const spy = vi.spyOn(contentService, "savePageDraft");
    const user = userEvent.setup();
    render(<SchoolLifePageEditor />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Introduction" })).toBeInTheDocument());

    /* The intro Title is the first "Title" field in the document. */
    const titleInput = screen.getAllByLabelText("Title")[0]!;
    await user.clear(titleInput);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(screen.getByText("Resolve the highlighted fields before saving the draft.")).toBeInTheDocument(),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("disables Publish with the self-publish note when the publisher authored the version", async () => {
    staffMocks.useStaffContext.mockReturnValue({ summary: PUBLISHER_SUMMARY, status: "ready" });
    const state = managedState({
      versions: [
        {
          id: "v2",
          version: 2,
          title: "School life",
          reviewStatus: "approved",
          authorAccountId: PUBLISHER_SUMMARY.accountId,
          authorDisplayName: PUBLISHER_SUMMARY.displayName,
          reviewedByAccountId: null,
          publishedAt: null,
          createdAt: "2026-09-16T05:00:00.000Z",
          body: bodyWithTitle("Publisher draft"),
        },
      ],
    });
    vi.spyOn(contentService, "getPage").mockResolvedValue(state);

    render(<SchoolLifePageEditor />);
    await waitFor(() => expect(screen.getByText("Approved · v2")).toBeInTheDocument());

    const wrapper = screen.getByTitle("Another content publisher must publish your own edit");
    const publish = wrapper.querySelector("button");
    expect(publish).not.toBeNull();
    expect(publish).toBeDisabled();
  });

  it("shows the disabled Publish note while the publisher's own version is still a draft", async () => {
    staffMocks.useStaffContext.mockReturnValue({ summary: PUBLISHER_SUMMARY, status: "ready" });
    const state = managedState({
      versions: [
        {
          id: "v5",
          version: 5,
          title: "School life",
          reviewStatus: "draft",
          authorAccountId: PUBLISHER_SUMMARY.accountId,
          authorDisplayName: PUBLISHER_SUMMARY.displayName,
          reviewedByAccountId: null,
          publishedAt: null,
          createdAt: "2026-09-16T05:00:00.000Z",
          body: bodyWithTitle("Publisher draft"),
        },
      ],
    });
    vi.spyOn(contentService, "getPage").mockResolvedValue(state);

    render(<SchoolLifePageEditor />);
    await waitFor(() => expect(screen.getByText("Draft · v5")).toBeInTheDocument());

    const wrapper = screen.getByTitle("Another content publisher must publish your own edit");
    expect(wrapper.querySelector("button")).toBeDisabled();
  });

  it("lets the publishing author submit their own page draft for review", async () => {
    staffMocks.useStaffContext.mockReturnValue({ summary: PUBLISHER_SUMMARY, status: "ready" });
    const state = managedState({
      versions: [
        {
          id: "v2",
          version: 2,
          title: "School life",
          reviewStatus: "draft",
          authorAccountId: PUBLISHER_SUMMARY.accountId,
          authorDisplayName: PUBLISHER_SUMMARY.displayName,
          reviewedByAccountId: null,
          publishedAt: null,
          createdAt: "2026-09-16T05:00:00.000Z",
          body: bodyWithTitle("Publisher draft"),
        },
      ],
    });
    vi.spyOn(contentService, "getPage").mockResolvedValue(state);
    const transitionSpy = vi
      .spyOn(contentService, "setPublicPageStatus")
      .mockResolvedValue({ ok: true, value: { ...managedState().versions[0], key: "school-life" } as never });

    const user = userEvent.setup();
    render(<SchoolLifePageEditor />);
    await waitFor(() => expect(screen.getByText("Draft · v2")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() =>
      expect(transitionSpy).toHaveBeenCalledWith(
        "school-life",
        "In review",
        expect.objectContaining({ accountId: PUBLISHER_SUMMARY.accountId }),
        expect.objectContaining({ expectedVersion: 2 }),
      ),
    );
  });

  it("restores an earlier version into the form as unsaved changes", async () => {
    vi.spyOn(contentService, "getPage").mockResolvedValue(managedState());
    const user = userEvent.setup();
    render(<SchoolLifePageEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Drafted school life")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Restore version 1 into the editor" }));
    await waitFor(() => expect(screen.getByDisplayValue("Earlier published title")).toBeInTheDocument());
    expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });
});
