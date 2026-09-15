type CrestSize = "xs" | "sm" | "md" | "lg";
type CrestTone = "ink" | "chalk";

type CrestProps = {
  /** xs 26px (ctx-bar), sm 40px (auth/applicant), md 46px (header), lg 52px (footer). */
  size?: CrestSize;
  /** ink = colour emblem on paper grounds; chalk = paper-line emblem on ink grounds. */
  tone?: CrestTone;
  className?: string;
};

/** V15 emblem palette. The colour emblem is the inherited school mark:
 *  navy star field, gold rules, cream book. Mono variants render all
 *  strokes in a single colour for ink or paper grounds. */
const COLOR_EMBLEM = { field: "#1E3A5F", gold: "#C9A227", cream: "#FAF5EA" } as const;
const MONO_INK = { field: "#0B1C2A", gold: "#0B1C2A", cream: "#F4EFE5" } as const;
const MONO_PAPER = { field: "#F4EFE5", gold: "#F4EFE5", cream: "#0B1C2A" } as const;

/** Eight-pointed star outline — the V15 emblem field (400×400 viewBox). */
const STAR_PATH =
  "M375.5 272.7 L272.7 375.5 L127.3 375.5 L24.5 272.7 L24.5 127.3 L127.3 24.5 L272.7 24.5 L375.5 127.3 Z";

/** Small decorative star (top-right of the emblem, 24-unit space). */
const MINI_STAR_PATH =
  "M219.0,123.5 L220.0,126.6 L223.3,126.6 L220.6,128.5 L221.6,131.6 L219.0,129.7 L216.4,131.6 L217.4,128.5 L214.7,126.6 L218.0,126.6Z";

/**
 * School emblem — V15 eight-pointed star with gold rules, rotated square
 * frame, seal dot, and open book. Inherited brand asset geometry from the
 * V15 prototype; the official school crest remains pending verification.
 * Sizes come exclusively from the .crest--{size} classes (including the
 * ≤479px header shrink) so server and client markup match exactly.
 * Decorative — the accessible name comes from the surrounding link/heading.
 */
export function Crest({ size = "md", tone = "ink", className }: CrestProps) {
  const palette = tone === "chalk" ? MONO_PAPER : COLOR_EMBLEM;
  const mono = tone === "chalk";

  return (
    <span
      className={`crest crest--${size}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 400 400" width="100%" height="100%" role="presentation" focusable="false">
        <path d={STAR_PATH} fill={palette.field} />
        {/* Inner star rule, inset about the centre. */}
        <g transform="translate(200 200) scale(0.93) translate(-200 -200)">
          <path d={STAR_PATH} fill="none" stroke={palette.gold} strokeWidth="5" />
        </g>
        {/* Rotated square frame. */}
        <g fill="none" stroke={palette.gold} strokeWidth="5">
          <path d="M104 82 H296 V274 H104 Z" />
          <path d="M104 82 H296 V274 H104 Z" transform="rotate(45 200 178)" />
        </g>
        {/* Seal dot with offset core. */}
        <circle cx="200" cy="130" r="16" fill={palette.gold} />
        <circle cx="207" cy="125" r="13.5" fill={mono ? palette.cream : palette.field} />
        <path d={MINI_STAR_PATH} fill={palette.gold} />
        {/* Open book. */}
        <path d="M200 218 L144 206 L144 184 L200 194 Z" fill={palette.cream} />
        <path d="M200 218 L256 206 L256 184 L200 194 Z" fill={palette.cream} />
        <line x1="200" y1="194" x2="200" y2="218" stroke={palette.gold} strokeWidth="3" />
        {/* Page detail lines. */}
        <g stroke={mono ? palette.cream : palette.field} strokeWidth="1.5" opacity="0.45">
          <line x1="154" y1="197" x2="190" y2="203" />
          <line x1="155" y1="203" x2="189" y2="209" />
          <line x1="246" y1="197" x2="210" y2="203" />
          <line x1="245" y1="203" x2="211" y2="209" />
        </g>
      </svg>
    </span>
  );
}

export default Crest;
