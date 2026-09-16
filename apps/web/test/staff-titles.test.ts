import { beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ headers: headersMock }));

import { metadata as teachingRecordsMetadata } from "@/app/staff/academics/teachers/layout";
import { generateMetadata as generateContentMetadata } from "@/app/staff/content/layout";
import { metadata as staffNoticesMetadata } from "@/app/staff/notices/layout";
import { metadata as staffSupportMetadata } from "@/app/staff/support/layout";
import { staffPortalLabel, staffRouteTitle } from "@/lib/metadata/staff-title";

beforeEach(() => {
  headersMock.mockResolvedValue({ get: () => "/administrator/content" });
});

describe("staff route titles", () => {
  it("keeps child route titles role-neutral for the portal-aware layout", () => {
    expect(teachingRecordsMetadata.title).toBe("Teaching records");
    expect(staffNoticesMetadata.title).toBe("Notices");
    expect(staffSupportMetadata.title).toBe("Support");
  });

  it("builds a portal-aware template for nested Content pages", async () => {
    const metadata = await generateContentMetadata();
    expect(metadata.title).toEqual({
      default: "Content",
      template: "%s · Content · Administrator · Faiz E Aam Secondary School",
    });
    expect(metadata.description).toMatch(/content|pages/i);
  });

  it("derives the canonical portal and missing child titles from the original path", () => {
    expect(staffPortalLabel("/administrator/users")).toBe("Administrator");
    expect(staffPortalLabel("/principal/support")).toBe("Principal");
    expect(staffPortalLabel("/staff/results")).toBe("Staff");
    expect(staffRouteTitle("/administrator")).toBe("Home");
    expect(staffRouteTitle("/administrator/users?status=active")).toBe("Staff access");
    expect(staffRouteTitle("/principal/link-requests")).toBe("Guardian links");
  });

  it("describes each static route for search and assistive technology", () => {
    expect(teachingRecordsMetadata.description).toMatch(/teacher records/i);
    expect(staffNoticesMetadata.description).toMatch(/notices/i);
    expect(staffSupportMetadata.description).toMatch(/concerns/i);
  });
});
