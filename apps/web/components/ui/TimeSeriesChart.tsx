"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { METRIC_META } from "@fass/contracts";
import type { MetricType, SeriesSample } from "@fass/contracts";
import { formatKolkata, formatMetricValue, bandRectsFor, THRESHOLDS } from "@/modules/iot/domain";

export type ChartThresholdTone = "good" | "watch" | "alert";

export interface ChartThreshold {
  value: number;
  label: string;
  tone: ChartThresholdTone;
}

/** Explicit tinted region on the value axis; the band covers values between `from` and `to` (order irrelevant, infinities allowed). */
export interface ChartBand {
  from: number;
  to: number;
  tone: ChartThresholdTone;
}

/** Also accepts the compact [goodMax, alertMin] number form. */
type ThresholdInput = ChartThreshold[] | number[];

type TimeSeriesChartProps = {
  series?: SeriesSample[];
  /** Alias accepted for callers that pass `data` instead of `series`. */
  data?: SeriesSample[];
  metric?: MetricType;
  height?: number;
  thresholds?: ThresholdInput;
  /** Explicit tinted regions; overrides `thresholds` when both are given. */
  bands?: ChartBand[];
  ariaLabel: string;
  formatValue?: (value: number) => string;
  className?: string;
};

/* Flat, tinted fills — no gradients. */
const TONE_FILLS: Record<ChartThresholdTone, string> = {
  good: "rgba(83, 109, 87, 0.10)",
  watch: "rgba(185, 104, 50, 0.12)",
  alert: "rgba(162, 59, 46, 0.12)",
};

/* Plot insets: room for y labels on the left, x labels below. */
const PLOT = { top: 14, right: 14, bottom: 28, left: 54 };

const CLOCK = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DAY_MONTH = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
});

function normalizeThresholds(input: ThresholdInput | undefined): ChartThreshold[] {
  if (!input) return [];
  if (typeof input[0] === "number") {
    // Compact [goodMax, alertMin] form, as used by the zone detail page.
    return (input as number[]).map((value, index) => ({
      value,
      label: index === 0 ? "Good" : index === 1 ? "Alert" : "Watch",
      tone: index === 0 ? "good" : index === 1 ? "alert" : "watch",
    }));
  }
  return input as ChartThreshold[];
}

/**
 * Resolve the tinted-band layout for the chart.
 * Priority: explicit `bands` prop, then the good/alert threshold pair (which
 * resolves per-metric direction via bandRectsFor — light_lux and temp_c
 * invert, temp_c also gains the cold band), then sensible defaults from the
 * domain threshold table for the metric, then no bands.
 */
function resolveBands(
  bands: ChartBand[] | undefined,
  thresholds: ThresholdInput | undefined,
  metric: MetricType | undefined,
): ChartBand[] | null {
  if (bands) return bands;
  const normalized = normalizeThresholds(thresholds);
  if (normalized.length > 0) {
    const good = normalized.filter((t) => t.tone === "good").map((t) => t.value);
    const alert = normalized.filter((t) => t.tone === "alert").map((t) => t.value);
    const watch = normalized.filter((t) => t.tone === "watch");
    if (watch.length === 0 && good.length > 0 && alert.length > 0 && metric) {
      return bandRectsFor(metric, Math.max(...good), Math.min(...alert));
    }
    // Explicit thresholds with watch tones keep the legacy geometry below.
    return null;
  }
  if (metric) {
    const t = THRESHOLDS[metric];
    if (t) return bandRectsFor(metric, t.goodMax, t.alertMin);
  }
  return null;
}

/**
 * Hand-rolled responsive time-series chart: 3 ruled gridlines with value
 * labels, threshold band fills, an 8% tinted area under a 1.5px ink line,
 * and a hover crosshair with value tooltip. A visually-hidden sample list
 * carries the full series to screen readers; hover is a bonus, never the
 * only access. Static rendering under reduced motion (draw-in is gated in
 * CSS behind `prefers-reduced-motion: no-preference`).
 */
