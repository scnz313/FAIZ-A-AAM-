/**
 * CampusScene — the school building front in flat editorial print style:
 * central block with gabled roof and crest, two flanking wings, veranda
 * columns, chinar trees on both sides, a gravel path, faint mountains
 * and a lamp post.
 */

import { useId } from "react";

import { CHINAR_PATH } from "../ChinarMark";
import { Scene } from "./Scene";

const INK = "#0b1c2a";
const INK_SOFT = "#5a6670";
const PAPER = "#f4efe5";
const PAPER_DEEP = "#ece4d3";
const CHALK = "#fffdf8";
const WILLOW = "#536d57";
const WILLOW_DEEP = "#3f5644";
const SAFFRON = "#b96832";

/** Simple double-arc bird stroke. */
const BIRD_PATH = "M 0 0 Q 6 4 12 0 Q 18 4 24 0";

/** Short grass tuft stroke, anchored at its base. */
const TUFT_PATH = "M 0 0 Q 3 -7 1 -12 M 0 0 Q 0 -9 4 -11 M 0 0 Q -3 -6 -2 -10";

/** Crown ring for a chinar tree — eight leaves pointing outward. */
const RING = [
  { a: -180, deep: true },
  { a: -135, deep: true },
  { a: -90, deep: false },
  { a: -45, deep: false },
  { a: 0, deep: false },
  { a: 45, deep: false },
  { a: 90, deep: false },
  { a: 135, deep: false },
] as const;

type TreeProps = { x: number; y: number; scale: number };

/** Chinar tree — ink trunk, deep-willow crown mass, leaf ring + centre leaf. */
function Tree({ x, y, scale }: TreeProps) {
  const leafId = useId();
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <defs>
        <path id={leafId} d={CHINAR_PATH} />
      </defs>
      <path d="M -4.6 0 L 4.6 0 L 3 -62 L 1 -96 L -1 -96 L -3 -62 Z" fill={INK} />
      <circle cx="0" cy="-96" r="38" fill={WILLOW_DEEP} />
      {RING.map(({ a, deep }) => (
        <use
          key={a}
          href={`#${leafId}`}
          transform={`rotate(${a}) translate(0 -34) scale(0.62) translate(-16 -22.8)`}
          fill={deep ? WILLOW_DEEP : WILLOW}
        />
      ))}
      <use
        href={`#${leafId}`}
        transform="rotate(180) scale(0.5) translate(-16 -22.8)"
        fill={WILLOW}
      />
    </g>
  );
}

const COLUMNS = [318, 350, 382, 418, 450, 482] as const;

const WINDOWS = [
  { x: 190, y: 305 },
  { x: 240, y: 305 },
  { x: 190, y: 365 },
  { x: 240, y: 365 },
  { x: 510, y: 305 },
  { x: 560, y: 305 },
  { x: 510, y: 365 },
  { x: 560, y: 365 },
] as const;

const GRAVEL = [
  { x: 400, y: 440 },
  { x: 422, y: 452 },
  { x: 384, y: 468 },
  { x: 416, y: 482 },
  { x: 438, y: 486 },
  { x: 398, y: 496 },
] as const;

const TUFTS = [
  { x: 120, y: 448 },
  { x: 170, y: 462 },
  { x: 620, y: 462 },
  { x: 700, y: 450 },
] as const;

const BIRDS = [
  { x: 420, y: 90, s: 0.55 },
  { x: 455, y: 112, s: 0.45 },
] as const;

export type CampusSceneProps = { className?: string; ariaHidden?: boolean };

