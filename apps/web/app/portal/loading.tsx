/**
 * Portal loading skeleton — ruled placeholder panels while the overview
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
        <span className="skeleton-bar" style={{ width: "64%" }} aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "86%" }} aria-hidden="true" />
      </div>
      <div className="panel">
        <span className="skeleton-rule" aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "74%" }} aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "52%" }} aria-hidden="true" />
      </div>
      <div className="panel">
        <span className="skeleton-rule" aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "82%" }} aria-hidden="true" />
        <span className="skeleton-bar" style={{ width: "44%" }} aria-hidden="true" />
      </div>
    </div>
  );
}
