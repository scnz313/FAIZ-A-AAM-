"use client";

import { useEffect } from "react";

/**
 * Root error boundary — calm, editorial recovery state. No stack traces are
 * shown; the failure is logged to the console for developers and the user
 * gets two recoverable paths: retry the render, or return to the school
 * site. Reuses the .not-found centered state layout. The root layout
 * already provides <html>/<body>, so this boundary renders only its state.
 */
export default function ErrorComponent({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Keep the failure observable without exposing it on screen; log in an
  // effect so nothing runs during render.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="not-found" role="alert">
      <p className="eyebrow">Error</p>
      <h1>Something went wrong</h1>
      <p>The page hit an unexpected error. Your data is safe — try again, or return home.</p>
      <div className="state-actions">
        <button type="button" className="button button--primary" onClick={() => reset()}>
          Try again
        </button>
        <a className="link-arrow" href="/">
          Back to the school site →
        </a>
      </div>
    </div>
  );
}
