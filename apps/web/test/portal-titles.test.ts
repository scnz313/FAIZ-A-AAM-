import { describe, expect, it } from "vitest";

import { metadata as documentsMetadata } from "@/app/portal/documents/layout";
import { metadata as noticesMetadata } from "@/app/portal/notices/layout";
import { metadata as supportMetadata } from "@/app/portal/support/layout";

describe("portal route titles", () => {
  it("titles support, documents, and notices in the portal pattern", () => {
    expect(supportMetadata.title).toBe("Support · Portal");
    expect(documentsMetadata.title).toBe("Documents · Portal");
    expect(noticesMetadata.title).toBe("Notices · Portal");
  });

  it("describes each route for search and assistive technology", () => {
    expect(supportMetadata.description).toMatch(/grievance/i);
    expect(documentsMetadata.description).toMatch(/documents/i);
    expect(noticesMetadata.description).toMatch(/notices/i);
  });
});
