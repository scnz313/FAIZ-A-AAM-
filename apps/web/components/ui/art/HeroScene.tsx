/**
 * HeroScene — a Bandipora morning in flat editorial print style.
 * Layered mountain ridges with chalk snow caps, a flat saffron sun, the
 * Wular lake band with fine wave lines and a shikara, a shoreline with
 * three chinar trees, the school building (gabled roof, clock, crest,
 * window grid) and children walking to school with books.
 */

import { useId } from "react";

import { CHINAR_PATH } from "../ChinarMark";
import { Scene } from "./Scene";

const INK = "#0b1c2a";
const INK_2 = "#14293b";
const INK_SOFT = "#5a6670";
const PAPER = "#f4efe5";
const PAPER_DEEP = "#ece4d3";
const CHALK = "#fffdf8";
const WILLOW = "#536d57";
const WILLOW_DEEP = "#3f5644";
const SAFFRON = "#b96832";
const SAFFRON_DEEP = "#8c4a1e";

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

const WAVES = [
  { x: 40, y: 348, s: 1.8, tone: INK_SOFT },
  { x: 430, y: 348, s: 1.4, tone: INK_SOFT },
  { x: 95, y: 376, s: 1.5, tone: INK_SOFT },
  { x: 480, y: 376, s: 2.2, tone: INK_SOFT },
  { x: 705, y: 376, s: 1.2, tone: INK_SOFT },
  { x: 30, y: 404, s: 1.4, tone: INK },
  { x: 385, y: 404, s: 1.1, tone: INK },
  { x: 560, y: 404, s: 2.4, tone: INK },
  { x: 205, y: 428, s: 1.7, tone: INK },
  { x: 640, y: 428, s: 1.4, tone: INK },
] as const;

const WINDOWS = [
  { x: 484, y: 392 },
  { x: 532, y: 392 },
  { x: 668, y: 392 },
  /* Clamped so the window (w 34) ends at 730 — the building's right edge. */
  { x: 696, y: 392 },
] as const;

const CHILDREN = [
  { x: 315, y: 486, s: 0.95, book: CHALK },
  { x: 362, y: 483, s: 1.08, book: CHALK },
  { x: 409, y: 487, s: 0.9, book: CHALK },
  { x: 456, y: 484, s: 1.02, book: SAFFRON_DEEP },
] as const;

const BIRDS = [
  { x: 140, y: 64, s: 0.8 },
  { x: 185, y: 90, s: 0.6 },
  { x: 545, y: 50, s: 0.7 },
] as const;

export type HeroSceneProps = { className?: string; ariaHidden?: boolean };

