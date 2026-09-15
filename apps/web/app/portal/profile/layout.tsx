import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Profile · Portal",
  description: "Guardian identity, linked children and enrolment references for the family portal.",
};

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return children;
}
