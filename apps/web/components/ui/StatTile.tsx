import Link from "next/link";
import type { ReactNode } from "react";

import { Sparkline, type SparklineTone } from "./Sparkline";

export type StatTileProps = {
  label: string;
  /**
   * undefined → skeleton (still loading), null → honest "Not available",
   * otherwise the formatted headline figure.
   */
  value: string | number | null | undefined;
  secondary?: string | null;
  href?: string;
  spark?: number[];
  sparkTone?: SparklineTone;
  sparkLabel?: string;
};

/** V15 ruled KPI tile: small-caps label, big serif tabular figure, a quiet
 *  secondary line, and an optional sparkline. The whole tile is the link. */
export function StatTile({ label, value, secondary, href, spark, sparkTone = "ink", sparkLabel }: StatTileProps) {
  const figure: ReactNode =
    value === undefined ? (
      <span className="skeleton-bar stat-tile-skeleton" aria-hidden="true" />
    ) : value === null ? (
      <span className="stat-tile-na">Not available</span>
    ) : (
      <span className="stat-tile-value num">{value}</span>
    );

  const body = (
    <>
      <span className="stat-tile-label">{label}</span>
      {figure}
      {spark && spark.length > 1 ? (
        <Sparkline data={spark} tone={sparkTone} ariaLabel={sparkLabel ?? `${label} trend`} width={120} height={30} className="stat-tile-spark" />
      ) : null}
      {secondary ? <span className="stat-tile-secondary">{secondary}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link prefetch={false} href={href} className="stat-tile stat-tile--link">
        {body}
      </Link>
    );
  }
  return <div className="stat-tile">{body}</div>;
}
