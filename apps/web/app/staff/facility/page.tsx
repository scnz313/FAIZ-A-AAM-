import Link from "next/link";

import type { MetricType } from "@fass/contracts";
import { getAlerts, getOverview, getZoneHistory, getZones } from "@/lib/iot/api";
import { loadServerProfileCode } from "@/lib/supabase/server-loaders";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { zoneStatus, type ZoneStatus } from "@/modules/iot/domain";
import { AlertStrip } from "@/components/facility/overview/AlertStrip";
import { HeadlineBand } from "@/components/facility/overview/HeadlineBand";
import { ZoneGrid } from "@/components/facility/overview/ZoneGrid";
import type { ZoneTileData } from "@/components/facility/overview/ZoneTile";

import styles from "./page.module.css";

function statusRank(status: ZoneStatus): number {
  if (status === "action") return 0;
  if (status === "watch") return 1;
  return 2;
}

function pickSparkMetric(readings: Partial<Record<MetricType, number>>): MetricType | null {
  if (readings.co2_ppm !== undefined) return "co2_ppm";
  if (readings.pm25_ugm3 !== undefined) return "pm25_ugm3";
  return null;
}

function countBreakdown(items: { status: ZoneStatus }[]): { comfortable: number; watch: number; action: number } {
  const counts = { comfortable: 0, watch: 0, action: 0 };
  for (const item of items) {
    counts[item.status] += 1;
  }
  return counts;
}

export default async function FacilityOverviewPage() {
  const [overview, zonesData, alerts, profileCode] = await Promise.all([getOverview(), getZones(), getAlerts(), loadServerProfileCode()]);
  const { zones, current: currentByZone } = zonesData;

  const ranked = zones
    .map((zone) => {
      const snapshot = currentByZone[zone.id];
      return { zone, current: snapshot, status: zoneStatus(snapshot?.readings ?? {}) };
    })
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.zone.name.localeCompare(b.zone.name));

  // Sparklines only for the six most urgent zones, keeping the overview fast.
  const sparks = await Promise.all(
    ranked.slice(0, 6).map(async ({ zone, current }) => {
      const readings = current?.readings ?? {};
      const metric = pickSparkMetric(readings);
      if (!metric) return { zoneId: zone.id, spark: null };
      const history = await getZoneHistory(zone.id, metric, "24h");
      return { zoneId: zone.id, spark: { metric, data: history.samples.map((sample) => sample.value) } };
    }),
  );
  const sparkByZoneId = new Map(sparks.map((entry) => [entry.zoneId, entry.spark]));

  const tiles: ZoneTileData[] = ranked.map(({ zone, current }) => ({
    zone,
    readings: current?.readings ?? {},
    spark: sparkByZoneId.get(zone.id) ?? null,
  }));

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Overview</h1>
          <p className="ph-sub">
            Live environmental readings across the campus · outdoor air, indoor comfort and the device fleet.
          </p>
        </div>
      </div>

      <AlertStrip alerts={alerts} profileCode={profileCode} />

      <HeadlineBand
        outdoor={overview.outdoor}
        indoor={overview.indoorComfort}
        fleet={overview.fleet}
        breakdown={countBreakdown(ranked)}
        takenAt={overview.takenAt}
      />

      <ZoneGrid tiles={tiles} profileCode={profileCode} />

      <p className={styles.readingLine}>
        <span>
          Comfort and air-quality bands follow the school&apos;s thermal policy and CPCB guidance; readings are
          sampled demo data.
        </span>
        <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/facility/history")}>
          Review the full history →
        </Link>
      </p>
    </div>
  );
}
