import Link from "next/link";

/**
 * Portal-level not-found. Rendered inside the family shell (sidebar, child
 * context, notifications) so a mistyped or stale portal address keeps the
 * guardian in the portal with a route back, instead of dropping them onto
 * the public 404 page.
 */
export default function PortalNotFound() {
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <p className="eyebrow">404 · Portal</p>
          <h1>Page not found</h1>
          <p className="ph-sub">
            This address does not match a page in the guardian portal. Your family records are untouched.
          </p>
        </div>
      </div>
      <div className="workspace-state">
        <p className="workspace-state-title">The page you followed could not be found</p>
        <p className="workspace-state-note">
          Check the address, or use the portal navigation to continue.
        </p>
        <Link prefetch={false} className="link-arrow" href="/portal">
          Back to overview →
        </Link>
      </div>
    </div>
  );
}
