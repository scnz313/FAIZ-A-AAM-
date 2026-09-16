import type { Metadata } from "next";

import { StaffDocumentsWorkspace } from "./StaffDocumentsWorkspace";

export const metadata: Metadata = {
  title: "Documents",
};

export default function StaffDocumentsPage() {
  return <StaffDocumentsWorkspace />;
}
