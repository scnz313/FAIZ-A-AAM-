import type { Metadata } from "next";

import SchoolSetupWorkspace from "./SchoolSetupWorkspace";

export const metadata: Metadata = {
  title: "School setup",
};

export default function SchoolPage() {
  return <SchoolSetupWorkspace />;
}