export function TimeSeriesChart({
  series,
  data,
  metric,
  height = 200,
  thresholds,
  bands,
  ariaLabel,
  formatValue,
  className,
}: TimeSeriesChartProps) {
  const samples = useMemo(() => series ?? data ?? [], [series, data]);
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const format = useMemo(() => {
    if (formatValue) return formatValue;
    if (metric) return (value: number) => formatMetricValue(metric, value);
    return (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  }, [formatValue, metric]);

  const geometry = useMemo(() => {
    const values = samples.map((sample) => sample.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const span = rawMax - rawMin;
    const pad = span === 0 ? Math.max(1, Math.abs(rawMax) * 0.05) : span * 0.12;
    const yMin = rawMin - pad;
    const yMax = rawMax + pad;
    const plotW = Math.max(0, width - PLOT.left - PLOT.right);
    const plotH = Math.max(0, height - PLOT.top - PLOT.bottom);
    const yBottom = PLOT.top + plotH;

    const xAt = (index: number) => PLOT.left + (index / (samples.length - 1)) * plotW;
    const yAt = (value: number) => PLOT.top + (1 - (value - yMin) / (yMax - yMin)) * plotH;

    /* Threshold bands, clamped to the visible plot. */
    const fills: Array<{ top: number; bottom: number; fill: string }> = [];
    const pushBand = (topValue: number, bottomValue: number, fill: string) => {
      const top = Math.min(Math.max(yAt(topValue), PLOT.top), yBottom);
      const bottom = Math.min(Math.max(yAt(bottomValue), PLOT.top), yBottom);
      if (bottom - top > 0.5) fills.push({ top, bottom, fill });
    };

    const normalized = normalizeThresholds(thresholds);
    const rects = resolveBands(bands, thresholds, metric);

    if (rects) {
      for (const band of rects) {
        const hi = Math.max(band.from, band.to);
        const lo = Math.min(band.from, band.to);
        pushBand(hi, lo, TONE_FILLS[band.tone]);
      }
    } else {
      const goodValues = normalized.filter((t) => t.tone === "good").map((t) => t.value);
      const alertValues = normalized.filter((t) => t.tone === "alert").map((t) => t.value);
      const watchValues = normalized.filter((t) => t.tone === "watch").map((t) => t.value);

      // When good and alert thresholds both exist (and no explicit watch
      // band is given), the gap between them is the "watch" region.
      if (goodValues.length > 0 && alertValues.length > 0 && watchValues.length === 0) {
        const good = Math.max(...goodValues);
        const alert = Math.min(...alertValues);
        if (alert > good) pushBand(alert, good, TONE_FILLS.watch);
      }

      for (const threshold of normalized) {
        if (threshold.tone === "good") {
          pushBand(threshold.value, yMin, TONE_FILLS.good);
        } else if (threshold.tone === "alert") {
          pushBand(yMax, threshold.value, TONE_FILLS.alert);
        } else {
          const higher = normalized
            .filter((other) => other.value > threshold.value)
            .map((other) => other.value)
            .sort((a, b) => a - b)[0];
          pushBand(higher ?? yMax, threshold.value, TONE_FILLS.watch);
        }
      }
    }

    const points = samples.map((sample, index) => `${xAt(index).toFixed(2)},${yAt(sample.value).toFixed(2)}`);
    const linePath = `M ${points.join(" L ")}`;
    const areaPath = `${linePath} L ${xAt(samples.length - 1).toFixed(2)},${yBottom.toFixed(2)} L ${PLOT.left.toFixed(2)},${yBottom.toFixed(2)} Z`;

    const gridlines = [0, 0.5, 1].map((fraction) => ({
      y: PLOT.top + fraction * plotH,
      value: yMax - fraction * (yMax - yMin),
    }));

    const spanHours =
      (new Date(samples[samples.length - 1]?.takenAt ?? 0).getTime() -
        new Date(samples[0]?.takenAt ?? 0).getTime()) /
      3_600_000;
    const useDayLabel = spanHours > 30;
    const labelCount = width < 480 ? 4 : 6;
    const xLabels = Array.from({ length: labelCount }, (_, i) => {
      const index = Math.round((i / (labelCount - 1)) * (samples.length - 1));
      const sample = samples[index];
      if (!sample) return null;
      const anchor: "start" | "end" | "middle" = i === 0 ? "start" : i === labelCount - 1 ? "end" : "middle";
      return { index, sample, anchor };
    }).filter((label): label is NonNullable<typeof label> => label !== null);

    return { xAt, yAt, plotW, yBottom, linePath, areaPath, bands: fills, gridlines, xLabels, useDayLabel };
  }, [samples, width, height, thresholds, bands, metric]);

  function handleMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const ratio = (px - PLOT.left) / geometry.plotW;
    const index = Math.round(ratio * (samples.length - 1));
    setHoverIndex(Math.min(Math.max(index, 0), samples.length - 1));
  }

  if (samples.length < 2) {
    return (
      <div className={className}>
        <p className="timeseries-empty">No readings recorded in this period.</p>
      </div>
    );
  }

  const tickText = (iso: string) =>
    geometry.useDayLabel ? DAY_MONTH.format(new Date(iso)) : CLOCK.format(new Date(iso));

  const hoverSample = hoverIndex !== null ? samples[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? geometry.xAt(hoverIndex) : 0;
  const flipTip = hoverX > width - 150;

  return (
    <div className={className} ref={wrapRef}>
      <div className="timeseries" role="img" aria-label={ariaLabel}>
        {width === 0 ? (
          <div style={{ height }} />
        ) : (
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverIndex(null)}
          >
            {geometry.bands.map((band, i) => (
              <rect
                key={i}
                x={PLOT.left}
                y={band.top}
                width={geometry.plotW}
                height={band.bottom - band.top}
                fill={band.fill}
              />
            ))}

            {geometry.gridlines.map((gridline, i) => (
              <g key={i}>
                <line
                  className="timeseries-grid"
                  x1={PLOT.left}
                  x2={width - PLOT.right}
                  y1={gridline.y}
                  y2={gridline.y}
                />
                <text className="timeseries-y" x={PLOT.left - 8} y={gridline.y + 4} textAnchor="end">
                  {metric ? gridline.value.toFixed(METRIC_META[metric].decimals) : String(Math.round(gridline.value))}
                </text>
              </g>
            ))}

            <path className="timeseries-area" d={geometry.areaPath} />
            <path className="timeseries-line" d={geometry.linePath} pathLength={1} />

            {geometry.xLabels.map((label) => (
              <text
                key={label.index}
                className="timeseries-x"
                x={geometry.xAt(label.index)}
                y={height - 8}
                textAnchor={label.anchor}
              >
                {tickText(label.sample.takenAt)}
              </text>
            ))}

            {hoverSample && hoverIndex !== null && (
              <g>
                <line
                  className="timeseries-crosshair"
                  x1={hoverX}
                  x2={hoverX}
                  y1={PLOT.top}
                  y2={geometry.yBottom}
                />
                <circle className="timeseries-point" cx={hoverX} cy={geometry.yAt(hoverSample.value)} r={3.5} />
              </g>
            )}
          </svg>
        )}

        {hoverSample && hoverIndex !== null && (
          <div
            className="timeseries-tip"
            style={{
              left: hoverX,
              transform: flipTip ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
            aria-hidden="true"
          >
            <strong>{format(hoverSample.value)}</strong>
            <span>{tickText(hoverSample.takenAt)}</span>
          </div>
        )}
      </div>

      <ul className="sr-only">
        {samples.map((sample) => (
          <li key={sample.takenAt}>
            {formatKolkata(sample.takenAt, { format: "full" })}: {format(sample.value)}
          </li>
        ))}
      </ul>
    </div>
  );
}
