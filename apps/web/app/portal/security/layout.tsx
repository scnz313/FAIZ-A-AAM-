import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Security · Portal",
  description: "Sessions, devices and sign-in methods for the guardian portal account.",
};

export default function SecurityLayout({ children }: { children: ReactNode }) {
  return children;
}
