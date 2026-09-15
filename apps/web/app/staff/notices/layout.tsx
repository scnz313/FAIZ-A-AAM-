import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Notices · Staff",
  description: "Draft, review, schedule and publish school notices.",
};

export default function StaffNoticesLayout({ children }: { children: ReactNode }) {
  return children;
}
