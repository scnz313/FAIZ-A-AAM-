/**
 * AssemblyScene — morning assembly: rows of standing children facing a
 * teacher with a book, the school building (gabled roof, flag, windows)
 * behind them and the saffron sun rising above. Flat editorial print
 * style; the rows reuse one child silhouette via <use>.
 */

import { useId } from "react";

import { Scene } from "./Scene";

const INK = "#0b1c2a";
const PAPER = "#f4efe5";
const CHALK = "#fffdf8";
const SAFFRON = "#b96832";

/**
 * One standing child silhouette, feet at the origin, facing left.
 * Referenced through <use> for every row member.
 */
const CHILD_PATH =
  "M 0 -26 Q -6 -30 -12 -26 L -13 -14 L 0 -14 Z M -12 -14 L -14 -3 L -9 -3 L -8 -14 Z M -2 -14 L -3 -3 L 2 -3 L 1 -14 Z";

const ROWS = [
  { y: 396, s: 0.78, count: 13, start: 200 },
  { y: 432, s: 0.9, count: 11, start: 220 },
  { y: 468, s: 1.02, count: 9, start: 240 },
] as const;

export type AssemblySceneProps = { className?: string; ariaHidden?: boolean };

export function AssemblyScene({ className, ariaHidden }: AssemblySceneProps) {
  const childId = useId();

  return (
    <Scene
      viewBox="0 0 800 500"
      width={800}
      height={500}
      ariaLabel="Illustration: morning assembly of children before the school building"
      ariaHidden={ariaHidden}
      className={className}
    >
      {/* Sky and ground — the rule sits at the front row's feet. */}
      <rect x="0" y="0" width="800" height="500" fill={PAPER} />
      <path d="M 0 396 H 800" stroke={INK} strokeWidth="1" />

      {/* Morning sun */}
      <circle cx="640" cy="96" r="46" fill={SAFFRON} />

      {/* School building behind */}
      <path d="M 288 212 L 410 150 L 532 212 Z" fill={INK} />
      <rect x="300" y="212" width="220" height="138" fill={CHALK} />
      <path d="M 410 150 L 410 98" stroke={INK} strokeWidth="1.5" />
      <path d="M 410 98 L 432 106 L 410 114 Z" fill={SAFFRON} />
      <g>
        <rect x="322" y="240" width="36" height="40" fill={CHALK} stroke={INK} strokeWidth="1" />
        <path d="M 322 260 H 358 M 340 240 V 280" stroke={INK} strokeWidth="1" />
      </g>
      <g>
        <rect x="442" y="240" width="36" height="40" fill={CHALK} stroke={INK} strokeWidth="1" />
        <path d="M 442 260 H 478 M 460 240 V 280" stroke={INK} strokeWidth="1" />
      </g>
      <path d="M 390 350 L 390 300 Q 390 286 410 286 Q 430 286 430 300 L 430 350 Z" fill={INK} />

      {/* Teacher, facing the rows, holding a book */}
      <g transform="translate(170 452) scale(1.2)">
        <circle cx="8" cy="-40" r="5" fill={INK} />
        <path d="M 1 -33 Q 8 -37 15 -33 L 16 -20 L 2 -20 Z" fill={INK} />
        <path d="M 15 -20 L 17 -8 L 21 -6 L 20 -3 L 14 -7 L 13 -20 Z" fill={INK} />
        <path d="M 2 -20 L 1 -8 L -2 -6 L -1 -3 L 4 -7 L 5 -20 Z" fill={INK} />
        <rect x="17" y="-28" width="8" height="6" fill={CHALK} />
      </g>

      {/* Rows of children — one silhouette, reused */}
      <defs>
        <g id={childId} fill={INK}>
          <circle cx="-7" cy="-33" r="4.4" />
          <path d={CHILD_PATH} />
        </g>
      </defs>
      {ROWS.map((row) =>
        Array.from({ length: row.count }, (_, i) => {
          const x = row.start + i * 40;
          return (
            <use
              key={`${row.y}-${x}`}
              href={`#${childId}`}
              transform={`translate(${x} ${row.y}) scale(${row.s})`}
            />
          );
        }),
      )}
    </Scene>
  );
}

export default AssemblyScene;
