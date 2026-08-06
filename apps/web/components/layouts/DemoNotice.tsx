import type { ReactNode } from "react";

type DemoNoticeProps = {
  /** Optional note text rendered beside the badge (wraps; never inside it). */
  children?: ReactNode;
  className?: string;
};

/**
 * Demo-data marker: a short dashed badge, with any longer note rendered
 * as separate wrapping text so narrow screens never blow out.
 */
export function DemoNotice({ children, className }: DemoNoticeProps) {
  return (
    <span className={className ?? ""}>
      <span className="demo-badge">Demo data</span>
      {children ? <span className="demo-notice-text">{children}</span> : null}
    </span>
  );
}

export default DemoNotice;
