import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Teaching records",
  description: "Non-login teacher records with their class and subject assignments.",
};

export default function TeachingRecordsLayout({ children }: { children: ReactNode }) {
  return children;
}
