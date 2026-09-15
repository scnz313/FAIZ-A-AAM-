"use client";

import { useEffect } from "react";
import Link from "next/link";

import Button from "@/components/ui/Button";
import { ErrorPanel } from "@/components/ui/AsyncStates";

/**
 * Portal-scoped error boundary: keeps the family shell (sidebar, child
 * context, notifications) intact and gives every portal surface a
 * recoverable next step instead of the root error page. No stack traces or
 * private values are shown; the failure is logged for developers only.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <h1>This page could not be loaded</h1>
          <p className="ph-sub">Your family records were not changed. Retry the page, or return to the overview.</p>
        </div>
      </div>
      <ErrorPanel
        title="Something went wrong while loading the portal"
        note="The service did not respond. The last saved records are untouched."
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="quiet" type="button" onClick={reset}>
            Try again
          </Button>
          <Link className="link-arrow" href="/portal">
            Back to overview →
          </Link>
        </div>
      </ErrorPanel>
    </div>
  );
}
