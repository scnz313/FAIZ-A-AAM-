"use client";

import { useRouter } from "next/navigation";

/**
 * Retry control for server-rendered error panels: re-runs the route's
 * loaders (the same idempotent read, never a new mutation).
 */
export default function RetryButton({
  label = "Try again",
  className = "btn btn-ghost btn-sm",
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button type="button" className={className} onClick={() => router.refresh()}>
      {label}
    </button>
  );
}
