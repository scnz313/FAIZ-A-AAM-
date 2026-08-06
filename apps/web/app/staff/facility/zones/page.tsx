import { getDevices, getZones } from "@/lib/iot/api";
import { ZoneIndex, type ZoneIndexRow } from "@/components/facility/zones/ZoneIndex";

import styles from "./page.module.css";

export default async function FacilityZonesPage() {
  const [zonesData, devices] = await Promise.all([getZones(), getDevices()]);
  const { zones, current: currentByZone } = zonesData;

  const rows: ZoneIndexRow[] = zones.map((zone) => ({
    zone,
    readings: currentByZone[zone.id]?.readings ?? {},
    deviceCount: devices.filter((device) => device.zoneId === zone.id).length,
  }));

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Facility · Zones</p>
        <h1 className="workspace-title">Zones</h1>
        <p className="workspace-intro">
          Every monitored zone with current readings, status and device counts. Select a zone for its full record.
        </p>
      </header>

      <ZoneIndex rows={rows} />
    </div>
  );
}
