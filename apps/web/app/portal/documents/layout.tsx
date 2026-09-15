import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Documents · Portal",
  description: "Report cards, receipts and private documents for the linked student.",
};

export default function DocumentsLayout({ children }: { children: ReactNode }) {
  return children;
}
