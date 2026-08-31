import Link from "next/link";

import type { MetricType, Zone } from "@fass/contracts";
import { ZONE_KIND_LABELS } from "@fass/contracts";
import { floorLabel, formatMetricValue, zoneStatus, zoneStatusLabel, type ZoneStatus } from "@/modules/iot/domain";
import { StatusBadge } from "@/components/ui/StatusBadge";

import styles from "./ZoneIndex.module.css";

export type ZoneIndexRow = {
  zone: Zone;
  readings: Partial<Record<MetricType, number>>;
  deviceCount: number;
};

/** Reading columns shown in the index, in display order. */
const COLUMN_METRICS = ["temp_c", "co2_ppm", "pm25_ugm3", "humidity_pct"] as const satisfies readonly MetricType[];

function statusTone(status: ZoneStatus): "good" | "watch" | "alert" {
  if (status === "comfortable") return "good";
  if (status === "watch") return "watch";
  return "alert";
}

/** Full table of zones with current readings; each row links to its zone detail. */
export function ZoneIndex({ rows }: { rows: ZoneIndexRow[] }) {
  if (rows.length === 0) {
    return <p className={styles.empty}>No zones are registered yet. Zones appear here once sensors are added.</p>;
  }

  return (
    <div className="table--scroll">
      <table className={`table ${styles.table}`}>
        <caption className="sr-only">Zones with current readings, status and device counts</caption>
        <thead>
          <tr>
            <th scope="col">Zone</th>
            <th scope="col">Kind</th>
            <th scope="col">Building / floor</th>
            <th scope="col">Temperature</th>
            <th scope="col">CO₂</th>
            <th scope="col">PM2.5</th>
            <th scope="col">Humidity</th>
            <th scope="col">Status</th>
            <th scope="col">Devices</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = zoneStatus(row.readings);
            return (
              <tr key={row.zone.id} className={styles.rowLink}>
                <th scope="row">
                  <Link prefetch={false} href={`/staff/facility/zones/${row.zone.id}`}>{row.zone.name}</Link>
                </th>
                <td>{ZONE_KIND_LABELS[row.zone.kind]}</td>
                <td>
                  {row.zone.building} · {floorLabel(row.zone.floor)}
                </td>
                {COLUMN_METRICS.map((metric) => {
                  const value = row.readings[metric];
                  if (value === undefined) {
                    return (
                      <td key={metric} className={styles.dash}>
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={metric} className="num">
                      {formatMetricValue(metric, value)}
                    </td>
                  );
                })}
                <td>
                  <StatusBadge tone={statusTone(status)}>{zoneStatusLabel(status)}</StatusBadge>
                </td>
                <td className="num">{row.deviceCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
