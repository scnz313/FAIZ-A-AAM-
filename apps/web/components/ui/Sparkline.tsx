export type SparklineTone = "willow" | "saffron" | "brick" | "ink";

type SparklineProps = {
  data: number[];
  ariaLabel: string;
  className?: string;
  width?: number;
  height?: number;
  tone?: SparklineTone;
};

/**
 * Tiny trend line without axes. Renders an empty but labeled SVG when
 * there are fewer than two points, so screen readers still get the label.
 */
export function Sparkline({
  data,
  ariaLabel,
  className,
  width = 100,
  height = 32,
  tone = "ink",
}: SparklineProps) {
  const classes = `sparkline sparkline--${tone}${className ? ` ${className}` : ""}`;

  if (data.length < 2) {
    return (
      <svg
        className={classes}
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
      />
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min;
  const padY = span === 0 ? Math.max(1, Math.abs(max) * 0.1) : span * 0.1;
  const yMin = min - padY;
  const yMax = max + padY;
  const stepX = (width - 2) / (data.length - 1);
  const points = data
    .map((value, index) => {
      const x = index * stepX + 1;
      const y = height - 2 - ((value - yMin) / (yMax - yMin)) * (height - 4);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      className={classes}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <polyline className="sparkline-path" points={points} pathLength={1} />
    </svg>
  );
}
