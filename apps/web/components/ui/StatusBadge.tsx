import type { ReactNode } from "react";

export type StatusTone = "good" | "watch" | "alert" | "neutral" | "offline";

type StatusBadgeProps = {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
};

/** Small-caps status chip with a squared tone dot. */
export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${tone}${className ? ` ${className}` : ""}`}>
      <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />
      {children}
    </span>
  );
}
