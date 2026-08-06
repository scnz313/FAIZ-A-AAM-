import type { Metadata } from "next";

/* Applicant journeys carry private application data (identity, contact,
   documents). Indexing protection only — real authentication arrives with
   the backend. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
