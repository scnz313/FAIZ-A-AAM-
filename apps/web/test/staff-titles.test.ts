import { describe, expect, it } from "vitest";

import { metadata as teachingRecordsMetadata } from "@/app/staff/academics/teachers/layout";
import { metadata as staffContentMetadata } from "@/app/staff/content/layout";
import { metadata as staffNoticesMetadata } from "@/app/staff/notices/layout";
import { metadata as staffSupportMetadata } from "@/app/staff/support/layout";

describe("staff route titles", () => {
  it("titles the principal workspaces in the staff pattern", () => {
    expect(teachingRecordsMetadata.title).toBe("Teaching records · Staff");
    expect(staffNoticesMetadata.title).toBe("Notices · Staff");
    expect(staffContentMetadata.title).toBe("Content · Staff");
    expect(staffSupportMetadata.title).toBe("Support · Staff");
  });

  it("describes each route for search and assistive technology", () => {
    expect(teachingRecordsMetadata.description).toMatch(/teacher records/i);
    expect(staffNoticesMetadata.description).toMatch(/notices/i);
    expect(staffContentMetadata.description).toMatch(/content|pages/i);
    expect(staffSupportMetadata.description).toMatch(/concerns/i);
  });
});