export function CampusScene({ className, ariaHidden }: CampusSceneProps) {
  const crestLeafId = useId();

  return (
    <Scene
      viewBox="0 0 800 500"
      width={800}
      height={500}
      ariaLabel="Illustration: the school building with two wings, chinar trees and a gravel path"
      ariaHidden={ariaHidden}
      className={className}
    >
      {/* Sky and faint mountains */}
      <rect x="0" y="0" width="800" height="215" fill={PAPER} />
      <path
        d="M 0 200 L 130 140 L 260 190 L 400 120 L 540 185 L 690 135 L 800 175 L 800 215 L 0 215 Z"
        fill={INK_SOFT}
      />

      {/* Ground */}
      <rect x="0" y="415" width="800" height="85" fill={PAPER} />
      <path d="M 150 415 H 650" stroke={INK} strokeWidth="1.5" />

      {/* Building — gables, wings, joints */}
      <path d="M 286 232 L 400 168 L 514 232 Z" fill={INK} />
      <path d="M 176 277 L 235 240 L 294 277 Z" fill={INK} />
      <path d="M 506 277 L 565 240 L 624 277 Z" fill={INK} />
      <rect x="300" y="232" width="200" height="183" fill={CHALK} />
      <rect x="170" y="277" width="130" height="138" fill={CHALK} />
      <rect x="500" y="277" width="130" height="138" fill={CHALK} />
      <path d="M 300 232 V 415 M 500 232 V 415" stroke={INK} strokeWidth="1" />

      {/* Crest above the entrance */}
      <rect x="387" y="262" width="26" height="26" fill={CHALK} stroke={INK} strokeWidth="1.2" />
      <defs>
        <path id={crestLeafId} d={CHINAR_PATH} />
      </defs>
      <use
        href={`#${crestLeafId}`}
        transform="translate(400 275) scale(0.4) translate(-16 -12)"
        fill={INK}
      />

      {/* Veranda recess, lintel and columns */}
      <rect x="308" y="330" width="184" height="85" fill={PAPER_DEEP} />
      <path d="M 308 330 H 492" stroke={INK} strokeWidth="1.5" />
      {COLUMNS.map((x) => (
        <g key={x}>
          <rect x={x - 2} y="330" width="11" height="5" fill={CHALK} stroke={INK} strokeWidth="1" />
          <rect x={x} y="330" width="7" height="85" fill={CHALK} stroke={INK} strokeWidth="1" />
        </g>
      ))}

      {/* Entrance */}
      <path
        d="M 380 415 L 380 370 Q 380 352 400 352 Q 420 352 420 370 L 420 415 Z"
        fill={INK}
      />

      {/* Wing window grids */}
      {WINDOWS.map(({ x, y }) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="34" height="40" fill={CHALK} stroke={INK} strokeWidth="1" />
          <path
            d={`M ${x} ${y + 20} H ${x + 34} M ${x + 17} ${y} V ${y + 40}`}
            stroke={INK}
            strokeWidth="1"
          />
        </g>
      ))}

      {/* Gravel path and stones */}
      <path d="M 380 415 L 420 415 L 470 500 L 330 500 Z" fill={PAPER_DEEP} />
      {GRAVEL.map(({ x, y }) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill={INK} />
      ))}

      {/* Chinar trees */}
      <Tree x={110} y={445} scale={1.35} />
      <Tree x={690} y={448} scale={1.05} />

      {/* Lamp post */}
      <path d="M 648 415 L 648 330" stroke={INK} strokeWidth="2" />
      <path d="M 641 415 L 655 415 L 653 421 L 643 421 Z" fill={INK} />
      <rect x="640" y="322" width="16" height="16" rx="2" fill={CHALK} stroke={INK} strokeWidth="1.5" />
      <circle cx="648" cy="330" r="2.5" fill={SAFFRON} />
      <path d="M 648 322 V 315" stroke={INK} strokeWidth="1.5" />

      {/* Grass tufts and birds */}
      {TUFTS.map(({ x, y }) => (
        <path key={`${x}-${y}`} d={TUFT_PATH} transform={`translate(${x} ${y})`} fill="none" stroke={INK} strokeWidth="1.2" />
      ))}
      {BIRDS.map(({ x, y, s }) => (
        <path
          key={`${x}-${y}`}
          d={BIRD_PATH}
          transform={`translate(${x} ${y}) scale(${s})`}
          fill="none"
          stroke={INK}
          strokeWidth="1.5"
        />
      ))}
    </Scene>
  );
}

export default CampusScene;
