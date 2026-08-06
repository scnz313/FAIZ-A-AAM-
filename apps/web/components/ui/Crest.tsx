import { useId, type CSSProperties } from "react";

import { CHINAR_PATH } from "./ChinarMark";

type CrestSize = "sm" | "md" | "lg";
type CrestTone = "ink" | "chalk";

type CrestProps = {
  /** sm 40px, md 56px, lg 72px. */
  size?: CrestSize;
  /** ink = ink field with chalk marks (on paper grounds); chalk = for ink grounds. */
  tone?: CrestTone;
  className?: string;
};

const CREST_PX: Record<CrestSize, number> = { sm: 40, md: 56, lg: 72 };

const INK = "#0b1c2a";
const CHALK = "#fffdf8";

/* All geometry is drawn in a 72-unit viewBox so the same paths stay
   crisp at 40px and elegant at 72px. */

/** Mughal ogee-arch shield — the Islamic-school identity mark: straight
   sides rising into an ogee point, echoing the arches of the valley's
   Mughal buildings. */
const SHIELD_PATH =
  "M 10 52 V 24 Q 10 12 22 10.6 Q 30 9.6 34.4 5.4 Q 36 3.2 36 3.2 Q 37.6 5.4 42 9.6 Q 50 10.6 62 12 V 24 V 52 Z";

/** 1px inner rule following the arch, inset ~3 units (scaled about the
   arch centre so the ogee profile is preserved). */
const SHIELD_RULE_PATH = SHIELD_PATH;
const SHIELD_RULE_TRANSFORM = "translate(3.4 2.6) scale(0.92)";

/** Diyā — lamp flame above a small cup (the light of learning). */
const FLAME_PATH = "M 36 9.6 C 37.8 12.1 38.8 13.5 38.8 15 C 38.8 16.6 37.5 17.6 36 17.6 C 34.5 17.6 33.2 16.6 33.2 15 C 33.2 13.5 34.2 12.1 36 9.6 Z";
const FLAME_CORE_PATH = "M 36 12.5 C 36.8 13.6 37.1 14.3 37.1 14.9 C 37.1 15.6 36.6 16 36 16 C 35.4 16 34.9 15.6 34.9 14.9 C 34.9 14.3 35.2 13.6 36 12.5 Z";
const CUP_PATH = "M 31.8 18 L 40.2 18 L 38.2 20.1 Q 36 21.2 33.8 20.1 Z";

/** Open book — two page halves meeting at a spine. */
const BOOK_LEFT_PATH = "M 36 21.6 Q 30.6 20.7 25.7 23 L 25.7 31.6 Q 30.6 29.3 36 30.2 Z";
const BOOK_RIGHT_PATH = "M 36 21.6 Q 41.4 20.7 46.3 23 L 46.3 31.6 Q 41.4 29.3 36 30.2 Z";
const BOOK_SPINE_PATH = "M 36 21.6 L 36 30.2";

/** Bottom band with the serif monogram. */
const BAND_PATH = "M 15.8 46.2 H 56.2 V 49.8 Q 56.2 51.2 54.8 51.2 H 17.2 Q 15.8 51.2 15.8 49.8 Z";

/** CHINAR_PATH (32x40 space) mapped into the crest: tip at (36, 33.6), scale 0.61. */
const LEAF_TRANSFORM = "translate(36 33.6) scale(0.61) translate(-16 -3)";

/**
 * School crest — hand-drawn Mughal ogee-arch shield with the lamp
 * flame, open book, chinar leaf and "FA" band. Concept artwork: the
 * official school crest is pending verification and this mark will be
 * replaced when the verified identity assets arrive. Decorative — the
 * accessible name always comes from the surrounding link/heading.
 */
export function Crest({ size = "md", tone = "ink", className }: CrestProps) {
  const px = CREST_PX[size];
  const leafId = useId();
  const sm = size === "sm";
  const field = tone === "ink" ? INK : CHALK;
  const mark = tone === "ink" ? CHALK : INK;

  const style: CSSProperties = {
    width: px,
    height: px,
    // The .crest class paints an ink field; chalk-tone crests stand on
    // ink grounds and must not carry their own background.
    ...(tone === "chalk" ? { background: "transparent" } : null),
  };

  return (
    <span
      className={`crest crest--${size}${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden="true"
    >
      <svg viewBox="0 0 72 72" width="100%" height="100%" role="presentation" focusable="false">
        <path d={SHIELD_PATH} fill={field} />
        <path d={SHIELD_RULE_PATH} transform={SHIELD_RULE_TRANSFORM} fill="none" stroke={mark} strokeWidth={sm ? 1.5 : 1} />

        <path d={FLAME_PATH} fill={mark} />
        {/* The core cutout is sub-pixel at 40px; the solid flame reads better. */}
        {sm ? null : <path d={FLAME_CORE_PATH} fill={field} />}
        <path d={CUP_PATH} fill={mark} />

        <path d={BOOK_LEFT_PATH} fill={mark} />
        <path d={BOOK_RIGHT_PATH} fill={mark} />
        <path d={BOOK_SPINE_PATH} fill="none" stroke={field} strokeWidth={sm ? 1.5 : 1} />

        <defs>
          {/* useId keeps the id unique per instance — header, footer and
              wallboard each mount their own copy. */}
          <path id={leafId} d={CHINAR_PATH} />
        </defs>
        <use href={`#${leafId}`} transform={LEAF_TRANSFORM} fill={mark} />

        <path d={BAND_PATH} fill={mark} />
        <text
          x="36"
          y={sm ? 50.4 : 50.35}
          textAnchor="middle"
          fontFamily="var(--font-display), Georgia, 'Times New Roman', serif"
          fontSize={sm ? 6.2 : 5.7}
          fontWeight="600"
          letterSpacing="0.5"
          fill={field}
        >
          FA
        </text>
      </svg>
    </span>
  );
}

export default Crest;
