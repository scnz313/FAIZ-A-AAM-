import { notFound } from "next/navigation";

/**
 * Catch-all for unmatched /portal/* addresses. Rendering this page makes the
 * portal layout (and `portal/not-found.tsx`) apply, so an unknown portal URL
 * keeps the family shell instead of the bare public 404.
 */
export default function PortalMissingPath() {
  notFound();
}
