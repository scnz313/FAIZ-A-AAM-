/**
 * Staff loading skeleton — ruled placeholder panels while the dashboard
 * segment streams in. Static placeholders only (no animation), so the
 * switch from skeleton to content causes no layout shift.
 */
export default function Loading() {
  return (
    <div className="loading-shell" aria-busy="true">
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div className="panel">
        <span className="skeleton-rule" aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "70%" }} aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "88%" }} aria-hidden="true" />
      </div>
      <div className="panel">
        <span className="skeleton-rule" aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "60%" }} aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "78%" }} aria-hidden="true" />
      </div>
      <div className="panel">
        <span className="skeleton-rule" aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "84%" }} aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "48%" }} aria-hidden="true" />
      </div>
    </div>
  );
}
