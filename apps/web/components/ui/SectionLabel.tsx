import type { ReactNode } from "react";

type SectionLabelProps = {
  /** Optional sequence number, rendered as an "01 · " prefix. */
  index?: string;
  children: ReactNode;
};

/** 11px small-caps section label. */
export function SectionLabel({ index, children }: SectionLabelProps) {
  return <p className="section-label">{index ? `${index} · ` : ""}{children}</p>;
}
