/**
 * ChinarBranch — a single chinar branch with five leaves and two falling
 * leaves, drawn in flat editorial print style with fine ink line work.
 * Used as a quiet decorative accent band.
 */

import { useId } from "react";

import { CHINAR_PATH } from "../ChinarMark";
import { Scene } from "./Scene";

const INK = "#0b1c2a";
const INK_SOFT = "#5a6670";
const PAPER = "#f4efe5";
const WILLOW = "#536d57";
const SAFFRON_DEEP = "#8c4a1e";

const BRANCH_LEAVES = [
  { x: 150, y: 112, a: -35, s: 0.85 },
  { x: 240, y: 100, a: -10, s: 0.9 },
  { x: 186, y: 66, a: -55, s: 0.75 },
  { x: 226, y: 158, a: 30, s: 0.7 },
  { x: 326, y: 152, a: 40, s: 0.65 },
] as const;

const FALLING = [
  { x: 90, y: 228, a: 130, s: 0.6, fill: SAFFRON_DEEP },
  { x: 240, y: 250, a: -120, s: 0.55, fill: WILLOW },
] as const;

export type ChinarBranchProps = { className?: string; ariaHidden?: boolean };

export function ChinarBranch({ className, ariaHidden }: ChinarBranchProps) {
  const leafId = useId();

  return (
    <Scene
      viewBox="0 0 400 300"
      width={400}
      height={300}
      ariaLabel="Illustration: a chinar branch with falling leaves"
      ariaHidden={ariaHidden}
      className={className}
    >
      <rect x="0" y="0" width="400" height="300" fill={PAPER} />

      {/* Branch and twigs */}
      <path
        d="M -8 128 C 90 108 190 96 286 100 C 330 102 360 110 388 122"
        stroke={INK}
        strokeWidth="2.2"
        fill="none"
      />
      <path d="M 120 112 C 138 84 158 70 186 66" stroke={INK} strokeWidth="1.5" fill="none" />
      <path d="M 226 98 C 232 122 232 136 226 158" stroke={INK} strokeWidth="1.5" fill="none" />
      <path d="M 300 102 C 316 118 324 132 326 152" stroke={INK} strokeWidth="1.5" fill="none" />

      {/* Leaves */}
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

      {/* Falling leaves with motion arcs */}
      {FALLING.map(({ x, y, a, s, fill }) => (
        <use
          key={`${x}-${y}`}
          href={`#${leafId}`}
          transform={`translate(${x} ${y}) rotate(${a}) scale(${s}) translate(-16 -22.8)`}
          fill={fill}
        />
      ))}
      <path d="M 78 240 q 10 6 20 4" stroke={INK_SOFT} strokeWidth="1" fill="none" />
      <path d="M 226 262 q 10 6 20 4" stroke={INK_SOFT} strokeWidth="1" fill="none" />
    </Scene>
  );
}

export default ChinarBranch;