export function HeroScene({ className, ariaHidden }: HeroSceneProps) {
  const waveId = useId();
  const crestLeafId = useId();

  return (
    <Scene
      viewBox="0 0 800 520"
      width={800}
      height={520}
      ariaLabel="Illustration: layered mountain ridges, the Wular lake and the school at dawn"
      ariaHidden={ariaHidden}
      className={className}
    >
      {/* Sky */}
      <rect x="0" y="0" width="800" height="322" fill={PAPER} />
      {/* Sun */}
      <circle cx="620" cy="96" r="56" fill={SAFFRON} />

      {/* Back ridge */}
      <path
        d="M 0 300 L 0 200 L 150 95 L 290 205 L 430 78 L 585 210 L 720 120 L 800 185 L 800 300 Z"
        fill={INK_2}
      />
      <path
        d="M 112 119 L 130 97 L 150 95 L 170 103 L 192 133 L 174 120 L 150 102 L 128 114 Z"
        fill={CHALK}
      />
      <path
        d="M 392 108 L 410 80 L 430 78 L 450 88 L 474 122 L 452 108 L 430 92 L 408 100 Z"
        fill={CHALK}
      />
      <path
        d="M 684 138 L 700 118 L 720 120 L 738 128 L 756 152 L 738 140 L 720 130 L 700 132 Z"
        fill={CHALK}
      />

      {/* Front ridge */}
      <path
        d="M 0 322 L 0 250 L 120 160 L 250 260 L 380 145 L 500 265 L 640 175 L 800 240 L 800 322 Z"
        fill={INK}
      />
      <path
        d="M 84 196 L 102 162 L 120 160 L 140 170 L 162 196 L 144 184 L 120 172 L 100 182 Z"
        fill={CHALK}
      />
      <path
        d="M 342 188 L 360 148 L 380 145 L 400 155 L 424 192 L 404 176 L 380 160 L 360 174 Z"
        fill={CHALK}
      />
      <path
        d="M 600 214 L 622 178 L 640 175 L 660 184 L 686 216 L 666 204 L 640 192 L 618 200 Z"
        fill={CHALK}
      />

      {/* Wular lake band */}
      <rect x="0" y="322" width="800" height="130" fill={PAPER_DEEP} />
      <defs>
        <path id={waveId} d="M 0 0 q 6 -3 12 0 q 6 3 12 0" />
      </defs>
      {/* Fine detail — hidden at small render sizes to avoid visual mud. */}
      <g className="art-detail">
        {WAVES.map(({ x, y, s, tone }) => (
          <use
            key={`${x}-${y}`}
            href={`#${waveId}`}
            transform={`translate(${x} ${y}) scale(${s})`}
            fill="none"
            stroke={tone}
            strokeWidth="1"
          />
        ))}
      </g>

      {/* Shikara */}
      <g transform="translate(350 410)">
        <path
          d="M -52 2 C -40 -7 -12 -10 0 -7 C 12 -10 40 -7 52 2 C 34 9 -34 9 -52 2 Z"
          fill={INK}
        />
        <path
          d="M -17 -6 L -17 -9 Q 0 -32 17 -9 L 17 -6 Q 0 -26 -17 -6 Z"
          fill={INK}
        />
        <path
          d="M -36 12 Q -18 18 0 14 Q 18 10 36 14"
          fill="none"
          stroke={INK_SOFT}
          strokeWidth="1.2"
        />
      </g>

      {/* Shoreline */}
      <rect x="0" y="452" width="800" height="68" fill={PAPER} />
      <path d="M 0 452 H 800" stroke={INK} strokeWidth="1" />

      {/* Chinar trees */}
      <Tree x={70} y={495} scale={1.5} />
      <Tree x={185} y={497} scale={1.05} />
      <Tree x={255} y={498} scale={0.7} />

      {/* School building */}
      <rect x="470" y="330" width="260" height="150" fill={CHALK} />
      <path d="M 458 332 L 600 262 L 742 332 Z" fill={INK} />
      <circle cx="600" cy="362" r="14" fill={CHALK} stroke={INK} strokeWidth="1.5" />
      <path
        d="M 600 362 L 600 352 M 600 362 L 607 366"
        stroke={INK}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="600" cy="362" r="1.8" fill={INK} />
      {WINDOWS.map(({ x, y }) => (
        <g key={x}>
          <rect x={x} y={y} width="34" height="36" fill={CHALK} stroke={INK} strokeWidth="1" />
          <path
            d={`M ${x} ${y + 18} H ${x + 34} M ${x + 17} ${y} V ${y + 36}`}
            stroke={INK}
            strokeWidth="1"
          />
        </g>
      ))}
      <rect x="588" y="390" width="24" height="24" fill={CHALK} stroke={INK} strokeWidth="1.2" />
      <defs>
        <path id={crestLeafId} d={CHINAR_PATH} />
      </defs>
      <use
        href={`#${crestLeafId}`}
        transform="translate(600 402) scale(0.4) translate(-16 -13)"
        fill={INK}
      />
      <rect x="574" y="420" width="52" height="60" fill={PAPER_DEEP} stroke={INK} strokeWidth="1.5" />
      <path d="M 570 484 H 630 M 566 488 H 634" stroke={INK} strokeWidth="1.2" />
      <path d="M 470 480 H 730" stroke={INK} strokeWidth="1.2" />

      {/* Fine detail — hidden at small render sizes to avoid visual mud. */}
      <g className="art-detail">
        {CHILDREN.map(({ x, y, s, book }) => (
          <g key={x} transform={`translate(${x} ${y}) scale(${s})`}>
            <g fill={INK}>
              <circle cx="8" cy="-36" r="4.6" />
              <path d="M 3.5 -30 Q 8 -34 12.5 -30 L 13.5 -19 L 4 -19 Z" />
              <path d="M 13.5 -19 L 15.5 -9 L 19 -6.5 L 18.5 -3.5 L 12.5 -7.5 L 11.5 -19 Z" />
              <path d="M 4 -19 L 3 -9 L 0 -8 L 1 -4.5 L 5 -8 L 6 -19 Z" />
              <path d="M 13.5 -29 L 17 -24 L 16.5 -22 L 12 -26.5 Z" />
            </g>
            <rect x="16.5" y="-28" width="8" height="5.5" fill={book} />
            <path d="M 20.5 -28 L 20.5 -22.5" stroke={INK} strokeWidth="1" />
          </g>
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
      </g>
    </Scene>
  );
}

export default HeroScene;
