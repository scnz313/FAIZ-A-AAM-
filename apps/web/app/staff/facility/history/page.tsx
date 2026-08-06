import type { Metadata } from "next";
import type { HistorySeries, Zone } from "@fass/contracts";
import { HistoryWorkspace } from "@/components/facility/history/HistoryWorkspace";
import { getZoneHistory, getZones } from "@/lib/iot/api";

export const metadata: Metadata = {
  title: "Reading history · Facility",
};

export default async function HistoryPage() {
  let zones: Zone[] = [];
  let initialSeries: HistorySeries | null = null;
  let initialError = false;

  try {
    const zonesData = await getZones();
    zones = zonesData.zones;
    const firstZone = zones[0];
    if (firstZone) {
      initialSeries = await getZoneHistory(firstZone.id, "co2_ppm", "24h");
    }
  } catch {
    initialError = true;
  }

  return (
    <div>
      <header className="workspace-header">
        <p className="eyebrow">Facility · History</p>
        <h1 className="workspace-title">Reading history</h1>
        <p className="workspace-intro">
          Past readings for one zone and metric, compared against the school comfort and alert thresholds.
        </p>
      </header>
      <HistoryWorkspace
        zones={zones}
        defaultZoneId={zones[0]?.id ?? null}
        initialSeries={initialSeries}
        initialError={initialError}
      />
    </div>
  );
}
