import type { Metadata } from "next";

/* Public applicant surfaces (the job application) live under /apply and must
   never require an account. The authenticated applicant journey keeps its own
   guard in /apply/student/layout.tsx. Indexing protection only here. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
