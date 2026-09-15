import type { Metadata } from "next";

export const metadata: Metadata = {
  /* The object form keeps the site suffix on child notice titles; a plain
     string here would resolve the segment title absolutely. */
  title: { default: "Notices", template: "%s · Faiz Aam Secondary School" },
  alternates: { canonical: "/notices" },
};

export default function NoticesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
