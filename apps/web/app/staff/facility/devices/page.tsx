import type { Metadata } from "next";
import type { Device, Zone } from "@fass/contracts";
import { DevicesWorkspace } from "@/components/facility/devices/DevicesWorkspace";
import { getDevices, getZones } from "@/lib/iot/api";

export const metadata: Metadata = {
  title: "Devices · Facility",
};

export default async function DevicesPage() {
  let zones: Zone[] = [];
  let devices: Device[] | null = null;

  try {
    const [zonesData, d] = await Promise.all([getZones(), getDevices()]);
    zones = zonesData.zones;
    devices = d;
  } catch {
    devices = null;
  }

  return (
    <div>
      <header className="workspace-header">
        <p className="eyebrow">Facility · Devices</p>
        <h1 className="workspace-title">Devices</h1>
        <p className="workspace-intro">
          The fixed sensor fleet by zone and metric. Select a row for its current value and 24-hour trend.
        </p>
      </header>
      <DevicesWorkspace zones={zones} initialDevices={devices} />
    </div>
  );
}
