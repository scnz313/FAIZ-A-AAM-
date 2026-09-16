import type { ChartTone } from "@/modules/services/dashboard";

export type RailDatum = { label: string; value: number; tone?: ChartTone; hint?: string };

export type ProgressRailProps = {
  data: RailDatum[];
  ariaLabel: string;
  /** Denominator for segment widths; defaults to the sum of values. */
  total?: number;
  className?: string;
};

/** Stacked status rail: proportional segments on a ruled track with a
 *  labelled legend. A visually hidden table repeats the figures. */
export function ProgressRail({ data, ariaLabel, total, className }: ProgressRailProps) {
  const sum = total ?? data.reduce((acc, datum) => acc + datum.value, 0);
  const denominator = Math.max(1, sum);
  const visible = data.filter((datum) => datum.value > 0);
  return (
    <div className={`progress-rail${className ? ` ${className}` : ""}`}>
      <div className="progress-rail-track" role="img" aria-label={ariaLabel}>
        {visible.map((datum) => (
          <span
            key={datum.label}
            className={`progress-rail-seg progress-rail-seg--${datum.tone ?? "ink"}`}
            style={{ width: `${(datum.value / denominator) * 100}%` }}
            title={`${datum.label}: ${datum.value}`}
          />
        ))}
      </div>
      <ul className="progress-rail-legend">
        {data.map((datum) => (
          <li key={datum.label} className="progress-rail-item">
            <span className={`progress-rail-key progress-rail-key--${datum.tone ?? "ink"}`} aria-hidden="true" />
            <span className="progress-rail-name">{datum.label}</span>
            <span className="progress-rail-value num">
              {datum.hint ?? datum.value}
            </span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.label}>
              <td>{datum.label}</td>
              <td>{datum.value}{datum.hint ? ` ${datum.hint}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
