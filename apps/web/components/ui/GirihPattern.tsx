import { useId } from "react";

type GirihPatternProps = {
  /** Chalk strokes for ink grounds; ink strokes for paper grounds. */
  tone?: "chalk" | "ink";
  /** 0-1 stroke opacity — keep very low; this is quiet texture. */
  opacity?: number;
  className?: string;
};

/**
 * Islamic girih tessellation — eight-pointed stars joined by crosses,
 * the classical pattern of the region's architecture. Decorative only
 * (aria-hidden); used as a whisper of texture behind hero and footer.
 */
export default function GirihPattern({ tone = "chalk", opacity = 0.05, className }: GirihPatternProps) {
  const id = useId();
  const color = tone === "chalk" ? "#fffdf8" : "#0b1c2a";

  return (
    <svg
      className={className}
      aria-hidden="true"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
    >
      <defs>
        <pattern id={id} width="120" height="120" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={color} strokeWidth="1" opacity={opacity}>
            {/* Eight-pointed star: two rotated squares. */}
            <rect x="46" y="46" width="28" height="28" />
            <rect x="46" y="46" width="28" height="28" transform="rotate(45 60 60)" />
            {/* Crosses joining the stars across the tile. */}
            <path d="M 8 60 H 38 M 82 60 H 112 M 60 8 V 38 M 60 82 V 112" />
            <path d="M 8 8 H 30 M 90 8 H 112 M 8 112 H 30 M 90 112 H 112" opacity={0.6} />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
