/**
 * LakeScene — a wide band of the Wular lake: mountain ridge with snow
 * caps, fine wave lines, a shikara with its canopy, birds and a chinar
 * branch leaning in from the top corner with a drifting leaf. Built as a
 * full-width section divider in flat editorial print style.
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
const SAFFRON_DEEP = "#8c4a1e";

/** Simple double-arc bird stroke. */
const BIRD_PATH = "M 0 0 Q 6 4 12 0 Q 18 4 24 0";

const WAVES = [
  { x: 60, y: 118, s: 1.6, tone: INK_SOFT },
  { x: 420, y: 118, s: 1.2, tone: INK_SOFT },
  { x: 150, y: 152, s: 2.0, tone: INK_SOFT },
  { x: 560, y: 152, s: 1.8, tone: INK_SOFT },
  { x: 40, y: 186, s: 1.4, tone: INK },
  { x: 330, y: 186, s: 2.2, tone: INK },
  { x: 700, y: 186, s: 1.5, tone: INK },
  { x: 220, y: 220, s: 1.7, tone: INK },
  { x: 620, y: 220, s: 2.0, tone: INK },
] as const;

const BRANCH_LEAVES = [
  { x: 760, y: 18, a: 30, s: 0.5 },
  { x: 700, y: 42, a: 55, s: 0.45 },
  { x: 668, y: 66, a: 75, s: 0.42 },
] as const;

const BIRDS = [
  { x: 140, y: 12, s: 0.55 },
  { x: 190, y: 20, s: 0.45 },
  { x: 520, y: 10, s: 0.5 },
] as const;

export type LakeSceneProps = { className?: string; ariaHidden?: boolean };

export function LakeScene({ className, ariaHidden }: LakeSceneProps) {
  const waveId = useId();
  const leafId = useId();

  return (
    <Scene
      viewBox="0 0 800 260"
      width={800}
      height={260}
      ariaLabel="Illustration: the Wular lake with mountains, a shikara and a chinar branch"
      ariaHidden={ariaHidden}
      className={className}
    >
      {/* Sky and birds — fine detail, hidden at small render sizes. */}
      <rect x="0" y="0" width="800" height="26" fill={PAPER} />
      <g className="art-detail">
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

      {/* Mountain ridge with snow caps */}
      <path
        d="M 0 84 L 0 52 L 110 30 L 220 60 L 340 26 L 470 62 L 590 34 L 700 58 L 800 42 L 800 84 Z"
        fill={INK_2}
      />
      <path d="M 88 44 L 99 32 L 110 30 L 121 35 L 133 50 L 120 44 L 110 38 L 99 42 Z" fill={CHALK} />
      <path d="M 314 44 L 326 28 L 340 26 L 354 33 L 370 50 L 354 42 L 340 35 L 326 41 Z" fill={CHALK} />

      {/* Water */}
      <rect x="0" y="84" width="800" height="176" fill={PAPER_DEEP} />
      <defs>
        <path id={waveId} d="M 0 0 q 6 -3 12 0 q 6 3 12 0" />
      </defs>
      {/* Fine wave detail — hidden at small render sizes to avoid mud. */}
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
      <g transform="translate(400 160) scale(1.15)">
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

      {/* Chinar branch from the top corner, with a drifting leaf */}
      <path d="M 812 -8 C 760 18 700 40 648 66" stroke={INK} strokeWidth="2" fill="none" />
      <path d="M 700 40 Q 682 54 668 66" stroke={INK} strokeWidth="1.5" fill="none" />
      <defs>
        <path id={leafId} d={CHINAR_PATH} />
      </defs>
      {BRANCH_LEAVES.map(({ x, y, a, s }) => (
        <use
          key={`${x}-${y}`}
          href={`#${leafId}`}
          transform={`translate(${x} ${y}) rotate(${a}) scale(${s}) translate(-16 -22.8)`}
          fill={WILLOW}
        />
      ))}
      <use
        href={`#${leafId}`}
        transform="translate(600 130) rotate(-30) scale(0.4) translate(-16 -22.8)"
        fill={SAFFRON_DEEP}
      />
      <path d="M 588 140 q 10 5 20 3" stroke={INK_SOFT} strokeWidth="1" fill="none" />
    </Scene>
  );
}

export default LakeScene;
