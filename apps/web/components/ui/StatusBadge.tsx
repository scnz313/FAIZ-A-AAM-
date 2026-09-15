import type { ReactNode } from "react";

export type StatusTone = "good" | "watch" | "alert" | "neutral" | "offline" | "warning";

type StatusBadgeProps = {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
};

/** V15 status badge — one dot (rendered by the ::before on .status-badge),
 *  five semantic tones: good (willow), watch (saffron), alert (madder),
 *  neutral (ink tint), warning (amber — V15 addition for stale/conflict). */
export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${tone}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}
