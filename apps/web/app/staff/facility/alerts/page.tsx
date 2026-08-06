import type { Metadata } from "next";
import type { Alert, Zone } from "@fass/contracts";
import { AlertsWorkspace } from "@/components/facility/alerts/AlertsWorkspace";
import { getAlerts, getZones } from "@/lib/iot/api";

export const metadata: Metadata = {
  title: "Alerts · Facility",
};

export default async function AlertsPage() {
  let zones: Zone[] = [];
  let alerts: Alert[] | null = null;

  try {
    const [zonesData, a] = await Promise.all([getZones(), getAlerts()]);
    zones = zonesData.zones;
    alerts = a;
  } catch {
    alerts = null;
  }

  return (
    <div>
      <header className="workspace-header">
        <p className="eyebrow">Facility · Alerts</p>
        <h1 className="workspace-title">Alerts</h1>
        <p className="workspace-intro">
          Alerts raise when a zone reading crosses a threshold. Acknowledge to take ownership; resolve with a note.
        </p>
      </header>
      <AlertsWorkspace zones={zones} initialAlerts={alerts} />
    </div>
  );
}
