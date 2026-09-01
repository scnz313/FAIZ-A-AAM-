import Link from "next/link";

import type { MetricType, Zone, StaffProfileCode } from "@fass/contracts";
import { METRIC_META, ZONE_KIND_LABELS } from "@fass/contracts";
import { bandForMetric, floorLabel, zoneStatus, zoneStatusLabel, type ZoneStatus } from "@/modules/iot/domain";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { ChinarMark } from "@/components/ui/ChinarMark";
import { Sparkline } from "@/components/ui/Sparkline";
import { StatusBadge } from "@/components/ui/StatusBadge";

import styles from "./ZoneTile.module.css";

export type ZoneTileData = {
  zone: Zone;
  readings: Partial<Record<MetricType, number>>;
  spark: { metric: MetricType; data: number[] } | null;
};

export type ZoneTileProps = {
  data: ZoneTileData;
  profileCode: StaffProfileCode | null;
};

/** Metrics shown as rows on the tile, in display order. */
const ROW_METRICS = ["temp_c", "co2_ppm", "pm25_ugm3", "humidity_pct"] as const satisfies readonly MetricType[];

function statusTone(status: ZoneStatus): "good" | "watch" | "alert" {
  if (status === "comfortable") return "good";
  if (status === "watch") return "watch";
  return "alert";
}

/** Bordered tile for one zone; the whole tile is the link to the zone detail. */
export function ZoneTile({ data, profileCode }: ZoneTileProps) {
  const { zone, readings, spark } = data;
  const status = zoneStatus(readings);
  const sparkMeta = spark ? METRIC_META[spark.metric] : null;

  return (
    <Link prefetch={false} href={canonicalStaffUrl(profileCode, `/facility/zones/${zone.id}`)} className={styles.tile}>
      <ChinarMark size={12} tone="ink" className={styles.mark} />
      <h3 className={styles.name}>{zone.name}</h3>
      <p className={`kicker ${styles.kind}`}>{ZONE_KIND_LABELS[zone.kind]}</p>
      <p className={styles.where}>
        {zone.building} · {floorLabel(zone.floor)}
      </p>

      <dl className={styles.rows}>
        {ROW_METRICS.map((metric) => {
          const value = readings[metric];
          if (value === undefined) return null;
          const meta = METRIC_META[metric];
          if (!meta) return null;
          const band = bandForMetric(metric, value);
          return (
            <div className={styles.row} key={metric}>
              <dt className={styles.rowLabel}>{meta.shortLabel}</dt>
              <dd className={styles.rowValue}>
                <span className={`num ${styles.value}`}>{value.toFixed(meta.decimals)}</span>
                <span className={styles.unit}>{meta.unit}</span>
                <span className={`status-dot status-dot--${band}`} aria-hidden="true" />
              </dd>
            </div>
          );
        })}
      </dl>

      <div className={styles.footer}>
        <StatusBadge tone={statusTone(status)}>{zoneStatusLabel(status)}</StatusBadge>
        {spark && sparkMeta ? (
          <Sparkline
            data={spark.data}
            ariaLabel={`24-hour ${sparkMeta.shortLabel} trend for ${zone.name}`}
            className={styles.spark}
          />
        ) : null}
      </div>
    </Link>
  );
}
