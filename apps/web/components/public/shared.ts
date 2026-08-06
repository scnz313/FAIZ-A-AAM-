import type { AqiBand } from "@fass/contracts";

export type Tone = "good" | "watch" | "alert";

/** CPCB band -> status tone, shared vocabulary for the public environment page. */
export const BAND_TONE: Record<AqiBand, Tone> = {
  good: "good",
  satisfactory: "good",
  moderate: "watch",
  poor: "alert",
  "very-poor": "alert",
  severe: "alert",
};
