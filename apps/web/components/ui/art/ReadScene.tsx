/**
 * ReadScene — a child sitting under a large chinar tree reading an open
 * book. Sun disc and faint mountains behind, leaf litter and a few
 * falling leaves at the foot of the tree. Flat editorial print style.
 */

import { useId } from "react";

import { CHINAR_PATH } from "../ChinarMark";
import { Scene } from "./Scene";

const INK = "#0b1c2a";
const INK_SOFT = "#5a6670";
const PAPER = "#f4efe5";
const CHALK = "#fffdf8";
const WILLOW = "#536d57";
const WILLOW_DEEP = "#3f5644";
const SAFFRON = "#b96832";
const SAFFRON_DEEP = "#8c4a1e";

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

const LITTER = [
  { x: 330, y: 452, a: 40, s: 0.24, fill: WILLOW },
  { x: 352, y: 458, a: -60, s: 0.2, fill: SAFFRON_DEEP },
  { x: 262, y: 456, a: 110, s: 0.22, fill: WILLOW },
  { x: 285, y: 462, a: -20, s: 0.18, fill: SAFFRON_DEEP },
  { x: 375, y: 460, a: 160, s: 0.16, fill: WILLOW },
] as const;

const FALLING = [
  { x: 196, y: 330, a: 30, s: 0.3, fill: WILLOW },
  { x: 238, y: 398, a: -50, s: 0.26, fill: SAFFRON_DEEP },
] as const;

const TUFTS = [
  { x: 170, y: 462 },
  { x: 420, y: 460 },
  { x: 520, y: 463 },
  { x: 640, y: 458 },
] as const;

export type ReadSceneProps = { className?: string; ariaHidden?: boolean };

export function ReadScene({ className, ariaHidden }: ReadSceneProps) {
  const leafId = useId();

  return (
    <Scene
      viewBox="0 0 800 500"
      width={800}
      height={500}
      ariaLabel="Illustration: a child reading an open book under a chinar tree"
      ariaHidden={ariaHidden}
      className={className}
    >
      {/* Sky, sun, faint mountains */}
      <rect x="0" y="0" width="800" height="462" fill={PAPER} />
      <circle cx="650" cy="105" r="46" fill={SAFFRON} />
      <path
        d="M 0 235 L 90 195 L 180 225 L 300 190 L 430 228 L 560 196 L 700 222 L 800 205 L 800 235 L 0 235 Z"
        fill={INK_SOFT}
      />

      {/* Ground rule */}
      <path d="M 0 462 H 800" stroke={INK} strokeWidth="1" />

      {/* Big chinar and a sapling on the right */}
      <Tree x={260} y={462} scale={1.6} />
      <Tree x={700} y={458} scale={0.5} />

      {/* Child sitting cross-legged, reading an open book */}
      <g transform="translate(300 448) scale(1.15)">
        <circle cx="10" cy="-30" r="5" fill={INK} />
        <path d="M 3 -24 Q 10 -28 17 -24 L 18 -12 L 4 -12 Z" fill={INK} />
        <path d="M 16 -12 L 26 -6 L 23 -2.5 L 13 -7.5 Z" fill={INK} />
        <path d="M 4 -12 L -5 -6 L -3 -2.5 L 6 -7.5 Z" fill={INK} />
        <path
          d="M 5 -22 L 9 -14 M 15 -22 L 12 -14"
          stroke={INK}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M 5 -13 L 13 -15.5 L 13 -6 L 5 -3.5 Z" fill={CHALK} />
        <path d="M 13 -15.5 L 21 -13 L 21 -3.5 L 13 -6 Z" fill={CHALK} />
        <path d="M 13 -15.5 L 13 -6" stroke={INK} strokeWidth="1" />
      </g>

      {/* Leaf litter and falling leaves */}
      <defs>
        <path id={leafId} d={CHINAR_PATH} />
      </defs>
      {LITTER.map(({ x, y, a, s, fill }) => (
        <use
          key={`${x}-${y}`}
          href={`#${leafId}`}
          transform={`translate(${x} ${y}) rotate(${a}) scale(${s}) translate(-16 -22.8)`}
          fill={fill}
        />
      ))}
      {FALLING.map(({ x, y, a, s, fill }) => (
        <use
          key={`${x}-${y}`}
          href={`#${leafId}`}
          transform={`translate(${x} ${y}) rotate(${a}) scale(${s}) translate(-16 -22.8)`}
          fill={fill}
        />
      ))}

      {/* Grass tufts */}
      {TUFTS.map(({ x, y }) => (
        <path
          key={`${x}-${y}`}
          d={TUFT_PATH}
          transform={`translate(${x} ${y})`}
          fill="none"
          stroke={INK}
          strokeWidth="1.2"
        />
      ))}
    </Scene>
  );
}

export default ReadScene;
