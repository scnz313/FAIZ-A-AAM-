import type { Metadata } from "next";

import SchoolSetupWorkspace from "./SchoolSetupWorkspace";

export const metadata: Metadata = {
  title: "School setup · Staff",
};

export default function SchoolPage() {
  return <SchoolSetupWorkspace />;
}
