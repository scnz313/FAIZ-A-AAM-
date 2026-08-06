/**
 * MapScene — illustrated map of Bandipora in flat editorial print style:
 * paper ground, ink roads, the Wular lake as a paper-deep shape with
 * waves, the campus as a square block, the Bandipora marker as a saffron
 * disc holding the chinar mark, a small pier and a compass rose. No
 * labels — text is rendered by the hosting page.
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

/** Small map chinar — ink trunk, deep-willow crown mass, leaf ring. */
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

const LAKE_WAVES = [
  { x: 50, y: 160, s: 0.9 },
  { x: 95, y: 220, s: 0.8 },
  { x: 60, y: 300, s: 0.9 },
  { x: 130, y: 350, s: 0.75 },
] as const;

const TOWN_BLOCKS = [
  { x: 470, y: 296, w: 12, h: 10 },
  { x: 490, y: 312, w: 10, h: 9 },
  { x: 472, y: 326, w: 11, h: 9 },
  { x: 500, y: 292, w: 9, h: 8 },
] as const;

const TREES = [
  { x: 560, y: 208, s: 0.5 },
  { x: 340, y: 200, s: 0.4 },
  { x: 690, y: 340, s: 0.45 },
] as const;

const BIRDS = [
  { x: 600, y: 90, s: 0.5 },
  { x: 640, y: 110, s: 0.4 },
] as const;

export type MapSceneProps = { className?: string; ariaHidden?: boolean };

export function MapScene({ className, ariaHidden }: MapSceneProps) {
  const waveId = useId();
  const markerLeafId = useId();

  return (
    <Scene
      viewBox="0 0 800 500"
      width={800}
      height={500}
      ariaLabel="Illustration: map of Bandipora with the Wular lake, roads and the school campus"
      ariaHidden={ariaHidden}
      className={className}
    >
      {/* Paper ground */}
      <rect x="0" y="0" width="800" height="500" fill={PAPER} />

      {/* Wular lake */}
      <path
        d="M -4 96 C 44 66 118 72 164 114 C 216 162 250 240 238 320 C 226 380 170 402 100 404 C 40 406 -6 388 -4 340 Z"
        fill={PAPER_DEEP}
      />
      <defs>
        <path id={waveId} d="M 0 0 q 6 -3 12 0 q 6 3 12 0" />
      </defs>
      {LAKE_WAVES.map(({ x, y, s }) => (
        <use
          key={`${x}-${y}`}
          href={`#${waveId}`}
          transform={`translate(${x} ${y}) scale(${s})`}
          fill="none"
          stroke={INK_SOFT}
          strokeWidth="1"
        />
      ))}

      {/* Roads */}
      <path
        d="M 806 252 C 690 246 640 254 588 262 L 470 292 C 420 302 390 314 366 336 L 340 362 L 302 392"
        stroke={INK}
        strokeWidth="2.5"
        fill="none"
      />
      <path d="M 620 0 L 620 192" stroke={INK} strokeWidth="1.5" fill="none" />
      <path d="M 620 228 L 620 252" stroke={INK} strokeWidth="1.5" fill="none" />

      {/* Pier into the lake */}
      <path d="M 302 396 L 196 398 L 196 404 L 302 402 Z" fill={CHALK} stroke={INK} strokeWidth="1.5" />

      {/* Bandipora marker — saffron disc holding the chinar */}
      <circle cx="410" cy="320" r="28" fill={SAFFRON} />
      <defs>
        <path id={markerLeafId} d={CHINAR_PATH} />
      </defs>
      <use
        href={`#${markerLeafId}`}
        transform="translate(410 320) scale(0.6) translate(-16 -13)"
        fill={CHALK}
      />

      {/* Town blocks beside the road */}
      {TOWN_BLOCKS.map(({ x, y, w, h }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} fill={CHALK} stroke={INK} strokeWidth="1" />
      ))}

      {/* Campus block */}
      <rect x="602" y="192" width="36" height="36" fill={CHALK} stroke={INK} strokeWidth="2" />
      <path d="M 608 208 L 620 196 L 632 208 Z" fill={INK} />
      <rect x="610" y="208" width="20" height="16" fill={CHALK} stroke={INK} strokeWidth="1" />
      <rect x="618" y="216" width="4" height="8" fill={INK} />

      {/* Compass rose — circle with four points, no letters */}
      <circle cx="700" cy="84" r="26" fill="none" stroke={INK} strokeWidth="1.5" />
      <path d="M 700 60 L 706.5 84 L 700 108 L 693.5 84 Z" fill={INK} />
      <path d="M 674 84 L 700 77.5 L 726 84 L 700 90.5 Z" fill={INK} />

      {/* Small landmark chinar trees */}
      {TREES.map(({ x, y, s }) => (
        <Tree key={`${x}-${y}`} x={x} y={y} scale={s} />
      ))}

      {/* Birds */}
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

export default MapScene;
