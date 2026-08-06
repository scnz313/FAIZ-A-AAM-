import type { Metadata } from "next";

import JobStatusView from "./JobStatusView";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Application ${slug}`,
    robots: { index: false, follow: false },
  };
}

/**
 * Server entry for the vacancy application status route. The record is
 * read through the demo-session store, so the status view is a client
 * component (JobStatusView) that fetches on mount; this page keeps the
 * server-only metadata (including noindex for application data).
 */
export default function ApplicationStatusPage() {
  return <JobStatusView />;
}
