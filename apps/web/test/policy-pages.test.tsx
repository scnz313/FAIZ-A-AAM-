/**
 * C6 policy/disclosure managed overrides: a published managed page replaces
 * the institutional fallback, a missing, unpublished, or failed read keeps it,
 * and the disclosure parser never invents a verification status.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadServerPublicPageBody: vi.fn(),
  dataAdapter: vi.fn(() => "supabase" as "demo" | "supabase"),
}));

vi.mock("@/lib/supabase/server-loaders", () => ({
  loadServerPublicPageBody: mocks.loadServerPublicPageBody,
}));

vi.mock("@/lib/supabase/env", () => ({
  dataAdapter: mocks.dataAdapter,
}));

import PrivacyPolicyPage from "@/app/(public)/policies/privacy/page";
import TermsPolicyPage from "@/app/(public)/policies/terms/page";
import DisclosurePage from "@/app/(public)/disclosure/page";
import { resolvePolicyPageView } from "@/components/public/pages/PolicyPage";
import { policies } from "@/modules/content/demo";

beforeEach(() => {
  mocks.loadServerPublicPageBody.mockReset();
  mocks.dataAdapter.mockReset();
  mocks.dataAdapter.mockReturnValue("supabase");
});

describe("resolvePolicyPageView", () => {
  it("replaces the fallback policy with the published managed page", () => {
    const view = resolvePolicyPageView(policies.privacy, {
      title: "Privacy notice",
      body: ["Managed collection statement.", "Managed retention statement."],
      updatedAtIso: "2026-08-10T06:00:00.000Z",
    });

    expect(view.managed).toBe(true);
    expect(view.title).toBe("Privacy notice");
    expect(view.updatedLabel).toBe("10 August 2026");
    expect(view.sections).toEqual([
      { heading: null, body: ["Managed collection statement."] },
      { heading: null, body: ["Managed retention statement."] },
    ]);
    expect(view.sections.flatMap((section) => section.body)).not.toContain(
      "The final privacy notice will follow the school's confirmed policy and applicable law.",
    );
  });

  it("keeps the fallback policy when the managed body is missing or empty", () => {
    const missing = resolvePolicyPageView(policies.terms, null);
    expect(missing.managed).toBe(false);
    expect(missing.title).toBe(policies.terms.title);
    expect(missing.updatedLabel).toBe("1 July 2026");
    expect(missing.sections).toEqual(policies.terms.sections);

    const empty = resolvePolicyPageView(policies.terms, { title: "Published title", body: [], updatedAtIso: null });
    expect(empty.managed).toBe(false);
    expect(empty.title).toBe(policies.terms.title);
    expect(empty.sections).toEqual(policies.terms.sections);
  });
});

describe("policy pages managed override", () => {
  it("renders the published managed page when one is published", async () => {
    mocks.loadServerPublicPageBody.mockResolvedValue({
      title: "Privacy notice",
      body: ["Managed collection statement."],
      updatedAtIso: "2026-08-10T06:00:00.000Z",
    });

    render(await PrivacyPolicyPage());

    expect(mocks.loadServerPublicPageBody).toHaveBeenCalledWith("policy-privacy");
    expect(screen.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeInTheDocument();
    expect(screen.getByText("Managed collection statement.")).toBeInTheDocument();
    expect(screen.getByText("Updated 10 August 2026")).toBeInTheDocument();
    expect(screen.queryByText("How information is used")).not.toBeInTheDocument();
  });

  it("keeps the fallback text when the managed read fails", async () => {
    mocks.loadServerPublicPageBody.mockRejectedValue(new Error("offline"));

    render(await PrivacyPolicyPage());

    expect(screen.getByRole("heading", { level: 1, name: policies.privacy.title })).toBeInTheDocument();
    expect(screen.getByText("How information is used")).toBeInTheDocument();
  });

  it("does not read managed pages in demo mode", async () => {
    mocks.dataAdapter.mockReturnValue("demo");

    render(await PrivacyPolicyPage());

    expect(mocks.loadServerPublicPageBody).not.toHaveBeenCalled();
    expect(screen.getByText("How information is used")).toBeInTheDocument();
  });

  it("renders the terms fallback without an internal demo-marker heading", async () => {
    mocks.loadServerPublicPageBody.mockResolvedValue(null);

    render(await TermsPolicyPage());

    expect(screen.getByText("Accuracy of information")).toBeInTheDocument();
    expect(screen.queryByText("Demo content")).not.toBeInTheDocument();
  });
});

describe("disclosure managed override", () => {
  it("renders managed items, links, and only the stated verification status", async () => {
    mocks.loadServerPublicPageBody.mockResolvedValue({
      title: "Mandatory public disclosure",
      body: [
        "Affiliation · 2026-01-P-03",
        "School code · Pending verification",
        "Fee schedule · Fees & refunds policy · /policies/fees-and-refunds",
        "Annual report · DOC-2026-0042",
      ],
      updatedAtIso: "2026-08-10T06:00:00.000Z",
    });

    render(await DisclosurePage());

    expect(mocks.loadServerPublicPageBody).toHaveBeenCalledWith("disclosure");
    expect(screen.getByRole("heading", { level: 1, name: "Mandatory public disclosure" })).toBeInTheDocument();
    expect(screen.getByText("Updated 10 August 2026")).toBeInTheDocument();
    expect(screen.getByText("2026-01-P-03")).toBeInTheDocument();
    expect(screen.getAllByText("Pending verification")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Fees & refunds policy/ })).toHaveAttribute(
      "href",
      "/policies/fees-and-refunds",
    );
    expect(screen.getByRole("link", { name: /Annual report/ })).toHaveAttribute("href", "/api/documents/DOC-2026-0042");
    expect(screen.queryByText("Safety certificates")).not.toBeInTheDocument();
  });

  it("keeps the fallback disclosure array when no managed page is published or the read fails", async () => {
    mocks.loadServerPublicPageBody.mockResolvedValue(null);
    render(await DisclosurePage());

    expect(screen.getByText("Affiliation")).toBeInTheDocument();
    expect(screen.getByText("Safety certificates")).toBeInTheDocument();
    expect(screen.getAllByText("Pending verification").length).toBeGreaterThan(0);

    mocks.loadServerPublicPageBody.mockRejectedValue(new Error("offline"));
    render(await DisclosurePage());

    expect(screen.getAllByText("Safety certificates").length).toBeGreaterThan(0);
  });

  it("does not fabricate a status when a managed item states none", async () => {
    mocks.loadServerPublicPageBody.mockResolvedValue({
      title: "Mandatory public disclosure",
      body: ["Affiliation · 2026-01-P-03"],
      updatedAtIso: null,
    });

    render(await DisclosurePage());

    expect(screen.getByText("2026-01-P-03")).toBeInTheDocument();
    expect(screen.queryByText("Pending verification")).not.toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });
});
