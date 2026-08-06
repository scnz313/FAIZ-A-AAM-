import type { Metadata } from "next";

import { StaffHomeWorkspace } from "@/components/staff/StaffHomeWorkspace";

export const metadata: Metadata = {
  title: "Home · Staff",
};

export default function StaffHomePage() {
  return <StaffHomeWorkspace />;
}
