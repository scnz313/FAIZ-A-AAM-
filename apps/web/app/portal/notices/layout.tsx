import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Notices · Portal",
  description: "Published school and class notices for the linked family in the guardian portal.",
};

export default function NoticesLayout({ children }: { children: ReactNode }) {
  return children;
}
