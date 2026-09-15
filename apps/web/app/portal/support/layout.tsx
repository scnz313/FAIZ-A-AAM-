import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Support · Portal",
  description: "Grievance submission and reference tracking for the guardian portal.",
};

export default function SupportLayout({ children }: { children: ReactNode }) {
  return children;
}
