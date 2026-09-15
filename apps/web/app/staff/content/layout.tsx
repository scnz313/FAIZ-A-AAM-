import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Content · Staff",
  description: "Public pages and notice publishing states with review status.",
};

export default function StaffContentLayout({ children }: { children: ReactNode }) {
  return children;
}
