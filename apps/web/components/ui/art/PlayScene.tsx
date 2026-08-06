/**
 * PlayScene — three children running across the ground, one chasing a
 * ball, with motion arcs and a chinar branch overhead with falling
 * leaves. Flat editorial print style.
 */

import { useId } from "react";

import { CHINAR_PATH } from "../ChinarMark";
import { Scene } from "./Scene";

const INK = "#0b1c2a";
const INK_SOFT = "#5a6670";
const PAPER = "#f4efe5";
const WILLOW = "#536d57";
const SAFFRON = "#b96832";
const SAFFRON_DEEP = "#8c4a1e";

/** Simple double-arc bird stroke. */
const BIRD_PATH = "M 0 0 Q 6 4 12 0 Q 18 4 24 0";

/** Short grass tuft stroke, anchored at its base. */
const TUFT_PATH = "M 0 0 Q 3 -7 1 -12 M 0 0 Q 0 -9 4 -11 M 0 0 Q -3 -6 -2 -10";

/** Leaves hanging from the branch overhead. */
const BRANCH_LEAVES = [
  { x: 60, y: 24, a: -15, s: 0.55 },
  { x: 120, y: 38, a: 0, s: 0.6 },
  { x: 186, y: 16, a: -40, s: 0.5 },
  { x: 250, y: 70, a: 25, s: 0.5 },
  { x: 300, y: 78, a: 45, s: 0.42 },
] as const;

const FALLING = [
  { x: 150, y: 150, a: 140, s: 0.4, fill: SAFFRON_DEEP },
  { x: 240, y: 205, a: -120, s: 0.35, fill: WILLOW },
] as const;

const RUNNERS = [
  { x: 280, y: 432, s: 1.05 },
  { x: 430, y: 434, s: 0.95 },
  { x: 580, y: 431, s: 1.12 },
] as const;

const ARCS = [
  "M 232 408 Q 254 396 276 402",
  "M 386 412 Q 406 402 426 408",
  "M 536 408 Q 557 396 578 403",
] as const;

const TUFTS = [
  { x: 250, y: 430 },
  { x: 420, y: 432 },
  { x: 570, y: 430 },
  { x: 700, y: 428 },
] as const;

const BIRDS = [
  { x: 600, y: 70, s: 0.6 },
  { x: 645, y: 92, s: 0.5 },
] as const;

export type PlaySceneProps = { className?: string; ariaHidden?: boolean };

export function PlayScene({ className, ariaHidden }: PlaySceneProps) {
  const leafId = useId();

  return (
    <Scene
      viewBox="0 0 800 500"
      width={800}
      height={500}
      ariaLabel="Illustration: children running and playing beneath a chinar branch"
      ariaHidden={ariaHidden}
      className={className}
    >
      {/* Sky and ground */}
      <rect x="0" y="0" width="800" height="500" fill={PAPER} />
      <path d="M 0 430 H 800" stroke={INK} strokeWidth="1" />

      {/* Chinar branch overhead with hanging leaves */}
      <path d="M -10 6 C 60 30 140 48 230 64 C 280 74 320 78 346 82" stroke={INK} strokeWidth="2" fill="none" />
      <path d="M 130 34 Q 158 18 186 14" stroke={INK} strokeWidth="1.5" fill="none" />
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
      <path d="M 138 162 q 10 6 20 4" stroke={INK_SOFT} strokeWidth="1" fill="none" />
      <path d="M 226 216 q 9 5 18 3" stroke={INK_SOFT} strokeWidth="1" fill="none" />

      {/* Motion arcs behind the runners */}
      {ARCS.map((d) => (
        <path key={d} d={d} stroke={INK_SOFT} strokeWidth="1.5" fill="none" />
      ))}

      {/* Runners */}
      {RUNNERS.map(({ x, y, s }) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${s})`} fill={INK}>
          <circle cx="9" cy="-40" r="4.8" />
          <path d="M 3 -34 Q 9 -38 15 -33 L 16.5 -21 L 4 -21 Z" />
          <path d="M 16.5 -21 L 23 -9 L 28 -6 L 27.5 -2.5 L 21 -6 L 15 -14 Z" />
          <path d="M 4 -21 L -1 -9 L -5 -8 L -4 -4 L 1 -7 L 6 -17 Z" />
          <path d="M 15.5 -31 L 21 -25 L 20 -22.5 L 14 -28 Z" />
          <path d="M 4 -31 L -2 -25 L -1 -22.5 L 5 -28 Z" />
        </g>
      ))}

      {/* Ball rolling ahead of the third runner */}
      <circle cx="610" cy="422" r="9.5" fill={SAFFRON} stroke={INK} strokeWidth="1.5" />
      <path d="M 604 418 Q 610 428 616 417" stroke={INK} strokeWidth="1.2" fill="none" />
      <path d="M 578 426 Q 586 422 594 425 M 596 425 Q 602 422 608 425" stroke={INK_SOFT} strokeWidth="1.2" fill="none" />

      {/* Grass tufts and birds */}
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

export default PlayScene;
