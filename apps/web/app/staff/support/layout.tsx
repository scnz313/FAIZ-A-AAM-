import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Support · Staff",
  description: "Parent and applicant concerns with staff responses and status.",
};

export default function StaffSupportLayout({ children }: { children: ReactNode }) {
  return children;
}
