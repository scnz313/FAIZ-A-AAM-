import type { ReactNode } from "react";

type DemoNoticeProps = {
  children?: ReactNode;
  className?: string;
};

/**
 * Demo-data marker — returns null in the production interface. Demo data
 * remains available to tests through the service layer; the UI presents
 * as a clean production surface with no demo indicators.
 */
export function DemoNotice(_props: DemoNoticeProps) {
  return null;
}

export default DemoNotice;
