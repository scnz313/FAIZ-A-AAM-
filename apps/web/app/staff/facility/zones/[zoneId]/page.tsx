import Link from "next/link";

import { ZONE_KIND_LABELS } from "@fass/contracts";
import { getZoneDetail, getZoneHistory } from "@/lib/iot/api";
import { floorLabel } from "@/modules/iot/domain";
import { DETAIL_CHART_METRICS, ZoneDetail, type ZoneDetailData } from "@/components/facility/zones/ZoneDetail";

import styles from "./page.module.css";

type FacilityZoneDetailPageProps = {
  params: Promise<{ zoneId: string }>;
};

export default async function FacilityZoneDetailPage({ params }: FacilityZoneDetailPageProps) {
  const { zoneId } = await params;
  const { zone, current, devices, alerts } = await getZoneDetail(zoneId);

  if (!zone) {
    return (
      <div className={styles.page}>
        <Link prefetch={false} className={`link-arrow ${styles.backLink}`} href="/staff/facility/zones">
          ← Zones
        </Link>
        <h1 className="workspace-title">Zone not found</h1>
        <p className={styles.notFoundIntro}>
          This zone may have been removed, or the link you followed is incorrect.
        </p>
        <Link prefetch={false} className="link-arrow" href="/staff/facility/zones">
          Back to all zones →
        </Link>
      </div>
    );
  }

  const readings = current?.readings ?? {};

  const chartSeries = await Promise.all(
    DETAIL_CHART_METRICS.filter((metric) => readings[metric] !== undefined).map(async (metric) => ({
      metric,
      samples: (await getZoneHistory(zone.id, metric, "24h")).samples,
    })),
  );

  const data: ZoneDetailData = {
    zone,
    readings,
    takenAt: current?.takenAt ?? null,
    devices,
    alerts,
    chartSeries,
  };

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.head}`}>
        <p className={styles.backLink}>
          <Link prefetch={false} className="link-arrow" href="/staff/facility/zones">
            ← Zones
          </Link>
        </p>
        <p className="eyebrow">Facility · Zones</p>
        <h1 className="workspace-title">{zone.name}</h1>
        <p className={`workspace-intro ${styles.meta}`}>
          {ZONE_KIND_LABELS[zone.kind]} · {zone.building} · {floorLabel(zone.floor)} · Capacity{" "}
          <span className="num">{zone.capacity}</span>
        </p>
      </header>

      <ZoneDetail {...data} />
    </div>
  );
}
