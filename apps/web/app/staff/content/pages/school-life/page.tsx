import type { Metadata } from "next";

import SchoolLifePageEditor from "./SchoolLifePageEditor";

export const metadata: Metadata = {
  title: "School life page",
};

export default function SchoolLifePageRoute() {
  return <SchoolLifePageEditor />;
}
