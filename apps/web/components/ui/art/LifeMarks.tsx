/**
 * LifeMarks — six quiet linocut-style square marks for the school-life
 * tiles. One consistent 2px ink stroke, two to three flat tones each,
 * same visual weight across the set. Each mark is a separate named
 * component with a 120×120 viewBox.
 */

import { useId, type ReactNode } from "react";

import { CHINAR_PATH } from "../ChinarMark";
import { Scene } from "./Scene";

const INK = "#0b1c2a";
const PAPER = "#f4efe5";
const CHALK = "#fffdf8";
const SAFFRON = "#b96832";
const SAFFRON_DEEP = "#8c4a1e";
const WILLOW = "#536d57";

type LifeMarkProps = { className?: string; ariaHidden?: boolean };

/* LifeMarks share the Scene wrapper (role/aria handling, viewBox sizing)
   with a fixed 120×120 viewBox and per-mark accessible labels. */
function Mark({
  className,
  ariaHidden,
  label,
  children,
}: LifeMarkProps & { label: string; children: ReactNode }) {
  return (
    <Scene
      viewBox="0 0 120 120"
      width={120}
      height={120}
      ariaLabel={label}
      ariaHidden={ariaHidden}
      className={className}
    >
      {children}
    </Scene>
  );
}

/** Sports — ball with seam arcs and a motion arc. */
export function SportsMark({ className, ariaHidden }: LifeMarkProps) {
  return (
    <Mark label="School life: sports" className={className} ariaHidden={ariaHidden}>
      <circle cx="60" cy="58" r="20" fill={CHALK} stroke={INK} strokeWidth="2" />
      <path d="M 60 39 C 51 49 51 67 60 77" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M 60 39 C 69 49 69 67 60 77" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M 26 92 Q 60 104 94 92" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M 40 98 Q 60 106 80 98" fill="none" stroke={INK} strokeWidth="2" />
    </Mark>
  );
}

/** Arts — palette with thumb hole and paint dots, brush reaching in. */
export function ArtsMark({ className, ariaHidden }: LifeMarkProps) {
  return (
    <Mark label="School life: arts" className={className} ariaHidden={ariaHidden}>
      <path
        d="M 46 36 C 32 36 26 45 26 55 C 26 66 34 74 48 74 L 64 74 C 76 74 84 66 84 55 C 84 44 70 36 46 36 Z"
        fill={CHALK}
        stroke={INK}
        strokeWidth="2"
      />
      <circle cx="62" cy="56" r="5" fill={PAPER} stroke={INK} strokeWidth="2" />
      <circle cx="38" cy="54" r="4.5" fill={SAFFRON} />
      <circle cx="46" cy="66" r="4" fill={WILLOW} />
      <circle cx="60" cy="68" r="3.5" fill={SAFFRON_DEEP} />
      <path d="M 94 26 L 82 38" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M 82 38 L 70 50" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <circle cx="66" cy="54" r="3.5" fill={SAFFRON} />
    </Mark>
  );
}

/** Service — a small chinar sapling beside a trowel, on one ground line. */
export function ServiceMark({ className, ariaHidden }: LifeMarkProps) {
  const leafId = useId();
  return (
    <Mark label="School life: service" className={className} ariaHidden={ariaHidden}>
      <path d="M 24 84 H 96" stroke={INK} strokeWidth="2" />
      <path d="M 38 52 L 38 80" stroke={INK} strokeWidth="2" />
      <defs>
        <path id={leafId} d={CHINAR_PATH} />
      </defs>
      <use
        href={`#${leafId}`}
        transform="translate(38 52) rotate(180) scale(0.55) translate(-16 -3)"
        fill={WILLOW}
      />
      <path d="M 90 34 L 80 44" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M 80 44 L 62 54 L 70 84 L 82 84 Z" fill={CHALK} stroke={INK} strokeWidth="2" />
    </Mark>
  );
}

/** Assemblies — handbell with clapper and sound arcs. */
export function AssembliesMark({ className, ariaHidden }: LifeMarkProps) {
  return (
    <Mark label="School life: assemblies" className={className} ariaHidden={ariaHidden}>
      <circle cx="60" cy="12" r="3.5" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M 60 16 L 60 20" stroke={INK} strokeWidth="2" />
      <path
        d="M 44 38 C 44 24 49 20 60 20 C 71 20 76 24 76 38 L 79 58 L 41 58 Z"
        fill={CHALK}
        stroke={INK}
        strokeWidth="2"
      />
      <path d="M 60 58 L 60 60" stroke={INK} strokeWidth="2" />
      <circle cx="60" cy="64" r="4.5" fill={INK} />
      <path d="M 44 72 Q 60 78 76 72" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M 50 82 Q 60 86 70 82" fill="none" stroke={INK} strokeWidth="2" />
    </Mark>
  );
}

/** Trips — bus silhouette with window strip, door and wheels. */
export function TripsMark({ className, ariaHidden }: LifeMarkProps) {
  return (
    <Mark label="School life: trips" className={className} ariaHidden={ariaHidden}>
      <rect x="30" y="34" width="60" height="40" rx="6" fill={CHALK} stroke={INK} strokeWidth="2" />
      <rect x="34" y="40" width="10" height="10" fill={PAPER} stroke={INK} strokeWidth="2" />
      <rect x="48" y="40" width="12" height="10" fill={PAPER} stroke={INK} strokeWidth="2" />
      <rect x="64" y="40" width="12" height="10" fill={PAPER} stroke={INK} strokeWidth="2" />
      <rect x="80" y="40" width="10" height="10" fill={PAPER} stroke={INK} strokeWidth="2" />
      <path d="M 52 74 V 62" stroke={INK} strokeWidth="2" />
      <circle cx="46" cy="78" r="8" fill={INK} />
      <circle cx="74" cy="78" r="8" fill={INK} />
      <circle cx="46" cy="78" r="3" fill={CHALK} />
      <circle cx="74" cy="78" r="3" fill={CHALK} />
      <path d="M 24 90 H 96" stroke={INK} strokeWidth="2" />
    </Mark>
  );
}

/** Reading — open book with page rules and a chinar leaf above it. */
export function ReadingMark({ className, ariaHidden }: LifeMarkProps) {
  const leafId = useId();
  return (
    <Mark label="School life: reading" className={className} ariaHidden={ariaHidden}>
      <path d="M 60 46 Q 50 44 38 48 L 38 78 Q 50 74 60 76 Z" fill={CHALK} stroke={INK} strokeWidth="2" />
      <path d="M 60 46 Q 70 44 82 48 L 82 78 Q 70 74 60 76 Z" fill={CHALK} stroke={INK} strokeWidth="2" />
      <path d="M 60 46 L 60 76" stroke={INK} strokeWidth="2" />
      <path d="M 44 56 H 54 M 44 62 H 51 M 66 56 H 76 M 66 62 H 73" stroke={INK} strokeWidth="2" />
      <defs>
        <path id={leafId} d={CHINAR_PATH} />
      </defs>
      <use
        href={`#${leafId}`}
        transform="translate(60 30) rotate(180) scale(0.4) translate(-16 -3)"
        fill={WILLOW}
      />
    </Mark>
  );
}
