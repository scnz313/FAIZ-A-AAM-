import type { ReactNode } from "react";

/**
 * Shared async states (X1 kit) — V15 canonical, server-safe.
 * Every data surface renders one of: skeleton loading, honest empty,
 * error-with-retry, or content. enforce the pattern instead of inventing
 * per-page variants.
 */

export function LoadingSkeleton({ lines = 4, label = "Loading…" }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">
        <span className="skeleton-rule" />
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className="skeleton-bar"
            style={index === lines - 1 ? { width: "62%" } : undefined}
          />
        ))}
      </span>
    </div>
  );
}

export function EmptyState({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="workspace-state">
      <p className="workspace-state-title">{title}</p>
      {note ? <p className="workspace-state-note">{note}</p> : null}
      {children}
    </div>
  );
}

export function ErrorPanel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="callout bad" role="alert">
      {/* "close" is the subset-approved error glyph (see check:icons). */}
      <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
        close
      </span>
      <div>
        <p className="strong" style={{ margin: 0 }}>
          {title}
        </p>
        {note ? (
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {note}
          </p>
        ) : null}
        {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
      </div>
    </div>
  );
}
