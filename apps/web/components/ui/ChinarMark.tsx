/**
 * The Faiz E Aam chinar mark — a single 7-lobed chinar leaf
 * (Platanus orientalis) with a tapered petiole, drawn by hand for the
 * design system. It is the Kashmiri signature mark of the school
 * identity. The leaf silhouette is exported as CHINAR_PATH so the crest
 * and the favicon reuse the exact same geometry.
 */

/** Leaf silhouette in mark space (viewBox 0 0 32 40). No stem. */
export const CHINAR_PATH = [
  "M 16 3.0",
  "C 15.4 5.2 14.5 6.4 13.1 8.9",
  "C 12.5 9.6 11.3 9.4 9.5 7.8",
  "C 8.9 7.1 8.4 8.0 10.2 12.6",
  "C 10.4 13.1 7.7 12.9 5.0 14.1",
  "C 4.3 14.6 7.3 15.6 10.6 17.6",
  "C 11.0 18.0 9.9 18.6 8.6 20.6",
  "C 8.2 21.2 10.8 21.6 13.8 22.4",
  "C 14.4 22.5 14.8 22.6 16.0 22.8",
  "C 17.2 22.6 17.6 22.5 18.2 22.4",
  "C 21.2 21.6 23.8 21.2 23.4 20.6",
  "C 22.1 18.6 21.0 18.0 21.4 17.6",
  "C 24.7 15.6 27.7 14.6 27.0 14.1",
  "C 24.3 12.9 21.6 13.1 21.8 12.6",
  "C 23.6 8.0 23.1 7.1 22.5 7.8",
  "C 20.7 9.4 19.5 9.6 18.9 8.9",
  "C 17.5 6.4 16.6 5.2 16.0 3.0",
  "Z",
].join(" ");

/** Tapered petiole under the leaf, in mark space. */
const CHINAR_STEM_PATH = "M 15.3 23.2 L 15.6 35.4 Q 16 36.6 16.4 35.4 L 16.7 23.2 Z";

const CHINAR_TONE_FILL = {
  ink: "var(--ink)",
  saffron: "var(--saffron)",
  chalk: "var(--chalk)",
} as const;

type ChinarMarkProps = {
  /** Render width/height in px. */
  size?: number;
  tone?: keyof typeof CHINAR_TONE_FILL;
  className?: string;
  /** True: purely decorative (watermarks, list bullets). */
  ariaHidden?: boolean;
};

/**
 * Decorative chinar leaf. Decorative by default — give the surrounding
 * text/link an accessible name, or pass ariaHidden={false} for a
 * standalone labelled image.
 */
export function ChinarMark({
  size = 18,
  tone = "ink",
  className,
  ariaHidden = true,
}: ChinarMarkProps) {
  const accessible = ariaHidden
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": "Chinar leaf" };

  return (
    <svg
      viewBox="0 0 32 40"
      width={size}
      height={size}
      className={className}
      focusable="false"
      {...accessible}
    >
      <path d={CHINAR_PATH} fill={CHINAR_TONE_FILL[tone]} />
      <path d={CHINAR_STEM_PATH} fill={CHINAR_TONE_FILL[tone]} />
    </svg>
  );
}

export default ChinarMark;
