import type { ChartTone } from "@/modules/services/dashboard";

export type BarChartDatum = { label: string; value: number; tone?: ChartTone; hint?: string };

export type BarChartProps = {
  data: BarChartDatum[];
  ariaLabel: string;
  /** Optional denominator shown as "n / total" beside each value. */
  total?: number;
  className?: string;
};

/** Ruled horizontal bar ledger. The bars are CSS widths on a hairline
 *  track; a visually hidden table carries the same values for screen
 *  readers, so the chart is never decoration-only. */
export function BarChart({ data, ariaLabel, total, className }: BarChartProps) {
  const max = Math.max(1, ...data.map((datum) => datum.value));
  return (
    <div className={`bar-chart${className ? ` ${className}` : ""}`}>
      <div className="bar-chart-plot" role="img" aria-label={ariaLabel}>
        {data.map((datum) => {
          const pct = Math.round((datum.value / max) * 100);
          return (
            <div key={datum.label} className="bar-chart-row">
              <span className="bar-chart-label">{datum.label}</span>
              <span className="bar-chart-track" aria-hidden="true">
                <span
                  className={`bar-chart-fill bar-chart-fill--${datum.tone ?? "ink"}`}
                  style={{ width: `${datum.value === 0 ? 0 : Math.max(pct, 2)}%` }}
                />
              </span>
              <span className="bar-chart-value num">
                {datum.value}
                {total !== undefined ? <span className="bar-chart-total"> / {total}</span> : null}
                {datum.hint ? <span className="bar-chart-hint"> · {datum.hint}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col">Count</th>
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
