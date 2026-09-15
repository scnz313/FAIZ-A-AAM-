import { ImageResponse } from "next/og";

export const alt = "Faiz E Aam Secondary School · Bandipora — فیض عام";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Ink-ground editorial wordmark card: serif wordmark, Urdu name, saffron
   rule and small-caps place line. System serif only — no external fonts
   or images, so the build stays offline-safe. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          background: "#0b1c2a",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div style={{ fontSize: 72, letterSpacing: "-0.02em", color: "#FFFDF8" }}>Faiz E Aam</div>
        <div dir="rtl" lang="ur" style={{ fontSize: 40, color: "#FFFDF8" }}>
          فیض عام
        </div>
        <div style={{ width: 120, height: 2, background: "#B96832" }} />
        <div style={{ fontSize: 22, letterSpacing: 6.6, color: "#B96832" }}>
          SECONDARY SCHOOL · BANDIPORA
        </div>
      </div>
    ),
    size
  );
}
