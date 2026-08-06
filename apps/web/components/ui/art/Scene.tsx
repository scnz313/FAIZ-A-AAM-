import type { ReactNode } from "react";

export type ArtSceneProps = {
  className?: string;
  /** viewBox of the artwork, e.g. "0 0 800 520". */
  viewBox: string;
  /** Intrinsic width in px. */
  width: number;
  /** Intrinsic height in px. */
  height: number;
  /** Accessible name for the artwork. */
  ariaLabel: string;
  /** True: purely decorative variant, removed from the accessibility tree. */
  ariaHidden?: boolean;
  children: ReactNode;
};

/**
 * Shared wrapper for all original vector artwork. Server-rendered, flat
 * editorial print style — every scene keeps role="img" and a describing
 * aria-label unless marked decorative.
 */
export function Scene({
  className,
  viewBox,
  width,
  height,
  ariaLabel,
  ariaHidden = false,
  children,
}: ArtSceneProps) {
  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      className={className}
      focusable="false"
      role={ariaHidden ? "presentation" : "img"}
      aria-hidden={ariaHidden || undefined}
      aria-label={ariaHidden ? undefined : ariaLabel}
    >
      {children}
    </svg>
  );
}

export default Scene;
