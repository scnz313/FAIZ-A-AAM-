"use client";

import { useMemo, useState } from "react";
import { METRIC_META } from "@fass/contracts";
import type { EnvironmentReport, MetricType } from "@fass/contracts";
import Button from "@/components/ui/Button";
import { generateReport } from "@/lib/iot/api";
import { formatKolkata } from "@/modules/iot/domain";
import styles from "./ReportsWorkspace.module.css";

const REPORT_METRICS: ReadonlyArray<{ key: MetricType; label: string }> = [
  { key: "co2_ppm", label: "CO₂" },
  { key: "pm25_ugm3", label: "PM2.5" },
  { key: "temp_c", label: "Temperature" },
  { key: "humidity_pct", label: "Humidity" },
  { key: "noise_db", label: "Noise" },
];

const MAX_SPAN_DAYS = 30;
const DAY_MS = 86_400_000;

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatStat(metric: MetricType, value: number): string {
  return value.toFixed(METRIC_META[metric].decimals);
}

type FormErrors = { window?: string; metrics?: string };

export function ReportsWorkspace() {
  const [preset, setPreset] = useState<"7d" | "30d" | null>("7d");
  const [from, setFrom] = useState(() => shiftDays(todayIST(), -6));
  const [to, setTo] = useState(() => todayIST());
  const [metrics, setMetrics] = useState<MetricType[]>(REPORT_METRICS.map((m) => m.key));
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  function applyPreset(days: 7 | 30) {
    const toDate = todayIST();
    setFrom(shiftDays(toDate, -(days - 1)));
    setTo(toDate);
    setPreset(days === 7 ? "7d" : "30d");
    setFormErrors((prev) => ({ ...prev, window: undefined }));
  }

  function handleFromChange(value: string) {
    setFrom(value);
    setPreset(null);
    setFormErrors((prev) => ({ ...prev, window: undefined }));
  }

  function handleToChange(value: string) {
    setTo(value);
    setPreset(null);
    setFormErrors((prev) => ({ ...prev, window: undefined }));
  }

  function toggleMetric(metric: MetricType) {
    setMetrics((prev) => (prev.includes(metric) ? prev.filter((m) => m !== metric) : [...prev, metric]));
    setFormErrors((prev) => ({ ...prev, metrics: undefined }));
  }

  function validate(): boolean {
    const errors: FormErrors = {};
    if (!from || !to) {
      errors.window = "Choose a period with a preset or the from and to dates.";
    } else {
      const fromMs = new Date(`${from}T00:00:00Z`).getTime();
      const toMs = new Date(`${to}T00:00:00Z`).getTime();
      const spanDays = Math.round((toMs - fromMs) / DAY_MS);
      if (spanDays < 0) {
        errors.window = "The from date must not be after the to date.";
      } else if (spanDays > MAX_SPAN_DAYS) {
        errors.window = `The report window is limited to ${MAX_SPAN_DAYS} days.`;
      }
    }
    if (metrics.length === 0) {
      errors.metrics = "Select at least one metric.";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function generate() {
    if (!validate()) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const next = await generateReport({ from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` }, metrics);
      setReport(next);
      setGenerating(false);
    } catch {
      setGenerateError("The report service did not respond. Try again.");
      setGenerating(false);
    }
  }

  const zoneGroups = useMemo(() => {
    if (!report) return [];
    const zones: Array<{ zoneId: string; zoneName: string }> = [];
    for (const stat of report.zoneStats) {
      if (!zones.some((z) => z.zoneId === stat.zoneId)) {
        zones.push({ zoneId: stat.zoneId, zoneName: stat.zoneName });
      }
    }
    return zones;
  }, [report]);

  return (
    <div className={styles.layout}>
      <section className={styles.controls} aria-label="Report parameters">
        <div className={styles.controlBlock}>
          <p className="section-label">Period</p>
          <fieldset className={styles.radioGroup}>
            <legend className={styles.legend}>Period presets</legend>
            <label className={styles.radioLabel}>
              <input type="radio" name="period" checked={preset === "7d"} onChange={() => applyPreset(7)} />
              Last 7 days
            </label>
            <label className={styles.radioLabel}>
              <input type="radio" name="period" checked={preset === "30d"} onChange={() => applyPreset(30)} />
              Last 30 days
            </label>
          </fieldset>
          <div className={styles.dateRow}>
            <div className={styles.field}>
              <label htmlFor="report-from">From</label>
              <input
                id="report-from"
                className="input"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => handleFromChange(event.target.value)}
                aria-describedby={formErrors.window ? "report-window-error" : undefined}
                aria-invalid={formErrors.window ? true : undefined}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="report-to">To</label>
              <input
                id="report-to"
                className="input"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => handleToChange(event.target.value)}
                aria-describedby={formErrors.window ? "report-window-error" : undefined}
                aria-invalid={formErrors.window ? true : undefined}
              />
            </div>
          </div>
          {formErrors.window && (
            <p id="report-window-error" className="field-error" role="alert">
              {formErrors.window}
            </p>
          )}
        </div>

        <div className={styles.controlBlock}>
          <p className="section-label" id="report-metrics-label">
            Metrics
          </p>
          <fieldset className={styles.checkGroup} aria-labelledby="report-metrics-label">
            {REPORT_METRICS.map((m) => (
              <label key={m.key} className={styles.checkLabel}>
                <input type="checkbox" checked={metrics.includes(m.key)} onChange={() => toggleMetric(m.key)} />
                {m.label}
              </label>
            ))}
          </fieldset>
          {formErrors.metrics && (
            <p id="report-metrics-error" className="field-error" role="alert">
              {formErrors.metrics}
            </p>
          )}
        </div>

        <Button variant="primary" onClick={() => void generate()} disabled={generating}>
          Generate report
        </Button>
        {report && (
          <p className={styles.generateStatus} role="status">
            Report {report.ref} generated — {zoneGroups.length} zone{zoneGroups.length === 1 ? "" : "s"} ·{" "}
            {metrics.length} metric{metrics.length === 1 ? "" : "s"}
          </p>
        )}
        <p className={styles.helpNote}>
          The report covers all zones for the selected metrics. Output is fictional demo data.
        </p>
      </section>

      <section className={`panel ${styles.preview}`} aria-busy={generating}>
        {generating ? (
          <div className={styles.generating} role="status">
            <span className={styles.progressLine} aria-hidden="true">
              <span className={styles.progressFill} />
            </span>
            <p>Generating report…</p>
          </div>
        ) : generateError ? (
          <div className="workspace-state" role="alert">
            <p className="workspace-state-title">Could not generate the report</p>
            <p className="workspace-state-note">{generateError}</p>
            <Button variant="quiet" onClick={() => void generate()}>
              Retry
            </Button>
          </div>
        ) : report ? (
          <>
            <div className={styles.previewHead}>
              <div>
                <p className="section-label">Report</p>
                <h2 className={styles.previewTitle}>
                  Environment report <span className={styles.previewRef}>· {report.ref}</span>
                </h2>
              </div>
              <div className={styles.previewActions}>
                <span className="demo-badge">Fictional demo report</span>
                <Button variant="quiet" onClick={() => window.print()}>
                  Print report
                </Button>
              </div>
            </div>

            <dl className={styles.reportMeta}>
              <div>
                <dt>Period</dt>
                <dd>
                  {formatKolkata(report.periodStart, { format: "full" })} – {formatKolkata(report.periodEnd, { format: "full" })}
                </dd>
              </div>
              <div>
                <dt>Generated</dt>
                <dd>
                  {formatKolkata(report.generatedAt, { format: "full" })} · {report.generatedBy}
                </dd>
              </div>
            </dl>

            <p className={styles.summary}>{report.summary}</p>

            <div className="table table--scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Zone</th>
                    <th scope="col">Metric</th>
                    <th scope="col">Avg</th>
                    <th scope="col">Min</th>
                    <th scope="col">Max</th>
                    <th scope="col">P95</th>
                    <th scope="col">Hours out of range</th>
                  </tr>
                </thead>
                <tbody>
                  {report.zoneStats.map((stat, index) => {
                    const previous = report.zoneStats[index - 1];
                    const zoneLabel = previous && previous.zoneId === stat.zoneId ? "" : stat.zoneName;
                    return (
                      <tr key={`${stat.zoneId}-${stat.metric}`}>
                        <td>{zoneLabel}</td>
                        <td>{METRIC_META[stat.metric].shortLabel}</td>
                        <td className="num">{formatStat(stat.metric, stat.avg)}</td>
                        <td className="num">{formatStat(stat.metric, stat.min)}</td>
                        <td className="num">{formatStat(stat.metric, stat.max)}</td>
                        <td className="num">{formatStat(stat.metric, stat.p95)}</td>
                        <td className="num">{stat.hoursOutOfRange} h</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={styles.zoneCount}>
              {zoneGroups.length} zone{zoneGroups.length === 1 ? "" : "s"} covered
            </p>
          </>
        ) : (
          <div className="workspace-state">
            <p className="workspace-state-title">No report yet</p>
            <p className="workspace-state-note">
              Choose a period and at least one metric, then generate the report. Zone averages, extremes and
              out-of-range hours appear here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
