import { METRIC_META, METRIC_TYPES, ZONE_KIND_LABELS, type MetricType, type Zone, type ZoneCurrent } from "@fass/contracts";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { zoneStatus, zoneStatusLabel, type ZoneStatus } from "@/modules/iot/domain";
import styles from "./EnvironmentZones.module.css";

export type ZonesData = {
  zones: Zone[];
  current: Record<string, ZoneCurrent>;
};

type Tone = "good" | "watch" | "alert" | "neutral";

const STATUS_TONE: Record<ZoneStatus, Tone> = {
  comfortable: "good",
  watch: "watch",
  action: "alert",
};

/**
 * Comfort status from the shared domain rule (zoneStatus over the zone's
 * readings). Zones with no monitored metrics report an honest "No data".
 */
function zoneStatusFor(
  readings: ZoneCurrent["readings"] | undefined,
): { tone: Tone; label: string } {
  if (!readings) return { tone: "neutral", label: "No data" };
  const hasReading = METRIC_TYPES.some((metric) => typeof readings[metric] === "number");
  if (!hasReading) return { tone: "neutral", label: "No data" };
  const status = zoneStatus(readings);
  return { tone: STATUS_TONE[status], label: zoneStatusLabel(status) };
}

function cellText(
  readings: ZoneCurrent["readings"] | undefined,
  metric: MetricType,
): string {
  const value = readings?.[metric];
  if (typeof value !== "number") return "—";
  const meta = METRIC_META[metric];
  return `${value.toFixed(meta.decimals)} ${meta.unit}`;
}

export default function EnvironmentZones({ data }: { data: ZonesData | null }) {
  return (
    <section className={styles.section} aria-labelledby="zones-heading">
      <div className={styles.head}>
        <p className="section-label">Indoor comfort today</p>
        <h2 className={styles.heading} id="zones-heading">
          Rooms, halls, and labs.
        </h2>
        <span className="demo-badge">Demo data</span>
      </div>

      {data ? (
        <>
          <div className="table--scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Zone</th>
                  <th scope="col">Kind</th>
                  <th scope="col" className="num">Temp</th>
                  <th scope="col" className="num">CO₂</th>
                  <th scope="col" className="num">PM2.5</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.zones.map((zone) => {
                  const readings = data.current[zone.id]?.readings;
                  const status = zoneStatusFor(readings);
                  return (
                    <tr key={zone.id}>
                      <th scope="row">{zone.name}</th>
                      <td>{ZONE_KIND_LABELS[zone.kind]}</td>
                      <td className="num">{cellText(readings, "temp_c")}</td>
                      <td className="num">{cellText(readings, "co2_ppm")}</td>
                      <td className="num">{cellText(readings, "pm25_ugm3")}</td>
                      <td>
                        <StatusBadge tone={status.tone}>
                          {status.label}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.caption}>
            One reading per zone — demo readings, refreshed every few minutes. “—” means no
            current reading for that metric.
          </p>
        </>
      ) : (
        <div className="panel">
          <p className={styles.fallback}>
            Zone readings are temporarily unavailable. Please check back
            shortly.
          </p>
        </div>
      )}
    </section>
  );
}
